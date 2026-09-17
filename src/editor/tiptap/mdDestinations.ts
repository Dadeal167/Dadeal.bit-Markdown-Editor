/**
 * 链接 / 图片目标里的"坏字符"守卫 —— 导入前把会破坏语法的字符转义掉。
 *
 * ## 为什么要有它（用户实测，2026-09-27）
 *
 * 知乎导出（以及各种"网页转 Markdown"工具）会把图片存成
 * `assets/<文章名>/img_001.jpg`，而**文章名里带空格是常态**。
 * Markdown 的行内目标 `](…)` 里一旦出现**裸空格**，整段
 * `![说明](assets/可能是更简单的Markdown编辑器？——Dadealbit Markdown编辑器/img_020.gif)`
 * 就**不再是图片语法**，而是普通文字 —— 导入后正文里出现的就是那行字本身
 * （连文件名一起显示），一张图都没建出来；gif / jpg 一样，因为解析器在空格处就放弃了，
 * **压根没看文件**，跟文件类型、文件在不在、有没有复制漏都没关系。
 *
 * 更糟的是第二层：因为没建出图片节点，"🖼 有 N 张图片打不开 → 选导出文件夹修复"
 * 那条提示**也不会出现**（它只数 image 节点），于是用户在界面上无路可走。
 *
 * 实测（真编辑器 + 真文件夹，见 `.probe/probe-space-path-import.mjs`）：
 *   · 原样导入：图片 0 张，正文里出现字面 `![动图说明](assets/…/img_020.gif)`，无提示条
 *   · 空格换成 `%20`：图片 2 张 + 提示条出现 + 一键修复把这 2 张内嵌进文档
 * 所以这里就是"把用户手工能做的那步自动化"。
 *
 * ## 判据（对齐 CommonMark 行内链接语法，只改"目标"那一小段）
 *
 * · 只动 `](…)` 里的**目标**；**标题**（`"…"` / `'…'` / `(…)`）原样保留
 *   —— `![a](img.png "我的 标题")` 里那个空格是语法分隔符，绝不能转义
 * · 已经是 `<…>` 包起来的、以及已经 `%20` 的，一律不碰（避免二次编码）
 * · 代码块 / 行内代码里的一个字符都不许动（复用 `codeMask`）
 * · 转义方式是**逐字符百分号编码**：空格→`%20`、`(`→`%28`、`)`→`%29`、`<`→`%3C`、`>`→`%3E`
 *   —— 中文照旧可读（不做整串 encodeURI），而且下游"按文件名配图"时会先
 *   `decodeURIComponent`（见 editorActions.imageFileName），所以配对不受影响
 *
 * ⚠️ 不走整串 `encodeURI`：那会把 `assets/我的文章/img_1.jpg` 整条变成 `%E6%88%91…`，
 * 文件本身能对上，但用户在编辑器里、在导出的 .md 里再也读不出这是哪个文件夹了。
 */
import { codeMask } from './mathMarkdown'

/** 坏字符 → 百分号编码。只列**会破坏语法**的那几个，其余（含中文）一律不动 */
const ESCAPE_MAP: Record<string, string> = {
  ' ': '%20',
  '\t': '%09',
  '(': '%28',
  ')': '%29',
  '<': '%3C',
  '>': '%3E',
}

const NEEDS_ESCAPE = /[ \t()<>]/

const skipSpace = (md: string, i: number): number => {
  while (i < md.length && (md[i] === ' ' || md[i] === '\t')) i += 1
  return i
}

/**
 * 空格之后是不是"标题"（`"…"` / `'…'` / `(…)`）？
 * 是的话返回收尾 `)` 的下标，不是就返回 -1（说明这个空格属于路径本身）。
 *
 * 这是本模块唯一需要"猜"的地方：`](img.png "t")` 与 `](my img.png)` 在读到空格时长得一样。
 * 判据是标题必须**紧跟着收尾的 `)`** —— 实测两种都能判对（见 check:md-dest）。
 */
function titleEndAt(md: string, spaceAt: number): number {
  const t = skipSpace(md, spaceAt)
  const quote = md[t]
  if (quote === '"' || quote === "'") {
    const close = md.indexOf(quote, t + 1)
    if (close < 0) return -1
    const after = skipSpace(md, close + 1)
    return md[after] === ')' ? after : -1
  }
  if (quote === '(') {
    const close = md.indexOf(')', t + 1)
    if (close < 0) return -1
    const after = skipSpace(md, close + 1)
    return md[after] === ')' ? after : -1
  }
  return -1
}

/**
 * 从 `(` 开始读一个行内目标。
 *   · `{ start, destEnd, linkEnd }`：目标是 `[start, destEnd)`，整段链接在 `linkEnd` 的 `)` 结束
 *   · `destEnd = -1`：目标已经是 `<…>` 形式（不许改，返回 start/linkEnd 只为跳过它）
 *   · `null`：这里根本不是合法的行内链接（跨行、没有收尾 `)` 等），一个字都别动
 */
function readInlineDestination(
  md: string,
  open: number,
): { start: number; destEnd: number; linkEnd: number } | null {
  let i = skipSpace(md, open + 1)
  if (md[i] === '<') {
    const close = md.indexOf('>', i + 1)
    if (close < 0) return null
    const after = skipSpace(md, close + 1)
    if (md[after] !== ')') return null
    return { start: i + 1, destEnd: -1, linkEnd: after }
  }
  const start = i
  let depth = 0
  while (i < md.length) {
    const c = md[i]
    if (c === '\\' && i + 1 < md.length) {
      i += 2
      continue
    }
    /* 行内链接的目标不跨行（跨行的标题语法罕见，遇到就整段放过，宁可不改也不猜） */
    if (c === '\n') return null
    if (c === '(') {
      depth += 1
      i += 1
      continue
    }
    if (c === ')') {
      if (depth === 0) return { start, destEnd: i, linkEnd: i }
      depth -= 1
      i += 1
      continue
    }
    if ((c === ' ' || c === '\t') && depth === 0) {
      const titleEnd = titleEndAt(md, i)
      if (titleEnd >= 0) return { start, destEnd: i, linkEnd: titleEnd }
      /* 不是标题 → 这个空格就是路径的一部分，继续往后读 */
      i += 1
      continue
    }
    i += 1
  }
  return null
}

/** 目标里有没有需要转义的字符（导出给测试和排查用） */
export function destinationNeedsEscape(dest: string): boolean {
  return NEEDS_ESCAPE.test(dest)
}

/**
 * 把 `](…)` 里"会破坏语法"的字符转义掉。返回**新字符串**；
 * 没有需要改的地方时原样返回（同一个引用，方便调用方做 no-op 判断）。
 */
export function escapeMarkdownDestinations(md: string): string {
  /* 快路径：根本没有 `](` 的文档（正文、代码、base64 图片那一大行）不值得为它建遮罩表 */
  if (!md.includes('](')) return md
  const mask = codeMask(md)
  const parts: string[] = []
  let copied = 0
  let i = 0
  while (i < md.length - 1) {
    if (md[i] === ']' && md[i + 1] === '(' && !mask[i]) {
      const r = readInlineDestination(md, i + 1)
      if (r && r.destEnd > r.start) {
        const dest = md.slice(r.start, r.destEnd)
        if (NEEDS_ESCAPE.test(dest)) {
          /* 先处理 `\ `（反斜杠转义的空格，语法上合法但下游按文件名配图时对不上），
             再编码剩下的裸字符。顺序不能反：先编码的话 `\ ` 会变成 `\%20`，
             而 markdown-it 会把 `\%` 还原成 `%`，路径就悄悄变了。 */
          const escaped = dest
            .replace(/\\([ \t()<>])/g, (_m, c: string) => ESCAPE_MAP[c])
            .replace(/[ \t()<>]/g, (c) => ESCAPE_MAP[c])
          parts.push(md.slice(copied, r.start), escaped)
          copied = r.destEnd
        }
        i = r.linkEnd + 1
        continue
      }
    }
    i += 1
  }
  if (!copied) return md
  parts.push(md.slice(copied))
  return parts.join('')
}
