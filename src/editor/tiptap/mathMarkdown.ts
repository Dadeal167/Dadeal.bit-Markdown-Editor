/**
 * Markdown ⇄ 数学节点的桥接：
 * - 导出：各节点的 markdown.serialize 先写成**标记字符**包起来的形式
 *   （`\u0002latex\u0002` / `\u0003latex\u0003`），由 finalizeMarkdown 统一换成 `$…$` / `$$…$$`；
 *   这样正文里用户自己写的字面 `$` 就能被安全转义成 `\$`，不会被误当成公式
 * - 导入：setMarkdown 先把 `\$` 保护起来（换成占位符）再交给解析器，
 *   公式注入只认真正的 `$…$`；解析完再把占位符还原成 `$`
 */

import { looksLikeLatex } from '../math/rawMathText'
import { repairLatex } from '../math/latexRepair'
import { unescapeMarkdown } from '../zhihuMarkdown'

const BLOCK_RE = /^\$\$([\s\S]+?)\$\$$/
const INLINE_RE = /\$([^$\n]+)\$/

/** 序列化时用来包裹公式的标记字符（正文里不可能出现） */
export const MATH_INLINE_MARK = '\u0002'
export const MATH_BLOCK_MARK = '\u0003'
/** 导入时保护 `\$` 的占位符 */
const ESCAPED_DOLLAR = '\u0001'

/**
 * 造一个数学节点。
 *
 * 这里统一过一遍 repairLatex —— 公式进文档的路径有好几条
 * （markdown 的 `$…$`、知乎的 equation img、外面存好的 `data-latex`、
 * 解析后再从 `$$…$$` 兜一遍），以前只有前两条修，后面两条会漏。
 * 结果就是"同样的坏写法，走不同路径进来，有的修好有的还是红字"。
 * repairLatex 对本来就能渲染的公式是**原样返回**，所以在这里调是安全的。
 */
function mathElement(latex: string, display: boolean): HTMLElement {
  const fixed = repairLatex(latex, display)
  const el = document.createElement(display ? 'div' : 'span')
  if (display) el.setAttribute('data-math-block', 'true')
  else el.setAttribute('data-math-inline', 'true')
  el.setAttribute('data-latex', fixed)
  el.textContent = fixed
  return el
}

/**
 * 序列化前：把"渲染不出来"的公式按修好的写法写出去。
 *
 * 为什么需要：界面渲染公式时会调 repairLatex（屏幕上看到的是修好的那份），
 * 但公式节点里存的仍然是源文件里的坏写法。于是出现"看到的是好的、存下来是坏的"：
 * 用户把 .md 拿到 Typedown / Typora / Word 里打开，就显示 Invalid Mathematical Formula。
 * 实测：`\left { x_{n}-y_{n} \right }`（少一个反斜杠，\left \right 配不上对）就是这么来的，
 * 直接存盘会把坏写法原样写回文件。
 *
 * 策略和 repairLatex 一致：**只动渲染不出来的公式**，能正常渲染的一个字符都不碰。
 */
export function repairMathInMarkdown(md: string): string {
  if (!md.includes(MATH_INLINE_MARK) && !md.includes(MATH_BLOCK_MARK)) return md
  const block = new RegExp(`${MATH_BLOCK_MARK}([\\s\\S]*?)${MATH_BLOCK_MARK}`, 'g')
  const inline = new RegExp(`${MATH_INLINE_MARK}([\\s\\S]*?)${MATH_INLINE_MARK}`, 'g')
  return md
    .replace(block, (_m, latex: string) => `${MATH_BLOCK_MARK}${repairLatex(latex, true)}${MATH_BLOCK_MARK}`)
    .replace(inline, (_m, latex: string) => `${MATH_INLINE_MARK}${repairLatex(latex, false)}${MATH_INLINE_MARK}`)
}

/**
 * 序列化收尾：把标记还原成 `$…$`，并把**其余的字面 `$` 转义**。
 * 顺序很重要：先转义裸 `$`，再把标记换成 `$`，否则会把自己的公式也转义掉。
 * 代码块 / 行内代码里的 `$` 不转义 —— 那里的 `\$` 会原样显示出来，把代码改坏
 *（实测：代码块里的 `"$x$"` 导出成 `"\$x\$"`，再导入进编辑器代码就变了）。
 */
export function finalizeMarkdown(md: string): string {
  const inCode = codeMask(md)
  let withEscaped = ''
  for (let i = 0; i < md.length; i += 1) {
    const ch = md[i]
    withEscaped += ch === '$' && !inCode[i] ? '\\$' : ch
  }
  return fixHardBreaks(withEscaped)
    .replace(new RegExp(`${MATH_INLINE_MARK}([\\s\\S]*?)${MATH_INLINE_MARK}`, 'g'), (_m, latex: string) => `$${latex}$`)
    .replace(
      new RegExp(`${MATH_BLOCK_MARK}([\\s\\S]*?)${MATH_BLOCK_MARK}`, 'g'),
      (_m, latex: string) => `$$\n${latex}\n$$`,
    )
}

/**
 * 硬换行（Shift+Enter）的写法：把"反斜杠 + 换行"换成"两个空格 + 换行"。
 *
 * 为什么：prosemirror-markdown 默认把硬换行写成 `\` + 换行（CommonMark 两种写法之一），
 * 但不少软件不认这种写法 —— Typedown 就直接把那个反斜杠当普通字符显示出来，
 * 于是引用末尾会冒出一个莫名其妙的 `\`（用户截图反馈过）。
 * 两个空格 + 换行是另一种标准写法，各家都认。
 *
 * 只动"行尾单个反斜杠"的情况，而且：
 *   - 公式此时还包在占位符里（`\u0002…\u0002`），不会被碰到
 *   - 代码块里的反斜杠跳过（那是代码，不能改）
 *   - `\\`（用户真的要显示一个反斜杠）也不碰
 */
function fixHardBreaks(md: string): string {
  if (!md.includes('\\\n')) return md
  const inCode = codeMask(md)
  let out = ''
  for (let i = 0; i < md.length; i += 1) {
    if (md[i] === '\\' && md[i + 1] === '\n' && md[i - 1] !== '\\' && !inCode[i]) {
      out += '  \n' // 两个空格 + 换行
      i += 1
      continue
    }
    out += md[i]
  }
  return out
}

/**
 * 解析前：把 `\$` 藏起来，免得解析器把它变成 `$` 之后再被误认成公式。
 *
 * 注意：这个函数只在**公式外面**用得上（例如正文里的"原价 \$100"）。
 * 公式里面的 `$` 一律当收尾定界符，见 protectMathSpans —— 因为从各种导出工具
 * 出来的 .md 里，公式常常以 LaTeX 换行 `\\` 收尾再跟一个 `$`（写成 `\\$`），
 * 那个 `$` 是定界符而不是转义的美元号；以前把它吃掉，导致公式收不了尾、
 * 整篇的 $ 配对全部错位（实测：100 个公式只剩 83 个、正文残留 29 个 `$`）。
 */
export function protectEscapedDollars(md: string): string {
  return md.replace(/\\\$/g, ESCAPED_DOLLAR)
}

/**
 * 导入前的第一道预处理：把**被转义过的"公式原文"**恢复成正常公式。
 *
 * 为什么需要（真实数据）：用户机器上 `Desktop\zhihu\learning\` 那批文章里留着
 * 这样的化石 ——
 *     ...]=1\$ \$\n\n$cos\alpha sin\beta=\frac{1}{2}[...]\\$
 * 即"字面 `\$` 与真公式交叉出现"。这是 **$ 配对整体错位之后**留下的印记：
 * 公式没被认出来，导出/存盘时字面 `$` 就被转义成了 `\$`。
 *
 * 以前只有**导出到知乎**那条路认得这种写法（mdToZhihuMarkdown 里的 `\$` 分支），
 * 导入路径完全没有 —— 于是出现"导出到知乎能变成公式、在编辑器里打开却恢复不了"，
 * 用户文档里那些化石就一直躺着，正文里全是反斜杠。
 *
 * 判据与知乎那条路**共用** looksLikeFormula，保证两边行为一致。
 * 保守起见：只认同一行内成对、且内容确实像 LaTeX 的 `\$…\$`；
 * 行尾是 Markdown 硬换行的 `\\$` 不碰（那是定界符，交给 protectMathSpans）。
 */
export function recoverEscapedMath(md: string, looksLikeLatexFormula: (s: string) => boolean): string {
  if (!md.includes('\\$')) return md
  return md.replace(/\\\$([^$\n]{1,600}?)\\\$/g, (whole: string, rawBody: string) => {
    /* 行尾 `\\$`（LaTeX 换行再收尾）不是"转义公式原文"，让后面的扫描器去处理 */
    if (rawBody.endsWith('\\')) return whole
    const body = unescapeMarkdown(rawBody).replace(/\\{2,}/g, '\\')
    return looksLikeLatexFormula(body) ? `$${body}$` : whole
  })
}

/** 解析后：把占位符还原成真正的 `$` 字符（写进文档文字，不再是公式） */
export function restoreEscapedDollars(root: ParentNode): void {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const targets: Text[] = []
  let node = walker.nextNode()
  while (node) {
    if ((node as Text).data.includes(ESCAPED_DOLLAR)) targets.push(node as Text)
    node = walker.nextNode()
  }
  for (const t of targets) t.data = t.data.split(ESCAPED_DOLLAR).join('$')
}

/* ============================================================
 * 公式保护：Markdown 解析器（markdown-it）**不认识 $…$ 公式**，
 * 它会先把公式里的 Markdown 记号吃掉，例如
 *     $a*b*c$   →  $a<em>b</em>c$   （公式没了，b 变成斜体）
 * 反引号、方括号、`\\`（LaTeX 换行）同理。
 *
 * 做法：解析前把每个公式整段换成不会被打扰的占位符，解析完再还原成真正的公式节点。
 * ============================================================ */

/** 行内公式占位符：\u0004 序号 \u0004；块级公式用 \u0005 */
const INLINE_OPEN = '\u0004'
const BLOCK_OPEN = '\u0005'

export interface MathSpan {
  latex: string
  display: boolean
}

/** 本次解析里被保护的公式：protectMathSpans 收集，injectMathIntoDom 还原 */
let pendingSpans: MathSpan[] = []

/**
 * 标出"代码"占用的字符位置：围栏代码块（``` / ~~~）与行内代码（`…`）。
 * 代码里的 `$` 是代码，不能当公式去保护/还原
 * （实测：代码块里的 `"$不是公式$"` 被拆出去变成真公式，代码块直接断成两截）。
 */
export function codeMask(md: string): boolean[] {
  const mask = new Array<boolean>(md.length).fill(false)
  let pos = 0
  let fence: string | null = null
  for (const line of md.split('\n')) {
    const trimmed = line.trimStart()
    const fenceMatch = /^(`{3,}|~{3,})/.exec(trimmed)
    if (fence) {
      for (let i = 0; i < line.length; i += 1) mask[pos + i] = true
      if (fenceMatch && trimmed.startsWith(fence)) fence = null
    } else if (fenceMatch) {
      fence = fenceMatch[1]
      for (let i = 0; i < line.length; i += 1) mask[pos + i] = true
    } else {
      // 行内代码：成对的反引号之间都算代码
      let i = 0
      while (i < line.length) {
        if (line[i] === '`') {
          const close = line.indexOf('`', i + 1)
          const end = close < 0 ? line.length : close + 1
          for (let j = i; j < end; j += 1) mask[pos + j] = true
          i = end
        } else {
          i += 1
        }
      }
    }
    pos += line.length + 1
  }
  return mask
}

/**
 * 把 Markdown 里的 $$…$$ / $…$ 换成占位符，同时把**公式外面**的 `\$` 保护起来。
 *
 * 一趟扫完的好处是"转义美元号"的判断能分场合：
 *  - 公式外面：`\$`（包括 `\\$` 里最后那个）是字面美元号 → 换成占位符
 *  - 公式里面：任何一个 `$` 都是收尾定界符，不看前面的反斜杠
 * 这样 `$a\\$` 能被正确识别成一个"以换行结尾"的公式，而"原价 \$100" 也不会变成公式。
 * 代码块 / 行内代码里的 `$` 一律不碰。
 */
export function protectMathSpans(md: string): { md: string; spans: MathSpan[] } {
  const spans: MathSpan[] = []
  const inCode = codeMask(md)
  let out = ''
  let i = 0
  while (i < md.length) {
    const ch = md[i]
    if (inCode[i]) {
      out += ch
      i += 1
      continue
    }
    // 公式外面：\$ 是字面美元号，藏起来
    if (ch === '\\' && md[i + 1] === '$') {
      out += ESCAPED_DOLLAR
      i += 2
      continue
    }
    if (ch !== '$') {
      out += ch
      i += 1
      continue
    }
    // 块级公式优先：$$ … $$
    if (md.startsWith('$$', i)) {
      const end = md.indexOf('$$', i + 2)
      if (end > i) {
        const latex = md.slice(i + 2, end).trim()
        if (latex) {
          const idx = spans.push({ latex, display: true }) - 1
          out += `${BLOCK_OPEN}${idx}${BLOCK_OPEN}`
          i = end + 2
          continue
        }
      }
      out += '$$'
      i += 2
      continue
    }
    // 行内公式：同一行内再遇到一个 $ 就是收尾
    const end = md.indexOf('$', i + 1)
    const lineEnd = md.indexOf('\n', i + 1)
    if (end > i && (lineEnd < 0 || end < lineEnd)) {
      const latex = md.slice(i + 1, end)
      // 内容得"像公式"才算：否则"落单的 $ 和 $ 不成对"这种会变成 latex 是 ` 和 ` 的假公式
      if (latex.trim() && looksLikeLatex(latex)) {
        const idx = spans.push({ latex, display: false }) - 1
        out += `${INLINE_OPEN}${idx}${INLINE_OPEN}`
        i = end + 1
        continue
      }
    }
    out += '$'
    i += 1
  }
  pendingSpans = spans // 供解析时的 injectMathIntoDom 还原
  return { md: out, spans }
}
/** 解析后：把占位符还原成数学节点（块级的还会把外层空段落去掉） */
export function restoreMathSpans(root: HTMLElement, spans: MathSpan[]): void {
  if (!spans.length) return

  /* 还原前统一过一遍写法修复。
     为什么放在这里而不是只在 protectMathSpans 里修：载入路径有两条 ——
     markdown 那条（$…$ → 占位符）和 HTML 那条（外面存好的 data-latex 直接注入），
     两条都得修，否则同一段公式走哪条路进来结果不一样。
     repairLatex **只动渲染不出来的公式**，本来正常的原样返回。 */
  for (const span of spans) span.latex = repairLatex(span.latex, span.display)

  // 先把"整段只有一个块级占位符"的段落换成块级公式
  root.querySelectorAll('p').forEach((p) => {
    const text = (p.textContent ?? '').trim()
    const m = new RegExp(`^${BLOCK_OPEN}(\\d+)${BLOCK_OPEN}$`).exec(text)
    if (!m) return
    const span = spans[Number(m[1])]
    if (span) p.replaceWith(mathElement(span.latex, true))
  })

  // 剩下的按文本节点处理（行内 + 混在文字里的块级）
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const targets: Text[] = []
  let node = walker.nextNode()
  while (node) {
    const data = (node as Text).data
    // 代码块里的占位符不动（那是代码里的 $，不该变成公式）
    const inCode = !!(node as Text).parentElement?.closest('code, pre')
    if (!inCode && (data.includes(INLINE_OPEN) || data.includes(BLOCK_OPEN))) targets.push(node as Text)
    node = walker.nextNode()
  }
  const re = new RegExp(`${INLINE_OPEN}(\\d+)${INLINE_OPEN}|${BLOCK_OPEN}(\\d+)${BLOCK_OPEN}`, 'g')
  for (const t of targets) {
    const frag = document.createDocumentFragment()
    let last = 0
    let m: RegExpExecArray | null
    re.lastIndex = 0
    while ((m = re.exec(t.data))) {
      if (m.index > last) frag.appendChild(document.createTextNode(t.data.slice(last, m.index)))
      const span = spans[Number(m[1] ?? m[2])]
      if (span) frag.appendChild(mathElement(span.latex, span.display))
      last = m.index + m[0].length
    }
    if (last < t.data.length) frag.appendChild(document.createTextNode(t.data.slice(last)))
    t.replaceWith(frag)
  }
}

/** 公式导入：把解析后的 DOM 里的 $...$ 文本转成数学节点元素（跳过代码块） */
export function injectMathIntoDom(root: HTMLElement): void {
  // 0) 知乎公式标记：<img src="…/equation?tex=…" alt="LaTeX" eeimg="1|2">
  //    —— 打开"以前导出给知乎的 .md"（或别人从知乎导出的文件）时，公式就是这种 img 标记，
  //    不认出来的话公式全变成图片：不能编辑、也不能再导出（实测用户那篇 166 个公式全是这样）。
  //    知乎按 alt 读 LaTeX 原文；alt 丢了就退回从 tex 参数解出来。
  root.querySelectorAll('img').forEach((img) => {
    if (img.closest('code, pre')) return
    const src = img.getAttribute('src') ?? ''
    const m = /(?:zhihu\.com)?\/equation\?tex=([^"'&\s]+)/.exec(src)
    if (!m) return
    let latex = (img.getAttribute('alt') ?? '').trim()
    if (!latex) {
      try {
        latex = decodeURIComponent(m[1])
      } catch {
        latex = m[1]
      }
    }
    latex = latex.trim()
    if (!latex) return
    const display = img.getAttribute('eeimg') === '2'
    // 顺手把坏写法修好（`\left { x \right }` 这种少反斜杠的）：不修的话存进节点里的就是坏写法，
    // 导出的 HTML / PDF 会渲染成 KaTeX 报错红框（用户截图反馈过）
    latex = repairLatex(latex, display)
    // 块级公式：img 独占一段（或本身就在块级位置）时，整段换成块级公式；否则按行内插进文字里
    const holder = img.parentElement
    const alone = !holder || holder.tagName !== 'P' || (holder.textContent ?? '').trim() === ''
    if (display && alone) (holder && holder.tagName === 'P' ? holder : img).replaceWith(mathElement(latex, true))
    else img.replaceWith(mathElement(latex, false))
  })

  // 1) 独占一段的块级公式：<p>$$…$$</p> → <div data-math-block>
  root.querySelectorAll('p').forEach((p) => {
    if (p.querySelector('code, pre')) return
    const text = (p.textContent ?? '').trim()
    const m = BLOCK_RE.exec(text)
    if (m) p.replaceWith(mathElement(m[1].trim(), true))
  })

  // 2) 行内公式
  const targets: Text[] = []
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let node = walker.nextNode()
  while (node) {
    const el = (node as Text).parentElement
    if (el && !el.closest('code, pre, [data-math-inline], [data-math-block]')) {
      if (INLINE_RE.test((node as Text).data)) targets.push(node as Text)
    }
    node = walker.nextNode()
  }

  for (const t of targets) {
    const parts = t.data.split(/(\$[^$\n]+\$)/g)
    if (parts.length < 2) continue
    const frag = document.createDocumentFragment()
    for (const part of parts) {
      const m = /^\$([^$\n]+)\$$/.exec(part)
      // 和导入那条路保持一致：内容得"像公式"才算，免得把"落单的 $ 和 $ 不成对"变成假公式
      if (m && looksLikeLatex(m[1])) frag.appendChild(mathElement(m[1], false))
      else if (part) frag.appendChild(document.createTextNode(part))
    }
    t.replaceWith(frag)
  }

  // 公式都认完了，这时再把被保护的 \$ 还原成普通字符
  restoreEscapedDollars(root)
  // 以及把"受保护的公式占位符"还原成数学节点
  restoreMathSpans(root, pendingSpans)
}
