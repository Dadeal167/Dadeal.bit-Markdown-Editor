import { AlignmentType, Document, Footer, Header, Packer, PageNumber, Paragraph, TextRun } from 'docx'
import { htmlToContent, type HtmlImage } from 'docx/html'
import { sniffImage } from '../../../scripts/imageFormat.mjs'
import { publicationPresets, publicationText, type PublicationLayout } from './publicationLayout'

const MAX_IMAGE_HEIGHT = 660
const bodyFont = { ascii: 'Calibri', hAnsi: 'Calibri', eastAsia: '等线', cs: 'Calibri' }

async function wordImage(blob: Blob, maxWidth: number) {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  const format = sniffImage(bytes)
  const original = format?.ext === 'jpg' || (format?.ext === 'png' && !format.animated)
  const bitmap = await createImageBitmap(format && format.mime !== blob.type ? new Blob([blob], { type: format.mime }) : blob)
  try {
    const scale = Math.min(1, maxWidth / bitmap.width, MAX_IMAGE_HEIGHT / bitmap.height)
    const width = Math.max(1, Math.round(bitmap.width * scale))
    const height = Math.max(1, Math.round(bitmap.height * scale))
    if (original) return { data: bytes, width, height }

    const canvas = document.createElement('canvas')
    canvas.width = width * 2
    canvas.height = height * 2
    const context = canvas.getContext('2d')
    if (!context) throw new Error('无法转换图片')
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    return { data: canvas.toDataURL('image/png'), width, height }
  } finally {
    bitmap.close()
  }
}

async function readImage(src: string, localImage?: (src: string) => Promise<File | null>): Promise<Blob | null> {
  if (/^data:image\//i.test(src)) return (await fetch(src)).blob()
  if (/^https?:\/\/|^\/\//i.test(src)) {
    const response = await fetch(src.startsWith('//') ? 'https:' + src : src, {
      credentials: 'omit',
      signal: AbortSignal.timeout(5000),
    })
    return response.ok ? response.blob() : null
  }
  return localImage ? localImage(src) : null
}

function prepareWordFootnotes(body: DocumentFragment): void {
  const marks = new Map<string, string>()
  for (const link of body.querySelectorAll<HTMLAnchorElement>('a[role="doc-noteref"]')) {
    const destination = link.getAttribute('href') ?? ''
    const first = marks.get(destination)
    if (first) {
      link.removeAttribute('role')
      link.setAttribute('href', `#${first}`)
      continue
    }
    const bookmark = document.createElement('span')
    bookmark.id = `word-note-${marks.size + 1}`
    marks.set(destination, bookmark.id)
    const marker = link.closest('sup') ?? link
    marker.before(bookmark)
  }
  for (const section of body.querySelectorAll('.document-footnotes')) {
    const notes = [...section.querySelectorAll(':scope > [role="doc-footnote"]')]
    for (const note of notes) if (marks.has(`#${note.id}`)) note.firstElementChild?.remove()
    if (notes.length && notes.every((note) => marks.has(`#${note.id}`))) section.firstElementChild?.remove()
  }
}

export async function buildWordDocument(
  title: string,
  html: string,
  localImage?: (src: string) => Promise<File | null>,
  layout: PublicationLayout = publicationPresets.default,
) {
  const [widthMm, heightMm] = layout.paper === 'A4' ? [210, 297] : [215.9, 279.4]
  const maxImageWidth = Math.floor((widthMm - layout.left - layout.right) * 96 / 25.4 + 1e-6)
  const twips = (mm: number) => Math.round(mm * 1440 / 25.4)
  const template = document.createElement('template')
  template.innerHTML = html
  const body = template.content
  prepareWordFootnotes(body)
  const nav = body.firstElementChild?.matches('nav.document-contents') ? body.firstElementChild : null
  const heading = nav?.nextElementSibling ?? body.firstElementChild
  if (layout.chapterBreaks) [...body.children].filter((element) => element.matches('h1,h2')).slice(1)
    .forEach((element) => { (element as HTMLElement).style.breakBefore = 'page' })
  if (title && heading?.tagName === 'H1' && heading.textContent?.trim() === title) heading.remove()
  if (nav) {
    const entries = document.createDocumentFragment()
    entries.append(...nav.childNodes)
    nav.replaceWith(entries)
  }
  for (const caption of body.querySelectorAll('table > caption.zh-caption')) {
    const paragraph = document.createElement('p')
    paragraph.style.textAlign = 'center'
    paragraph.append(...caption.childNodes)
    caption.parentElement?.before(paragraph)
    caption.remove()
  }

  // 网页导出会附上播放器和原视频链接。Word 只保留可点击的链接。
  let videos = 0
  for (const frame of body.querySelectorAll('iframe')) {
    const container = frame.parentElement
    if (container?.childNodes.length === 1 && container.style.paddingTop) container.remove()
    else frame.remove()
    videos += 1
  }

  let missingImages = 0
  let formulaWarnings = 0
  for (const formula of body.querySelectorAll<HTMLElement>('.katex-error, span[title^="ParseError"]')) {
    formula.textContent = '〔公式无法转换〕'
    formulaWarnings += 1
  }
  for (const formula of body.querySelectorAll('math[display="block"]')) {
    const block = formula.closest('div')
    if (block) block.style.textAlign = 'center'
  }

  const bySrc = new Map<string, Awaited<ReturnType<typeof wordImage>> | null>()
  const images: Record<string, HtmlImage> = {}
  let imageIndex = 0
  for (const element of body.querySelectorAll('img')) {
    const src = element.getAttribute('src')?.trim() ?? ''
    if (!bySrc.has(src)) {
      try {
        const blob = src ? await readImage(src, localImage) : null
        bySrc.set(src, blob ? await wordImage(blob, maxImageWidth) : null)
      } catch {
        bySrc.set(src, null)
      }
    }
    const image = bySrc.get(src)
    if (!image) {
      const label = element.alt ? '〔图片未能嵌入：' + element.alt + '〕' : '〔图片未能嵌入〕'
      element.replaceWith(label)
      missingImages += 1
      continue
    }
    const key = 'embedded-image-' + imageIndex++
    images[key] = image.data
    const table = element.closest('table')
    const columns = table?.rows[0]?.cells.length || 1
    const scale = Math.min(1, maxImageWidth / columns / image.width)
    element.src = key
    element.setAttribute('width', String(Math.max(1, Math.round(image.width * scale))))
    element.setAttribute('height', String(Math.max(1, Math.round(image.height * scale))))
    const figure = element.closest('figure')
    const align = (figure ?? element).getAttribute('data-align')
    if (align === 'center' || align === 'right') {
      const block = figure ?? document.createElement('p')
      block.style.textAlign = align
      element.removeAttribute('style')
      if (!figure) {
        element.replaceWith(block)
        block.appendChild(element)
      }
    }
  }

  const children = htmlToContent(template.innerHTML, {
    images,
    maxImageWidth,
    stylesheet: `
      blockquote { margin-left: 18pt; }
      pre, code { font-family: Consolas; }
      pre { white-space: pre-wrap; background-color: #F1F3F5; margin: 8pt 0; }
      table { width: 100%; border-collapse: collapse; }
      td, th { border: 1px solid #A1AAB3; padding: 5pt 7pt; }
      th { background-color: #E9EDF1; text-align: left; }
      figcaption { text-align: center; font-size: 10pt; }
      .document-contents__title { font-size: 16pt; font-weight: bold; }
      .document-contents__item--h2 { margin-left: 16pt; }
      .document-contents__item--h3 { margin-left: 32pt; }
      hr { border: 0; border-bottom: 1px solid #A1AAB3; }
    `,
    onWarning: ({ code }) => {
      if (code === 'missing-image' || code === 'unsupported-image') missingImages += 1
      if (code === 'invalid-math') formulaWarnings += 1
    },
  })
  const header = publicationText(layout.header, title)
  const footer = publicationText(layout.footer, title)
  const marginLine = (text: string, number = false) => new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 0 },
    children: [new TextRun({ size: 18, font: bodyFont, children: number
      ? [text ? text + ' · 第 ' : '第 ', PageNumber.CURRENT, ' 页'] : [text] })],
  })
  const doc = new Document({
    title: title || undefined,
    styles: {
      default: {
        document: {
          run: { size: 22, color: '202124', font: bodyFont, language: { eastAsia: 'zh-CN' } },
          paragraph: { spacing: { after: 100, line: 276 } },
        },
        title: {
          run: { size: 42, bold: true, color: '000000', font: bodyFont },
          paragraph: { spacing: { after: 220 }, keepNext: true },
        },
        heading1: { run: { size: 34, bold: true, color: '000000', font: bodyFont } },
        heading2: { run: { size: 28, bold: true, color: '000000', font: bodyFont } },
        heading3: { run: { size: 24, bold: true, color: '000000', font: bodyFont } },
      },
    },
    sections: [{
      properties: { page: {
        size: { width: twips(widthMm), height: twips(heightMm) },
        margin: {
          top: twips(layout.top), bottom: twips(layout.bottom), left: twips(layout.left), right: twips(layout.right),
          ...(header ? { header: twips(Math.min(10, layout.top / 3)) } : {}),
          ...(footer || layout.numbers ? { footer: twips(Math.min(10, layout.bottom / 3)) } : {}),
        },
      } },
      ...(header ? { headers: { default: new Header({ children: [marginLine(header)] }) } } : {}),
      ...(footer || layout.numbers ? { footers: { default: new Footer({ children: [marginLine(footer, layout.numbers)] }) } } : {}),
      children: [
        ...(title ? [new Paragraph({ text: title, style: 'Title' })] : []),
        ...children,
      ],
    }],
  })
  return { blob: await Packer.toBlob(doc), missingImages, formulaWarnings, videos }
}
