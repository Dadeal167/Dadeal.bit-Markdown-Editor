/**
 * 导出「给知乎导入用的 Markdown」。
 *
 * 为什么不能直接把普通 .md 丢给知乎的「导入」：
 * 知乎的 Markdown 导入**不认 `$…$` 公式**（社区里通行的解法就是把公式换成知乎自己的
 * 公式标记，见 https://cloud.tencent.cn/developer/article/1610869 ）。知乎的公式本质是：
 *
 *   <img src="https://www.zhihu.com/equation?tex=<URL编码的LaTeX>" alt="LaTeX 原文" eeimg="1">
 *
 * 其中 eeimg=1 是行内公式、eeimg=2 是块级公式，知乎按 alt 读回 LaTeX 原文。
 * 所以这里做的事就是：把标准 Markdown 里的 `$…$` / `$$…$$` 换成这种图片标签，
 * 其余内容（标题、加粗、列表、引用、代码块、表格、图片）原样保留。
 */

import { codeMask } from './tiptap/mathMarkdown'

/** 单个公式 → 知乎的公式标记 */
export function formulaImgTag(latex: string, display: boolean): string {
  const encoded = encodeURIComponent(latex)
  const alt = latex
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
  return `<img src="https://www.zhihu.com/equation?tex=${encoded}" alt="${alt}" class="ee_img tr_noresize" eeimg="${display ? 2 : 1}">`
}

export interface ZhihuMarkdownResult {
  md: string
  /** 换成知乎公式标记的公式个数 */
  formulas: number
  /** 图片总数 */
  images: number
  /** 其中还是"本机图片"（data: 开头的内嵌图）的张数 —— 知乎导入可能抓不到 */
  localImages: number
}

/**
 * 收拾编辑器导出的两个小毛病，让知乎导入后排版正常：
 *  1. 独占一行的图片后面紧跟文字时，会被粘在同一行 → Markdown 里算作同一段
 *     （实测：`![图](…)本机图片：` 粘成一行，后面的表格也跟着粘上去，表格直接解析不出来）
 *  2. 表格前面必须空一行，否则不会当成表格
 */
export function normalizeBlocks(md: string): string {
  const out: string[] = []
  for (const line of md.split('\n')) {
    const isTableRow = /^\s*\|/.test(line)
    // 图片后面直接跟着非空白字符 → 断开（表格行除外：拆了表格就散架）
    const fixed = isTableRow ? line : line.replace(/(!\[[^\]]*\]\([^)\s]+\))(?=[^\s\n])/g, '$1\n\n')
    const prev = out.length > 0 ? out[out.length - 1] : ''
    const prevIsTableRow = /^\s*\|/.test(prev)
    if (isTableRow && !prevIsTableRow && prev.trim()) out.push('')
    out.push(...fixed.split('\n'))
  }
  return out.join('\n')
}

/**
 * 去掉"知乎导出工具"塞在文件开头的元数据。
 * 那些 `.md` 开头是：
 *     ---
 *     title: "…"
 *     author: "未知"
 *     date: 1970-01-01
 *     tags: [知乎备份]
 *     url: "https://zhuanlan.zhihu.com/p/…"
 *     ---
 * 它不是文章内容（在编辑器里还会变成一条分割线 + 一个大标题），导入和导出时都该扔掉。
 */
export function stripExporterHeader(md: string): string {
  const lines = md.split('\n')
  const isBlank = (l: string) => !l.trim()
  const isHr = (l: string) => /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(l)

  let i = 0
  while (i < lines.length && isBlank(lines[i])) i += 1
  let j = i
  if (isHr(lines[j] ?? '')) j += 1

  // 开头这一"段"（连续非空行）得**同时**出现 title: "…" 和 url: http… 才算元数据
  // （要求 url 带 http 是为了别误删正常正文里同时写了"标题："和"作者："的段落）
  const blockStart = j
  let k = j
  while (k < lines.length && !isBlank(lines[k])) k += 1
  const block = lines.slice(blockStart, k).join(' ')
  const looksMeta =
    /(^|\s)#*\s*title\s*[:：]\s*["“]/.test(block) &&
    /url\s*[:：]\s*["“<]?\s*https?:\/\//.test(block) &&
    /(tags\s*[:：]|author\s*[:：]|date\s*[:：])/.test(block)
  if (!looksMeta) return md

  j = k
  while (j < lines.length && (isBlank(lines[j]) || isHr(lines[j]))) j += 1
  return lines.slice(j).join('\n')
}

/** 把 Markdown 里的转义还原成真实字符（公式原文被存成 `\\frac`、`\_`、`\$` 这种） */
export function unescapeMarkdown(s: string): string {
  return s.replace(/\\([\\`*_{}[\]()#+\-.!|$<>~])/g, '$1')
}

/** 这段文字看着像不像 LaTeX 公式（用来救"没被识别成公式的原文"） */
function looksLikeFormula(s: string): boolean {
  const t = s.trim()
  if (!t || t.length > 800) return false
  // 必须有 LaTeX 命令（\frac \times \left …）或上下标/花括号，且不能像句子
  if (!/\\[a-zA-Z]+|[\^_{}]/.test(t)) return false
  if (/[。！？；：、“”‘’《》（）【】]/.test(t)) return false
  return true
}

/**
 * 把标准 Markdown 转成知乎导入友好的 Markdown。
 *
 * 两类公式都要认：
 *  1. 正常公式 `$…$` / `$$…$$`
 *  2. **被存成"正文"的公式原文**：文档里那两段公式以前粘坏过，是普通文字，
 *     存盘时字面 `$` 被转义成 `\$`、反斜杠被转义成 `\\`，于是变成
 *     `\$\frac…\$` 这种形态 —— 只要内容明显是 LaTeX，就照样转成公式标记，
 *     否则用户在知乎里看到的会是一堆反斜杠乱码。
 */
export function mdToZhihuMarkdown(input: string): ZhihuMarkdownResult {
  // 先把"导出工具塞的元数据开头"扔掉（那是 title/author/tags/url，不是正文）
  const md = stripExporterHeader(input)
  let out = ''
  let i = 0
  let formulas = 0
  // 代码块 / 行内代码里的 `$` 是代码，不转换
  const inCode = codeMask(md)

  while (i < md.length) {
    const ch = md[i]
    if (inCode[i]) {
      out += ch
      i += 1
      continue
    }
    // 转义的美元号 \$：可能是字面美元号，也可能是"公式原文"的开头
    if (ch === '\\' && md[i + 1] === '$') {
      const close = md.indexOf('\\$', i + 2)
      const lineEnd = md.indexOf('\n', i + 2)
      if (close > i && (lineEnd < 0 || close < lineEnd)) {
        const raw = md.slice(i + 2, close)
        if (looksLikeFormula(unescapeMarkdown(raw))) {
          out += formulaImgTag(unescapeMarkdown(raw).trim(), false)
          formulas += 1
          i = close + 2
          continue
        }
      }
      out += '\\$'
      i += 2
      continue
    }
    if (ch !== '$') {
      out += ch
      i += 1
      continue
    }
    // 块级公式 $$ … $$
    if (md.startsWith('$$', i)) {
      const end = md.indexOf('$$', i + 2)
      if (end > i) {
        const latex = md.slice(i + 2, end).trim()
        if (latex) {
          out += `\n\n${formulaImgTag(latex, true)}\n\n`
          formulas += 1
          i = end + 2
          continue
        }
      }
      out += '$$'
      i += 2
      continue
    }
    // 行内公式 $ … $（同一行内成对）
    const end = md.indexOf('$', i + 1)
    const lineEnd = md.indexOf('\n', i + 1)
    if (end > i && (lineEnd < 0 || end < lineEnd)) {
      const latex = md.slice(i + 1, end)
      if (latex.trim()) {
        out += formulaImgTag(latex.trim(), false)
        formulas += 1
        i = end + 1
        continue
      }
    }
    out += '$'
    i += 1
  }

  // 统计图片（![](...)），顺便看有多少是本机内嵌图
  let images = 0
  let localImages = 0
  for (const m of out.matchAll(/!\[[^\]]*\]\(([^)\s]+)/g)) {
    images += 1
    if (/^data:/i.test(m[1])) localImages += 1
  }

  return { md: normalizeBlocks(out), formulas, images, localImages }
}
