/**
 * "公式还是原文"的识别与转换。
 *
 * 场景：从网页 / 导出 HTML / 别的编辑器里**粘贴**内容时，公式常常是以
 * 纯文本 `$…$` 的形式进来的（那些导出工具的 HTML 里，公式本来就是文本），
 * 粘贴这条路不经过"导入 .md"的公式保护，于是就原样留在正文里，
 * 变成一行带反斜杠的乱码——用户看到的就是"公式错误"。
 *
 * 这里做两件事：
 *   1) 在一段文本里认出 `$…$`（同一行内成对、内容看着像公式）
 *   2) 把整篇文档里这种"原文公式"换成真正的公式节点
 * 判断"像不像公式"很保守：带中文又不是 \text{} 这类命令的，一律不碰，
 * 免得把"原价 $100，现价 $60"这种正文误伤成公式。
 */
import type { Editor } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'

export interface MathPart {
  math: boolean
  value: string
  display: boolean
}

/** 汉字 / 日文假名：正文里常见，公式里基本不会出现（除非写在 \text{} 里） */
const HAN = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/
/** 明显的句子标点（句号、问号、引号、书名号…）：公式里不会这么写 */
const PROSE_PUNCT = /[。！？；：、“”‘’《》（）【】…]/

/** 常见的数学函数名：带空格时如果只出现这些"英文词"，仍然按公式算 */
const MATH_WORDS = new Set([
  'sin', 'cos', 'tan', 'cot', 'sec', 'csc', 'arcsin', 'arccos', 'arctan',
  'sinh', 'cosh', 'tanh', 'coth', 'log', 'ln', 'lg', 'exp', 'lim', 'max', 'min',
  'sup', 'inf', 'det', 'dim', 'deg', 'gcd', 'lcm', 'mod', 'arg', 'ker', 'hom',
  'Pr', 'st', 'iff', 'text', 'mathrm', 'mathbf', 'mathbb', 'mathcal', 'cdot', 'times',
])

/**
 * 这段文字看着像不像公式。
 * 保守但不能太紧：`$a + b$`、`$x = 1$` 这种**带空格的正经公式**必须认
 * （太紧会让编辑器自己存下来的公式在重开时降级成文字，是实打实的数据损坏）。
 */
export function looksLikeLatex(inner: string): boolean {
  const s = inner.trim()
  if (!s || s.length > 800) return false
  if (s.includes('$')) return false
  const cmd = /\\[a-zA-Z]+|\\./.test(s)
  // 带汉字/假名或句子标点的，只有写成命令（\text{中} 之类）才认
  if ((HAN.test(s) || PROSE_PUNCT.test(s)) && !cmd) return false
  if (cmd) return true
  // 带空格的：只有出现"像英文单词"的东西才当正文
  // （"100 and " 里的 and 是单词 → 正文；"a + b"、"x = 1" 里只有单字母 → 公式）
  if (/\s/.test(s)) {
    const words = s.match(/[A-Za-z]{3,}/g) ?? []
    if (words.some((w) => !MATH_WORDS.has(w))) return false
  }
  // 中文逗号是允许的：作者常写成 $9，13，17，...，4m+1$ 这样
  return true
}

export interface MathRange {
  /** 在整段文本里的起止（含 `$`） */
  start: number
  end: number
  /** `$` 里面的 LaTeX */
  latex: string
  /** `$` 后面第一个字符的位置（用来切文本） */
  innerStart: number
}

/** 找出一段文本里所有"看着像公式"的 `$…$`（要求同一行内成对） */
export function findMathRanges(text: string): MathRange[] {
  const out: MathRange[] = []
  const re = /(?<!\\)\$([^$\n]+?)(?<!\\)\$/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    if (!looksLikeLatex(m[1])) {
      // 否决之后要从这个 $ 的**后一个字符**继续找，否则会把紧跟其后的真公式一起漏掉
      // （实测：`他说 $100 元，$x^2$ 是公式` 里的 $x^2$ 会被吃掉）
      re.lastIndex = m.index + 1
      continue
    }
    out.push({ start: m.index, end: m.index + m[0].length, latex: m[1].trim(), innerStart: m.index + 1 })
  }
  return out
}

/**
 * 把一段文本切成「普通文字 / 公式」两种片段。
 * 只有同一行内成对、且内容像公式的 `$…$` 才认。
 */
export function scanRawMath(text: string): { parts: MathPart[]; count: number } {
  const parts: MathPart[] = []
  let last = 0
  const ranges = findMathRanges(text)
  for (const r of ranges) {
    if (r.start > last) parts.push({ math: false, value: text.slice(last, r.start), display: false })
    parts.push({ math: true, value: r.latex, display: false })
    last = r.end
  }
  if (!ranges.length) return { parts: [{ math: false, value: text, display: false }], count: 0 }
  if (last < text.length) parts.push({ math: false, value: text.slice(last), display: false })
  return { parts, count: ranges.length }
}

/**
 * 粘贴 Markdown 文本前的预处理（也用于导出时救"公式原文"）：
 * 只有"看着像公式"的 `$…$` 留着当定界符，其余美元号一律转义成字面 `\$`
 * （否则"原价 $100，现价 $60"这种正文会被当成公式）。
 *
 * 实现上只做一件事：把**不属于任何真公式**的 `$` 转义 —— 这样"$100 元，$x^2$ 是公式"
 * 里的第一个 `$` 变字面量、`$x^2$` 仍是公式。（用"逐个 continue"的老写法会在否决后
 * 吃掉紧跟的真公式，实测踩过。）
 */
export function escapeNonMathDollars(text: string): string {
  const keep = new Set<number>()
  for (const r of findMathRanges(text)) {
    for (let i = r.start; i < r.end; i += 1) if (text[i] === '$') keep.add(i)
  }
  let out = ''
  for (let i = 0; i < text.length; i += 1) {
    out += text[i] === '$' && !keep.has(i) ? '\\$' : text[i]
  }
  return out
}

interface BlockInfo {
  /** 块节点本身的位置 */
  pos: number
  node: PMNode
  /** 块里所有行内子节点：位置、节点、以及它的文本在"拼接串"里的起点 */
  inline: { from: number; node: PMNode; start: number }[]
  /** 拼起来的整块文本（原子节点 / 行内代码用 \n 当分隔，公式不会跨过去） */
  text: string
}

/** 行内代码（`…`）里的内容是代码，不该被当成公式 */
function isInlineCode(node: PMNode): boolean {
  return node.isText && node.marks.some((m) => m.type.name === 'code')
}

/** 收集所有"文字块"（段落、标题、表格单元格…），并把行内内容拼成一条字符串 */
function collectBlocks(doc: PMNode): BlockInfo[] {
  const out: BlockInfo[] = []
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true
    // 代码块里的 $ 是代码，不碰
    if (node.type.name === 'codeBlock') return false
    const inline: BlockInfo['inline'] = []
    let text = ''
    node.forEach((child, offset) => {
      const from = pos + 1 + offset
      inline.push({ from, node: child, start: text.length })
      // 行内代码整段当成"分隔符"：里面的 $ 不参与配对，也不会被替换
      if (isInlineCode(child)) text += '\n'.repeat(child.text?.length ?? 1)
      else text += child.isText && child.text ? child.text : '\n'
    })
    if (text.includes('$')) out.push({ pos, node, inline, text })
    return false
  })
  return out
}

/** 还有几处公式是"原文"（没有变成公式） */
export function countRawMath(editor: Editor): number {
  return collectBlocks(editor.state.doc).reduce((n, b) => n + findMathRanges(b.text).length, 0)
}

/**
 * 把"原文公式"就地换成真正的公式节点，返回换了几处。
 *
 * 关键：**按整块扫描**，而不是逐个文本节点 —— 公式里的 `*` `_` 会被 Markdown 变成
 * 斜体/加粗标记，把 `$…$` 切成好几个节点；只在一个节点里找是找不到的。
 * 找到后按位置切回各个子节点，尽量保留原来的加粗 / 链接等标记。
 */
export function convertRawMath(editor: Editor): number {
  const { schema } = editor.state
  const blocks = collectBlocks(editor.state.doc)
  const tr = editor.state.tr
  let total = 0

  // 从后往前替换：前面的位置不会因为后面的改动而漂移
  for (const block of blocks.reverse()) {
    const ranges = findMathRanges(block.text)
    if (!ranges.length) continue

    const nodes: PMNode[] = []
    for (const entry of block.inline) {
      const value = entry.node.isText && entry.node.text ? entry.node.text : ''
      if (!value) {
        // 原子节点（图片、已有公式）：原样保留
        nodes.push(entry.node)
        continue
      }
      if (isInlineCode(entry.node)) {
        // 行内代码原样保留（它就是代码，不该被公式化）
        nodes.push(entry.node)
        continue
      }
      const childStart = entry.start
      const childEnd = childStart + value.length
      let cursor = 0 // 已经用掉的字符数（相对这个子节点）
      for (const r of ranges) {
        if (r.end <= childStart || r.start >= childEnd) continue
        const s = Math.max(r.start, childStart) - childStart
        const e = Math.min(r.end, childEnd) - childStart
        if (s > cursor) nodes.push(schema.text(value.slice(cursor, s), entry.node.marks))
        // 公式只在它的起点所在的那个子节点里生成一次
        if (r.start >= childStart && r.start < childEnd) {
          nodes.push(schema.nodes.mathInline.create({ latex: r.latex }))
          total += 1
        }
        cursor = Math.max(cursor, e)
      }
      if (cursor < value.length) nodes.push(schema.text(value.slice(cursor), entry.node.marks))
    }

    tr.replaceWith(block.pos + 1, block.pos + block.node.content.size + 1, nodes)
  }

  if (total) editor.view.dispatch(tr)
  return total
}
