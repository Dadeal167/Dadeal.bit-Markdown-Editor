import { useEffect, useMemo, useState } from 'react'
import type { Editor } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import DOMPurify from 'dompurify'
import { buildExportBody, buildStandaloneHtml, downloadBlob, downloadText, getMarkdown, readFileAsDataUrl } from '../editorActions'
import { editionBlockLabels, editionDocument, editionLabels, type Edition, type EditionBlockKind, type EditionFormat } from './editions'
import { checkExport } from './exportPreflight'
import { projectImportedImages } from '../localMarkdownFile'
import { resolveProjectAsset, type AssetScope } from '../workspace/documentAssets'
import { exportDiagrams } from '../mermaidDiagrams'
import { printPublicationCss, type PublicationLayout } from './publicationLayout'
import { exportZhihuMarkdown } from '../saveFormats'
import { useEscapeClose } from '../useEscapeClose'
import type { Typography } from '../typography'

export function EditionBlockPicker({ onPick, onClose }: { onPick(kind: EditionBlockKind): void; onClose(): void }) {
  useEscapeClose(true, onClose)
  return <div className="zh-modal-mask">
    <section className="zh-modal" role="dialog" aria-modal="true" aria-label="标记分版内容">
      <div className="zh-modal__head">标记分版内容<button className="zh-modal__close" type="button" aria-label="关闭" onClick={onClose}>✕</button></div>
      <div className="zh-modal__body"><p>选中正文时标记所选段落。光标未选中文字时，在当前位置之后插入空块。</p></div>
      <div className="zh-modal__footer">
        {(Object.keys(editionBlockLabels) as EditionBlockKind[]).map((kind) => <button key={kind} type="button"
          className="zh-btn-plain" onClick={() => onPick(kind)}>标记为{editionBlockLabels[kind]}</button>)}
      </div>
    </section>
  </div>
}

export interface EditionRequest { doc: PMNode; title: string; format?: EditionFormat; contents: boolean; assets?: AssetScope }

async function preparePreview(html: string, scope?: AssetScope) {
  const template = document.createElement('template')
  template.innerHTML = DOMPurify.sanitize(html, { FORBID_TAGS: ['iframe', 'form', 'style'], FORBID_ATTR: ['srcset'] })
  const assets = new Map<string, Promise<string | null>>()
  await Promise.all([...template.content.querySelectorAll('img')].map(async (image) => {
    const src = image.getAttribute('src') ?? ''
    if (!src || /^(?:data:image\/|https?:\/\/|\/\/)/i.test(src)) return
    if (!assets.has(src)) assets.set(src, (async () => {
      const file = scope && await resolveProjectAsset(scope, src)
      return file ? readFileAsDataUrl(file).catch(() => null) : null
    })())
    const url = await assets.get(src)
    if (url?.startsWith('data:image/')) image.src = url
    else image.replaceWith(document.createTextNode(`〔图片未找到${image.alt ? '：' + image.alt : ''}〕`))
  }))
  return exportDiagrams(template.innerHTML, 'html')
}

async function printEdition(title: string, filename: string, body: string, publication: PublicationLayout) {
  const section = document.createElement('section')
  section.className = 'zh-edition-print'
  const heading = document.createElement('h1')
  heading.textContent = title
  const content = document.createElement('div')
  content.className = 'zh-prose'
  content.innerHTML = body
  const style = document.createElement('style')
  style.media = 'print'
  style.textContent = printPublicationCss(publication, title)
  section.append(style, heading, content)
  const previousTitle = document.title
  document.body.append(section)
  try {
    await Promise.race([
      Promise.all([...content.querySelectorAll('img')].map((image) => image.decode().catch(() => {}))),
      new Promise<void>((resolve) => window.setTimeout(resolve, 2000)),
    ])
    document.title = filename
    document.body.dataset.editionPrinting = 'true'
    window.print()
  } finally {
    delete document.body.dataset.editionPrinting
    document.title = previousTitle
    section.remove()
  }
}

const editionDescriptions = {
  student: '保留题干和普通正文，移除提示、答案与解析。',
  teacher: '保留全文，并为提示、答案和解析加上标签。',
  zhihu: '保留全文，导出为适合在知乎导入的 Markdown。',
}
const formatLabels = { docx: 'Word（.docx）', pdf: 'PDF', plain: 'Markdown（.md）', zhihu: '知乎 Markdown（.md）' }

export default function EditionModal({ editor, request, publication, typography, onClose, onFeedback }: {
  editor: Editor; request: EditionRequest; publication: PublicationLayout; typography: Typography
  onClose(): void; onFeedback(text: string): void
}) {
  const initialFormat = request.format ?? 'docx'
  const [edition, setEdition] = useState<Edition>(initialFormat === 'zhihu' ? 'zhihu' : 'student')
  const [documentFormat, setDocumentFormat] = useState<'docx' | 'pdf' | 'plain'>(initialFormat === 'zhihu' ? 'docx' : initialFormat)
  const [preview, setPreview] = useState<{ doc: PMNode; body: string; failed: number }>()
  const [previewFailure, setPreviewFailure] = useState<PMNode>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const format = edition === 'zhihu' ? 'zhihu' : documentFormat
  const doc = useMemo(() => editionDocument(request.doc, edition), [edition, request.doc])
  const title = request.title.trim() || '未命名文档'
  const filename = `${title} - ${editionLabels[edition]}`
  const contentsTitle = request.contents ? title : undefined
  const ready = preview?.doc === doc ? preview : undefined
  const issues = useMemo(() => checkExport(editor, format === 'plain' ? 'docx' : format, doc), [doc, editor, format])
  const lostReference = edition === 'student' && issues.some((issue) => /引用失效$/.test(issue.name))
  const empty = doc.childCount === 1 && doc.firstChild?.type.name === 'paragraph' && !doc.firstChild.content.size
  const canExport = Boolean(ready) && !busy && !lostReference && !empty
  useEscapeClose(!busy, onClose)

  useEffect(() => {
    let current = true
    const html = buildExportBody(editor, 'document', contentsTitle, doc)
    void preparePreview(html, request.assets).then((result) => {
      if (current) setPreview({ doc, body: result.html, failed: result.failed })
    }).catch(() => { if (current) setPreviewFailure(doc) })
    return () => { current = false }
  }, [contentsTitle, doc, editor, request.assets])

  const previewHtml = ready ? buildStandaloneHtml(title, ready.body, typography).replace('<head>', `<head>
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data: https: http:">
    <style>html{color-scheme:light}body{background:#fff}</style>`) : ''

  const exportCurrent = async () => {
    if (!ready || !canExport) return
    setBusy(true)
    setError('')
    try {
      if (format === 'pdf') await printEdition(title, filename, ready.body, publication)
      else if (format === 'plain') {
        downloadText(filename + '.md', projectImportedImages(getMarkdown(editor, doc), false), 'text/markdown;charset=utf-8')
        onFeedback(`已导出「${filename}.md」。`)
      } else if (format === 'zhihu') {
        const result = await exportZhihuMarkdown(editor, title, { doc, filename, onPhase: (text) => { if (text) onFeedback(text) } })
        onFeedback(result.text)
      } else {
        const { buildWordDocument } = await import('./exportWord')
        const source = buildExportBody(editor, 'document', contentsTitle, doc)
        const { html, failed } = await exportDiagrams(source, 'docx')
        const scope = request.assets
        const result = await buildWordDocument(title, html, scope ? (src) => resolveProjectAsset(scope, src) : undefined, publication)
        downloadBlob(filename + '.docx', result.blob)
        const notes = [result.missingImages && `${result.missingImages} 张图片未嵌入`,
          result.formulaWarnings && `${result.formulaWarnings} 个公式需核对`, failed && `${failed} 个图表保留源码`].filter(Boolean)
        onFeedback(`已导出「${filename}.docx」。${notes.length ? notes.join('，') + '。' : ''}`)
      }
      onClose()
    } catch (reason) {
      console.error('[分版导出]', reason)
      setError('导出失败。请重试或选择其他格式。')
    }
    finally { setBusy(false) }
  }

  return <div className="zh-modal-mask">
    <section className="zh-modal zh-modal--source" role="dialog" aria-modal="true" aria-label="一稿多版">
      <div className="zh-modal__head">一稿多版
        <button className="zh-modal__close" type="button" aria-label="关闭" disabled={busy} onClick={onClose}>✕</button>
      </div>
      <div className="zh-modal__body">
        <div className="zh-edition-options">
          <label>版本 <select aria-label="版本" className="zh-input" value={edition} disabled={busy} autoFocus onChange={(event) => { setEdition(event.target.value as Edition); setError('') }}>
            {Object.entries(editionLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select></label>
          <label>格式 <select aria-label="格式" className="zh-input" value={format} disabled={busy || edition === 'zhihu'}
            onChange={(event) => setDocumentFormat(event.target.value as typeof documentFormat)}>
            {(edition === 'zhihu' ? ['zhihu'] as const : ['docx', 'pdf', 'plain'] as const).map((key) => <option key={key} value={key}>{formatLabels[key]}</option>)}
          </select></label>
        </div>
        <p className="zh-equations__hint">{editionDescriptions[edition]}</p>
        {previewFailure === doc ? <p role="alert">无法生成选中版本的预览。</p>
          : ready ? <iframe className="zh-edition-preview" title={`${editionLabels[edition]}预览`} sandbox="" srcDoc={previewHtml} />
          : <p role="status">正在生成预览…</p>}
        {ready && !busy && ready.failed > 0 && <p role="status">{ready.failed} 个图表以源码预览。</p>}
        {lostReference && <p role="alert">学生版中存在无法解析的引用。请把被引用的内容移回正文，或一并标记引用所在的段落。</p>}
        {empty && <p role="alert">所选版本没有正文内容。</p>}
        {issues.length > 0 && <details className="zh-edition-checks"><summary>导出检查（{issues.length} 项）</summary>
          <ul>{issues.map((issue, index) => <li key={index}>{issue.name}。{issue.detail}</li>)}</ul>
        </details>}
        {error && <p role="alert">{error}</p>}
      </div>
      <div className="zh-modal__footer">
        <button className="zh-btn-plain" type="button" disabled={busy} onClick={onClose}>返回原稿</button>
        <button className="zh-btn-solid" type="button" disabled={!canExport} onClick={() => void exportCurrent()}>
          {busy ? '正在导出…' : `导出${editionLabels[edition]}`}
        </button>
      </div>
    </section>
  </div>
}
