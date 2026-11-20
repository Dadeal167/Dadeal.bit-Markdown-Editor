import type { Editor } from '@tiptap/core'
import DOMPurify from 'dompurify'
import { headingMatches, workspaceHeadings, workspaceMarkdown } from './documentWorkspace'
import { renderMathml } from '../editorActions'
import { MACRO_LANGUAGE, markdownMacros } from '../math/documentMacros'
import { exportDiagrams } from '../mermaidDiagrams'
import { protectMathSpans, recoverEscapedMath } from '../tiptap/mathMarkdown'
import { escapeMarkdownDestinations } from '../tiptap/mdDestinations'
import { parseWikiLink } from '../tiptap/WikiLink'
import { looksLikeFormula } from '../zhihuMarkdown'

type AssetResolver = (src: string) => Promise<Blob | null>
export type SourceLinkCheck = (destination: string, wiki: boolean) => Promise<string | undefined>
export interface SourceIssue { line: number; text: string }

export async function renderSourcePreview(editor: Editor, source: string, resolveAsset?: AssetResolver) {
  const { markdown } = editor.storage as unknown as { markdown?: { parser: { parse(content: string): string } } }
  const macros = markdownMacros(source)
  const protectedSource = protectMathSpans(recoverEscapedMath(source, looksLikeFormula), macros)
  const raw = markdown?.parser.parse(escapeMarkdownDestinations(protectedSource.md)) ?? ''
  const tpl = document.createElement('template')
  tpl.innerHTML = DOMPurify.sanitize(raw, { FORBID_TAGS: ['style', 'iframe', 'form'], FORBID_ATTR: ['style', 'srcset', 'target'] })
  for (const math of tpl.content.querySelectorAll('[data-math-inline],[data-math-block]')) {
    math.innerHTML = DOMPurify.sanitize(renderMathml(math.getAttribute('data-latex') ?? '', math.hasAttribute('data-math-block'), macros))
  }
  for (const code of tpl.content.querySelectorAll('pre > code.language-' + MACRO_LANGUAGE)) code.parentElement?.remove()
  const statements = tpl.content.querySelectorAll<HTMLElement>('[data-scholar-statement]')
  for (const entry of statements) {
    const label = document.createElement('strong')
    label.textContent = entry.dataset.scholarTitle || ({ THEOREM: '定理', LEMMA: '引理', DEFINITION: '定义', EXAMPLE: '例题', PROOF: '证明' } as Record<string, string>)[entry.dataset.scholarStatement ?? '']
    entry.prepend(label)
  }
  for (const link of tpl.content.querySelectorAll('a')) link.removeAttribute('href')
  const assets = new Map<string, Promise<string | null>>()
  await Promise.all([...tpl.content.querySelectorAll('img')].map(async (img) => {
    const src = img.getAttribute('src') ?? ''
    if (!src || /^(?:data:image\/|https?:\/\/|\/\/)/i.test(src)) return
    let pending = assets.get(src)
    if (!pending) {
      pending = (async () => {
        const blob = await resolveAsset?.(src)
        if (!blob) return null
        return await new Promise<string | null>((resolve) => {
          const reader = new FileReader()
          reader.onload = () => resolve(String(reader.result))
          reader.onerror = () => resolve(null)
          reader.readAsDataURL(blob)
        })
      })()
      assets.set(src, pending)
    }
    const url = await pending.catch(() => null)
    if (url) img.src = url
    else img.removeAttribute('src')
  }))
  const body = (await exportDiagrams(tpl.innerHTML, 'html')).html
  const dark = document.documentElement.dataset.theme === 'dark'
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data: https: http:">
    <style>
      :root { color-scheme: ${dark ? 'dark' : 'light'}; }
      body { background: Canvas; color: CanvasText; font: 16px/1.72 system-ui, sans-serif; margin: 16px; overflow-wrap: anywhere; }
      img, svg, math { max-width: 100%; } figure { margin-inline: 0; }
      a, [data-wiki-link] { color: LinkText; }
      pre, code, blockquote, [data-scholar-statement] { background: color-mix(in srgb, CanvasText 6%, Canvas); }
      pre { overflow: auto; padding: .75em; } blockquote, [data-scholar-statement] { margin-inline: 0; padding: .4em .9em; }
      table { border-collapse: collapse; } th, td { border: 1px solid GrayText; padding: .25em .55em; }
      [data-math-block] { text-align: center; margin: 1em 0; overflow: auto; }
    </style><body>${body}</body></html>`
}

function tableCells(line: string) {
  const stripped = line.trim().replace(/^\|/, '').replace(/(?<!\\)(?:\\\\)*\|$/, (end) => end.slice(0, -1))
  return stripped.split(/(?<!\\)((?:\\\\)*)\|/).reduce<string[]>((cells, part, index, all) => {
    if (index % 2 === 0) cells.push((part + (all[index + 1] ?? '')).trim())
    return cells
  }, [])
}

export async function reviewSource(source: string, checkLink: SourceLinkCheck) {
  const lines = source.split('\n')
  const formatted = [...lines]
  const issues: SourceIssue[] = []
  const tokens = workspaceMarkdown.parse(escapeMarkdownDestinations(source), {})
  const headings = workspaceHeadings(source)
  let previous = 0
  for (const heading of headings) {
    if (heading.level > previous + 1) issues.push({ line: heading.line,
      text: previous ? `标题层级从 H${previous} 跳至 H${heading.level}。` : `首个标题为 H${heading.level}。` })
    previous = heading.level
  }
  const checks: Promise<SourceIssue | null>[] = []
  for (const token of tokens) {
    if (!token.map) continue
    const [start, end] = token.map
    if (token.type === 'table_open' && token.level === 0) {
      const rows = lines.slice(start, end).map(tableCells)
      const columns = rows[0].length
      if (rows.some((cells) => cells.length !== columns)) {
        issues.push({ line: start + 1, text: '表格的列数不一致，请核对各行的分隔符。' })
      } else {
        const normalized = rows.map((cells, index) => '| ' + cells.map((cell) => index === 1
          ? (cell.startsWith(':') ? ':' : '') + '---' + (cell.endsWith(':') ? ':' : '') : cell).join(' | ') + ' |')
        if (normalized.some((line, index) => line !== lines[start + index])) {
          issues.push({ line: start + 1, text: '可统一表格的分隔符、空格和对齐标记。' })
          formatted.splice(start, rows.length, ...normalized)
        }
      }
    }
    for (const item of token.children ?? []) {
      const wiki = item.type === 'wiki_link_open'
      const dest = wiki ? item.attrGet('data-wiki-link') : item.type === 'link_open' ? item.attrGet('href')
        : item.type === 'image' ? item.attrGet('src') : null
      if (!dest || /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(dest)) continue
      const link = wiki ? parseWikiLink(dest) : null
      if (dest.startsWith('#') || (link && !link.name)) {
        const fragment = link?.fragment ?? dest
        if (!headings.some((heading) => headingMatches(heading.text, fragment))) {
          issues.push({ line: start + 1, text: `找不到标题「${fragment.slice(1)}」。` })
        }
        continue
      }
      checks.push(checkLink(dest, wiki).then((text) => text ? { line: start + 1, text } : null))
    }
  }
  issues.push(...(await Promise.all(checks)).filter((item) => item !== null))
  return { issues: issues.sort((a, b) => a.line - b.line), formatted: formatted.join('\n') }
}
