import type { Editor } from '@tiptap/core'
import { NodeSelection } from '@tiptap/pm/state'
import katex from 'katex'
import { toEmbedUrl } from './tiptap/VideoNode'
import { escapeTablePipes } from './tiptap/tableMarkdown'
import { finalizeMarkdown, protectMathSpans, repairMathInMarkdown } from './tiptap/mathMarkdown'
import { repairLatex, rendersOk } from './math/latexRepair'
import { convertRawMath, countRawMath } from './math/rawMathText'
import { stripExporterHeader } from './zhihuMarkdown'
import type { Typography } from './typography'

/** 正文里"还是原文的 $…$ 公式"：体检数量与一键转换（实现见 math/rawMathText.ts） */
export { convertRawMath, countRawMath }

/**
 * 光标停在文末时（例如文档最后一条是分割线），ProseMirror 给的是"选中了那个节点"的
 * NodeSelection——此时插入内容会把选中的节点**替换掉**（实测：插一个公式，分割线就没了）。
 * 插入前先把它收成普通光标，只追加、不删除。
 */
function collapseNodeSelection(editor: Editor): void {
  const { selection } = editor.state
  if (selection instanceof NodeSelection) {
    editor.commands.setTextSelection(selection.to)
  }
}

/* ============ 取 Markdown 源码 ============ */
export function getMarkdown(editor: Editor): string {
  const storage = editor.storage as unknown as { markdown?: { getMarkdown?: () => string } }
  const raw = storage.markdown?.getMarkdown?.() ?? ''
  // 1) 表格单元格里的竖线必须转义，否则存盘再打开会把表格切坏
  // 2) 公式标记换回 $…$，其余字面 $ 转义成 \$（否则"原价 $100，现价 $60"会被当成公式）
  // 3) 存之前把"渲染不出来"的公式按修好的写法写出去 —— 否则界面上显示是好的、
  //    存下来还是坏写法，拿别的软件打开就是 Invalid Mathematical Formula（实测用户踩到过）
  return finalizeMarkdown(escapeTablePipes(editor, repairMathInMarkdown(raw)))
}

export function setMarkdown(editor: Editor, md: string): { fixedMath: number } {
  // 顺序很重要：
  //   1) 一趟扫出公式：\$（公式外面）保护成占位符、$…$ / $$…$$ 整段换成占位符
  //      —— 否则 Markdown 解析器会先吃掉公式里的 * _ ` [ \\ 等记号
  //      （实测：$a*b*c$ 会变成 $a<em>b</em>c$，公式直接坏掉）
  //   2) 顺手把"写法坏了"的公式修好：很多导出工具会把公式里的反斜杠多写一层或少写一层
  //      （例如 `\left \\{ x \right \\}`、结尾多个 `\`），这种在编辑器里就是一行红字
  //   3) 解析完由 injectMathIntoDom 把占位符还原成数学节点
  const { md: protectedMd, spans } = protectMathSpans(stripExporterHeader(md))
  let fixedMath = 0
  for (const span of spans) {
    const fixed = repairLatex(span.latex, span.display)
    if (fixed !== span.latex) {
      span.latex = fixed
      fixedMath += 1
    }
  }
  editor.commands.setContent(protectedMd)
  // 4) 再把**节点里存着的**写法也修一遍：上面那步修的是"解析用的占位符"，
  //    而文档里存的 LaTeX 才是所有导出路径（HTML / PDF / 知乎 / 存盘）用的那份。
  //    以前屏幕上是修好的、导出却还是坏写法，就是这个缺口（用户截图：导出的 HTML 里出现
  //    `ParseError: KaTeX parse error …` 红框）。
  const healed = repairAllMath(editor)
  return { fixedMath: fixedMath + healed }
}

/* ============ 公式体检 / 一键修复 ============ */
function mathNodes(editor: Editor): { pos: number; latex: string; display: boolean }[] {
  const out: { pos: number; latex: string; display: boolean }[] = []
  editor.state.doc.descendants((node, pos) => {
    const name = node.type.name
    if (name !== 'mathInline' && name !== 'mathBlock') return
    out.push({ pos, latex: String(node.attrs.latex ?? ''), display: name === 'mathBlock' })
  })
  return out
}

/** 文档里所有公式（按出现顺序，给"通用 .md"把公式换成图片用）
 *
 *  这里返回的是 repairLatex 之后的写法 —— 和界面上看到的一致
 *  （界面上渲染时也是先修再渲染）。否则文件里会出现"图片是红的错误公式、
 *  但 alt 里是修好的原文"这种自相矛盾的结果。 */
export function listMath(editor: Editor): { latex: string; display: boolean }[] {
  return mathNodes(editor).map((m) => ({ latex: repairLatex(m.latex, m.display), display: m.display }))
}

/** 还有几个公式渲染不出来（修过之后仍然不行的，才算"坏了"） */
export function countBrokenMath(editor: Editor): number {
  let n = 0
  for (const m of mathNodes(editor)) {
    if (!m.latex.trim()) continue
    if (!rendersOk(repairLatex(m.latex, m.display), m.display)) n += 1
  }
  return n
}

/** 把文档里写法有问题的公式逐个修好（用于修早先存下来的旧文档），返回修好的个数 */
export function repairAllMath(editor: Editor): number {
  const targets = mathNodes(editor)
    .map((m) => ({ ...m, fixed: repairLatex(m.latex, m.display) }))
    .filter((m) => m.fixed !== m.latex)
  if (!targets.length) return 0
  const { tr } = editor.state
  for (const t of targets) {
    const node = tr.doc.nodeAt(t.pos)
    if (node) tr.setNodeMarkup(t.pos, undefined, { ...node.attrs, latex: t.fixed })
  }
  editor.view.dispatch(tr)
  return targets.length
}

/* ============ 基础排版 ============ */
export const undo = (e: Editor) => e.chain().focus().undo().run()
export const redo = (e: Editor) => e.chain().focus().redo().run()
export const clearFormat = (e: Editor) => e.chain().focus().unsetAllMarks().clearNodes().run()
export const toggleBold = (e: Editor) => e.chain().focus().toggleBold().run()
export const toggleItalic = (e: Editor) => e.chain().focus().toggleItalic().run()
export const setHeading = (e: Editor, level: 1 | 2 | 3) => e.chain().focus().toggleHeading({ level }).run()
export const setParagraph = (e: Editor) => e.chain().focus().setParagraph().run()
export const toggleList = (e: Editor) => e.chain().focus().toggleBulletList().run()
export const toggleOrderedList = (e: Editor) => e.chain().focus().toggleOrderedList().run()
export const toggleQuote = (e: Editor) => e.chain().focus().toggleBlockquote().run()
export const insertHr = (e: Editor) => e.chain().focus().setHorizontalRule().run()
export const toggleCodeBlock = (e: Editor) => e.chain().focus().toggleCodeBlock().run()

/* ============ 插入类 ============ */
export function insertTable(editor: Editor, rows: number, cols: number): void {
  collapseNodeSelection(editor)
  editor.chain().focus().insertTable({ rows, cols, withHeaderRow: true }).run()
}

export function insertImage(editor: Editor, src: string, alt = ''): void {
  collapseNodeSelection(editor)
  editor.chain().focus().setImage({ src, alt }).run()
}

export function insertLink(editor: Editor, text: string, href: string): void {
  collapseNodeSelection(editor)
  const { from, to } = editor.state.selection
  if (from !== to) {
    editor.chain().focus().extendMarkRange('link').setLink({ href }).run()
    return
  }
  editor
    .chain()
    .focus()
    .insertContent({
      type: 'text',
      text: text || href,
      marks: [{ type: 'link', attrs: { href } }],
    })
    .run()
}

export function insertMathInline(editor: Editor, latex: string): void {
  collapseNodeSelection(editor)
  editor.chain().focus().insertMathInline(latex).run()
}

export function insertMathBlock(editor: Editor, latex: string): void {
  collapseNodeSelection(editor)
  editor.chain().focus().insertMathBlock(latex).run()
}

export function updateMathAt(editor: Editor, pos: number, latex: string): void {
  editor.chain().focus().updateMathAt(pos, latex).run()
}

/** 插入视频：支持 B 站（BV/av 号）与 YouTube 链接 */
export function insertVideo(editor: Editor, input: string): boolean {
  const embed = toEmbedUrl(input)
  if (!embed) return false
  collapseNodeSelection(editor)
  editor
    .chain()
    .focus()
    .insertContent({ type: 'videoEmbed', attrs: { src: embed.src, kind: embed.kind } })
    .run()
  return true
}

/* ============ 公式防呆提示（温和的橙色提醒，绝不报错） ============ */
export function friendlyMathHint(latex: string): string | null {
  const t = latex.trim()
  if (!t) return '还没有输入内容，在中间的填空区点一下就能开始写'
  if (/\\frac\s*\{\s*\}\s*\{/.test(t)) return '分数的分子还是空的，点一下分子位置填上内容'
  if (/\\frac\s*\{[^{}]*\}\s*\{\s*\}/.test(t)) return '分母还是空的，记得补上分母（分母不能为 0）'
  const open = (t.match(/\{/g) ?? []).length
  const close = (t.match(/\}/g) ?? []).length
  if (open !== close) return '有一处花括号没配对，检查一下是否成对'
  if (/[+\-*/]\s*$/.test(t)) return '末尾的运算符后面还没写内容'
  return null
}

/* ============ 表格结构编辑（光标在表格里时生效） ============ */
export function addRowBefore(e: Editor): void {
  e.chain().focus().addRowBefore().run()
}

export function addRowAfter(e: Editor): void {
  e.chain().focus().addRowAfter().run()
}

export function addColumnBefore(e: Editor): void {
  e.chain().focus().addColumnBefore().run()
}

export function addColumnAfter(e: Editor): void {
  e.chain().focus().addColumnAfter().run()
}

export function deleteRow(e: Editor): void {
  e.chain().focus().deleteRow().run()
}

export function deleteColumn(e: Editor): void {
  e.chain().focus().deleteColumn().run()
}

export function mergeCells(e: Editor): void {
  e.chain().focus().mergeCells().run()
}

export function splitCell(e: Editor): void {
  e.chain().focus().splitCell().run()
}

export function deleteTable(e: Editor): void {
  e.chain().focus().deleteTable().run()
}

/** 当前表格的 DOM 元素（用来定位浮动操作条） */
export function currentTableElement(editor: Editor): HTMLTableElement | null {
  if (!editor.isActive('table')) return null
  try {
    const at = editor.view.domAtPos(editor.state.selection.from)
    const node = at.node as Node
    const el = node.nodeType === 1 ? (node as HTMLElement) : node.parentElement
    return el?.closest('table') ?? null
  } catch {
    return null
  }
}

/** 表格规模（几行几列） */
export function tableSize(editor: Editor): { rows: number; cols: number } {
  const table = currentTableElement(editor)
  if (!table) return { rows: 0, cols: 0 }
  const rows = table.querySelectorAll('tr').length
  const cols = table.querySelector('tr')?.children.length ?? 0
  return { rows, cols }
}

/* ============ 大纲导航 ============ */
export function getOutline(editor: Editor): { level: number; text: string; pos: number }[] {
  const out: { level: number; text: string; pos: number }[] = []
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === 'heading') {
      out.push({ level: Number(node.attrs.level ?? 1), text: node.textContent || '（空标题）', pos })
    }
  })
  return out
}

export function gotoPos(editor: Editor, pos: number): void {
  editor.chain().focus().setTextSelection(pos + 1).scrollIntoView().run()
}

/* ============ 文件读写（浏览器可用形态：选择文件 / 触发另存为） ============ */
export function pickFile(accept: string, onFile: (file: File) => void): void {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = accept
  input.onchange = () => {
    const f = input.files?.[0]
    if (f) onFile(f)
  }
  input.click()
}

export function readFileAsText(file: File): Promise<string> {
  return file.text()
}

export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

/* ============ 图片：自动压缩后再内嵌（不打包桌面壳时，这是唯一能控制 .md 体积的办法） ============ */
export const MAX_IMAGE_FILE = 12 * 1024 * 1024 // 原文件上限 12MB
const IMAGE_MAX_EDGE = 1600 // 长边缩到 1600px
const JPEG_QUALITY = 0.85
const SMALL_FILE_BYTES = 400 * 1024 // 小图不动
const KEEP_PNG_CHARS = 1200 * 1024 // 缩放后 PNG 仍小于这个体积（data URL 字符数）就保留 PNG 无损

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('图片解码失败'))
    img.src = src
  })
}

/**
 * 把选中的图片处理成可直接内嵌的 data URL：
 * 小图原样；大图等比缩到长边 1600px；PNG 缩放后仍然偏大就转 JPEG。
 */
export async function prepareImageDataUrl(file: File): Promise<string> {
  const original = await readFileAsDataUrl(file)
  if (file.size <= SMALL_FILE_BYTES) return original
  try {
    const img = await loadImage(original)
    const scale = Math.min(1, IMAGE_MAX_EDGE / Math.max(img.width, img.height))
    const width = Math.max(1, Math.round(img.width * scale))
    const height = Math.max(1, Math.round(img.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) return original
    ctx.drawImage(img, 0, 0, width, height)
    if (file.type === 'image/png') {
      const png = canvas.toDataURL('image/png')
      if (png.length <= KEEP_PNG_CHARS) return png
    }
    const jpeg = canvas.toDataURL('image/jpeg', JPEG_QUALITY)
    return jpeg.length < original.length ? jpeg : original
  } catch {
    return original
  }
}

/* ============================================================
 * 图片：把"打不开的图片"修好
 *
 * 为什么会出现打不开：很多导出工具（包括知乎导出、以及各种"网页转 Markdown"工具）
 * 会把图片存成旁边的 assets/xxx.jpg，正文里写相对路径。而编辑器是一个单独打开的
 * 本地网页，浏览器出于安全限制**不允许它去读旁边的文件夹**，所以图片一定是裂的。
 * 修法：让用户把那个导出文件夹（或几张图片）选进来，按文件名对上，压缩后内嵌成 data URL。
 * ============================================================ */

export interface BrokenImage {
  pos: number
  src: string
  name: string
}

export interface EmbedResult {
  /** 成功内嵌的张数 */
  fixed: number
  /** 在选中的文件里没找到的图片名 */
  missing: string[]
  /** 文件太大（超过 12MB）跳过的 */
  skipped: string[]
}

/** 从 src 里取出文件名（去掉路径、查询串、URL 编码） */
export function imageFileName(src: string): string {
  let s = src.split(/[?#]/)[0]
  try {
    s = decodeURIComponent(s)
  } catch {
    /* 编码坏了就按原样比 */
  }
  const parts = s.split(/[\\/]/)
  return (parts[parts.length - 1] || '').toLowerCase()
}

/** 文档里"打不开"的图片：src 既不是网址也不是内嵌数据，而是本地相对路径 */
export function collectBrokenImages(editor: Editor): BrokenImage[] {
  const out: BrokenImage[] = []
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name !== 'image') return
    const src = String(node.attrs.src ?? '')
    if (!src || /^(https?:|data:|blob:)/i.test(src)) return
    out.push({ pos, src, name: imageFileName(src) })
  })
  return out
}

/** 同名文件有多张时，优先选路径能对上的那张（选整个文件夹时会带 webkitRelativePath） */
function matchFile(list: File[], src: string): File | null {
  if (!list.length) return null
  if (list.length === 1) return list[0]
  let s = src.split(/[?#]/)[0]
  try {
    s = decodeURIComponent(s)
  } catch {
    /* 忽略 */
  }
  s = s.replace(/^\.\//, '')
  const hit = list.find((f) => {
    const rel = (f as File & { webkitRelativePath?: string }).webkitRelativePath
    return rel ? rel.endsWith(s) : false
  })
  return hit ?? list[0]
}

/**
 * 把用户选的图片（可以整个文件夹一起选）按文件名配到文档里，替换掉打不开的相对路径。
 * 图片会先压缩再以 data URL 内嵌，这样以后关掉浏览器、换台电脑打开都还在。
 */
export async function embedImages(editor: Editor, files: File[]): Promise<EmbedResult> {
  const pool = new Map<string, File[]>()
  for (const f of files) {
    if (f.type && !f.type.startsWith('image/')) continue
    const key = f.name.toLowerCase()
    const list = pool.get(key)
    if (list) list.push(f)
    else pool.set(key, [f])
  }

  const missing: string[] = []
  const skipped: string[] = []
  const updates: { pos: number; src: string }[] = []

  for (const broken of collectBrokenImages(editor)) {
    const file = matchFile(pool.get(broken.name) ?? [], broken.src)
    if (!file) {
      missing.push(broken.name)
      continue
    }
    if (file.size > MAX_IMAGE_FILE) {
      skipped.push(file.name)
      continue
    }
    updates.push({ pos: broken.pos, src: await prepareImageDataUrl(file) })
  }

  if (updates.length) {
    // 收集位置在前、改属性在后：setNodeMarkup 只换属性不改文档结构，位置不会漂
    const { tr } = editor.state
    for (const u of updates) {
      const node = tr.doc.nodeAt(u.pos)
      if (node && node.type.name === 'image') {
        tr.setNodeMarkup(u.pos, undefined, { ...node.attrs, src: u.src })
      }
    }
    editor.view.dispatch(tr)
  }

  return { fixed: updates.length, missing, skipped }
}

/** 选文件（可选多选 / 选整个文件夹） */
export function pickFiles(
  opts: { accept: string; multiple?: boolean; directory?: boolean },
  onFiles: (files: File[]) => void,
): void {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = opts.accept
  if (opts.multiple || opts.directory) input.multiple = true
  if (opts.directory) {
    // 非标准但 Chrome / Edge 都支持：选一个文件夹
    input.setAttribute('webkitdirectory', '')
    input.setAttribute('directory', '')
  }
  input.onchange = () => {
    const list = input.files ? Array.from(input.files) : []
    if (list.length) onFiles(list)
  }
  input.click()
}

export function downloadText(name: string, content: string, type: string): void {
  const blob = new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** 导出用：把公式渲染成浏览器原生 MathML（不依赖任何 CSS/字体，离线打开也正常显示） */
export function renderMathml(latex: string, display: boolean): string {
  if (!latex.trim()) return ''
  try {
    return katex.renderToString(latex, { throwOnError: false, displayMode: display, output: 'mathml' })
  } catch {
    return `<code>${latex}</code>`
  }
}

/**
 * 把编辑器 HTML 里的公式节点与视频节点替换成导出用的形态：
 * 公式 → MathML；视频 → iframe（NodeView 不会出现在 getHTML 里，只有 data 属性）
 */
export function buildExportBody(editor: Editor): string {
  const raw = editor.getHTML()
  const doc = new DOMParser().parseFromString(`<div id="__export_root">${raw}</div>`, 'text/html')
  const root = doc.getElementById('__export_root')
  if (!root) return raw

  // 导出前先按"修好的写法"渲染：文档里存的 LaTeX 可能是坏写法（例如 `\left { x \right }`
  // 少一个反斜杠）—— 屏幕上显示时会先修再渲染，导出这条路径以前**没修**，
  // 于是导出的 HTML/PDF 里出现 `ParseError: KaTeX parse error …` 红框（用户截图反馈过）。
  root.querySelectorAll('[data-math-inline]').forEach((el) => {
    const holder = doc.createElement('span')
    holder.innerHTML = renderMathml(repairLatex(el.getAttribute('data-latex') ?? '', false), false)
    el.replaceWith(holder)
  })
  root.querySelectorAll('[data-math-block]').forEach((el) => {
    const holder = doc.createElement('div')
    holder.setAttribute('style', 'margin:16px 0')
    holder.innerHTML = renderMathml(repairLatex(el.getAttribute('data-latex') ?? '', true), true)
    el.replaceWith(holder)
  })
  root.querySelectorAll('[data-video-src]').forEach((el) => {
    const frame = doc.createElement('div')
    frame.setAttribute('style', 'position:relative;width:100%;padding-top:56.25%;margin:16px 0')
    const iframe = doc.createElement('iframe')
    iframe.setAttribute('src', el.getAttribute('data-video-src') ?? '')
    iframe.setAttribute('allowfullscreen', 'true')
    iframe.setAttribute('style', 'position:absolute;inset:0;width:100%;height:100%;border:0')
    frame.appendChild(iframe)
    el.replaceWith(frame)
  })
  return root.innerHTML
}

/** 导出 HTML（公式为 MathML，无外部依赖，离线可看） */
export function buildStandaloneHtml(title: string, bodyHtml: string, typography?: Typography): string {
  const safe = title.replace(/</g, '&lt;')
  // 用户在应用里选的正文字号 / 字体，导出时一并带上，导出的文件排版一致
  const docFont = typography
    ? `${typography.size}px/1.8${typography.family ? ` ${typography.family}` : " -apple-system,'PingFang SC','Microsoft YaHei',sans-serif"}`
    : "16px/1.8 -apple-system,'PingFang SC','Microsoft YaHei',sans-serif"
  const h1 = typography ? `${(typography.size * 1.5).toFixed(1)}px` : '26px'
  const h2 = typography ? `${(typography.size * 1.31).toFixed(1)}px` : '21px'
  const h3 = typography ? `${(typography.size * 1.19).toFixed(1)}px` : '19px'
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>${safe}</title>
<style>
body{max-width:740px;margin:32px auto;padding:0 24px;font:${docFont};color:#191b1f}
h1{font-size:${h1}}h2{font-size:${h2}}h3{font-size:${h3}}
pre{background:#f6f6f6;padding:12px;border-radius:6px;overflow:auto}
blockquote{color:#8491a5;border-left:3px solid #d3d3d3;padding-left:12px}
img{max-width:100%}table{border-collapse:collapse}td,th{border:1px solid #ebeced;padding:6px 10px}
math{font-family:'Latin Modern Math','STIX Two Math','Cambria Math',serif}
</style>
</head>
<body>
<h1>${safe || '未命名文档'}</h1>
${bodyHtml}
</body>
</html>`
}

/** 导出 PDF：走浏览器打印（离线可用，打印样式只保留正文） */
export function printDocument(): void {
  window.print()
}

export function toggleFullscreen(): void {
  if (document.fullscreenElement) void document.exitFullscreen()
  else void document.documentElement.requestFullscreen()
}

export { toEmbedUrl }
