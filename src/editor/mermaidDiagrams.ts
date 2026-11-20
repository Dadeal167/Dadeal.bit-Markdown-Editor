import type { Node as PMNode } from '@tiptap/pm/model'
import DOMPurify from 'dompurify'

export const MERMAID_LANGUAGE = 'mermaid'
export const MERMAID_SAMPLE = 'flowchart TD\n  A[读取题目] --> B[列出已知条件]\n  B --> C[推导结论]'

interface Diagram { svg: string; width: number; height: number; alt: string }
type DiagramResult = { image: Diagram; error?: never } | { image?: never; error: string }

const results = new Map<string, Promise<DiagramResult>>()
const ready = new Map<string, DiagramResult>()
const listeners = new Map<string, Set<() => void>>()
let serial = 0

const engine = async () => {
  const { default: mermaid } = await import('mermaid')
  mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', htmlLabels: false,
    suppressErrorRendering: true, theme: 'default', fontFamily: 'system-ui, sans-serif',
    secure: ['secure', 'startOnLoad', 'securityLevel', 'maxTextSize', 'maxEdges', 'suppressErrorRendering', 'htmlLabels'],
  })
  return mermaid
}
let runningEngine: ReturnType<typeof engine> | undefined

async function render(source: string): Promise<DiagramResult> {
  if (!source.trim()) return { error: '请输入 Mermaid 图表代码。' }
  if (source.length > 50000) return { error: '图表代码过长。请拆分为多个图表。' }
  if (/\b(?:img|image)\s*:\s*["']|@import\b|^\s*(?:style|classDef|linkStyle|themeCSS)\b.*url\s*\(/im.test(source)) {
    return { error: '此图表包含外部图片或样式资源。请使用 Mermaid 的内置元素。' }
  }
  const host = document.createElement('div')
  Object.assign(host.style, { position: 'fixed', left: '-16000px', top: '0', width: '960px', visibility: 'hidden' })
  host.setAttribute('aria-hidden', 'true')
  document.body.append(host)
  try {
    const mermaid = await (runningEngine ??= engine())
    const { svg } = await mermaid.render(`dadealbit-diagram-${++serial}`, source, host)
    const documentSvg = new DOMParser().parseFromString(DOMPurify.sanitize(svg, {
      USE_PROFILES: { svg: true, svgFilters: true }, FORBID_TAGS: ['foreignObject', 'image', 'script'],
    }), 'image/svg+xml')
    const element = documentSvg.documentElement
    if (element.localName !== 'svg' || documentSvg.querySelector('parsererror')) throw new Error('未生成 SVG 图表。')
    for (const node of [element, ...element.querySelectorAll('*')]) {
      for (const attr of [...node.attributes]) {
        if ((attr.localName === 'href' && !attr.value.startsWith('#')) || /url\s*\(\s*(?!["']?#)/i.test(attr.value)) {
          node.removeAttributeNode(attr)
        }
      }
      if (node.localName === 'style') node.textContent = (node.textContent ?? '')
        .replace(/@import[^;]*;/gi, '').replace(/url\s*\(\s*(?!["']?#)[^)]*\)/gi, 'none')
    }
    const box = (element.getAttribute('viewBox') ?? '').trim().split(/\s+/).map(Number)
    const width = Math.ceil(box[2] || Number.parseFloat(element.getAttribute('width') ?? ''))
    const height = Math.ceil(box[3] || Number.parseFloat(element.getAttribute('height') ?? ''))
    if (!(width > 0 && height > 0)) throw new Error('无法确定图表尺寸。')
    element.setAttribute('width', String(width))
    element.setAttribute('height', String(height))
    element.removeAttribute('style')
    return { image: { svg: new XMLSerializer().serializeToString(element), width, height,
      alt: element.querySelector('title')?.textContent?.trim() || 'Mermaid 图表' } }
  } catch (error) {
    return { error: error instanceof Error ? error.message.split('\n').filter(Boolean).slice(0, 2).join(' ').slice(0, 240) : '无法渲染图表。' }
  } finally {
    host.remove()
  }
}

export function loadDiagram(source: string): Promise<DiagramResult> {
  const cached = results.get(source)
  if (cached) return cached
  if (results.size >= 48) {
    const oldest = [...results.keys()].find((key) => !listeners.has(key))
    if (oldest !== undefined) {
      results.delete(oldest)
      ready.delete(oldest)
    }
  }
  const pending = render(source).then((result) => {
    if (results.get(source) === pending) {
      ready.set(source, result)
      listeners.get(source)?.forEach((refresh) => refresh())
    }
    return result
  })
  results.set(source, pending)
  return pending
}

export function watchDiagram(source: string, listener: () => void): () => void {
  const group = listeners.get(source) ?? new Set()
  group.add(listener)
  listeners.set(source, group)
  return () => {
    group.delete(listener)
    if (!group.size) listeners.delete(source)
  }
}

export function diagramResult(source: string): DiagramResult | undefined {
  return ready.get(source)
}

export function diagramIssue(source: string): string | undefined {
  return ready.get(source)?.error
}

export function diagramUrl(image: Diagram): string {
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(image.svg)
}

async function rasterize(image: Diagram): Promise<string> {
  const preview = new Image()
  preview.src = diagramUrl(image)
  await preview.decode()
  const scale = Math.min(2, 2200 / Math.max(image.width, image.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(image.width * scale))
  canvas.height = Math.max(1, Math.round(image.height * scale))
  const context = canvas.getContext('2d')
  if (!context) throw new Error('无法导出图表图像。')
  context.fillStyle = '#fff'
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.drawImage(preview, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL('image/png')
}

export async function diagramPng(source: string): Promise<string | null> {
  const { image } = await loadDiagram(source)
  if (!image) return null
  try { return await rasterize(image) } catch { return null }
}

export function diagramsIn(doc: PMNode) {
  const diagrams: { pos: number; source: string }[] = []
  doc.descendants((node, pos) => {
    if (node.type.name === 'codeBlock' && node.attrs.language === MERMAID_LANGUAGE) diagrams.push({ pos, source: node.textContent })
  })
  return diagrams
}

export async function exportDiagrams(html: string, format: 'html' | 'docx'): Promise<{ html: string; failed: number }> {
  if (!html.includes('language-mermaid')) return { html, failed: 0 }
  const container = document.createElement('template')
  container.innerHTML = html
  const elements = [...container.content.querySelectorAll('pre > code.language-mermaid')]
  let failed = 0
  await Promise.all(elements.map(async (element) => {
    const diagram = (await loadDiagram(element.textContent ?? '')).image
    if (!diagram) { failed++; return }
    try {
      const figure = document.createElement('figure')
      figure.className = 'document-diagram'
      const image = document.createElement('img')
      image.alt = diagram.alt
      if (format === 'docx') {
        // Set the literal attribute so building the detached HTML doesn't decode a second image.
        image.setAttribute('src', await rasterize(diagram))
      } else image.setAttribute('src', diagramUrl(diagram))
      figure.append(image)
      element.parentElement?.replaceWith(figure)
    } catch { failed++ }
  }))
  return { html: container.innerHTML, failed }
}
