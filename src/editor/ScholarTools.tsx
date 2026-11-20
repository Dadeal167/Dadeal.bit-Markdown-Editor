import { useRef, useState } from 'react'
import type { Editor } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import { BIB_LANGUAGE, parseBibTeX, SCHOLAR_KEY, STATEMENT_NAMES, type RefKind, type StatementKind } from './scholarIndex'
import { useScholarIndex } from './tiptap/ScholarNodes'
import { useEscapeClose } from './useEscapeClose'

export type ScholarTab = 'footnotes' | 'citations' | 'statements'

export default function ScholarTools({ editor, tab, onClose }: { editor: Editor; tab: ScholarTab; onClose(): void }) {
  useEscapeClose(true, onClose)
  const index = useScholarIndex(editor)
  const [feedback, setFeedback] = useState('')
  const [loading, setLoading] = useState(false)
  const [note, setNote] = useState('')
  const [key, setKey] = useState('')
  const [kind, setKind] = useState<StatementKind>('THEOREM')
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const bibInput = useRef<HTMLInputElement>(null)
  const titleText = tab === 'footnotes' ? '脚注' : tab === 'citations' ? '参考文献' : '数学结构块'

  const canInsertInline = () => {
    const { $from, $to } = editor.state.selection
    return $from.sameParent($to) && $from.parent.inlineContent && !$from.parent.type.spec.code
  }
  const insertRef = (kind: RefKind, key: string) => {
    if (!key || !canInsertInline()) { setFeedback('请先在正文段落中放置光标，再插入引用。'); return }
    if (editor.chain().focus().insertContent({ type: 'scholarReference', attrs: { kind, key } }).run()) onClose()
  }
  const insertNote = () => {
    if (!canInsertInline()) { setFeedback('请先在正文段落中放置光标，再插入脚注。'); return }
    let number = 1
    while (index.footnotes.has(`note-${number}`) || [...index.links.values()].some((link) => link.kind === 'footnote' && link.key === `note-${number}`)) number++
    const key = `note-${number}`
    const { schema } = editor.state
    const paragraphs = note.split(/\r?\n/).map((line) => schema.nodes.paragraph.create(null, line ? schema.text(line) : undefined))
    const definition = schema.nodes.footnoteDefinition.create({ key }, paragraphs)
    const { tr } = editor.state
    tr.replaceSelectionWith(schema.nodes.scholarReference.create({ kind: 'footnote', key }), false)
    const position = tr.doc.content.size
    tr.insert(position, definition)
    tr.setSelection(TextSelection.create(tr.doc, position + 2))
    editor.view.dispatch(tr.scrollIntoView())
    onClose()
    editor.commands.focus()
  }
  const importBib = async (file: File) => {
    const doc = editor.state.doc
    setLoading(true)
    try {
      const text = (await file.text()).trim()
      const parsed = parseBibTeX(text)
      if (parsed.error || !parsed.entries.length) { setFeedback(parsed.error || '文件中没有可引用的 BibTeX 条目。'); return }
      if (editor.isDestroyed || editor.state.doc !== doc) { setFeedback('文档内容已更新。请重新导入文件。'); return }
      const firstNew = parsed.entries.find((entry) => !index.library.has(entry.key))
      if (!firstNew) { setFeedback('这些引用键已存在于当前文档。'); return }
      editor.commands.insertContentAt(doc.content.size, { type: 'codeBlock', attrs: { language: BIB_LANGUAGE }, content: [{ type: 'text', text }] }, { updateSelection: false })
      setKey(firstNew.key)
      setFeedback(`已读取 ${parsed.entries.length} 条文献。相同引用键沿用先导入的条目。`)
    } catch { setFeedback('无法读取 BibTeX 文件。') }
    finally { setLoading(false) }
  }
  const insertStatement = () => {
    let number = 1
    const id = () => `${kind.toLowerCase()}-${number}`
    while (index.statements.has(id()) || [...index.links.values()].some((link) => link.kind === 'statement' && link.key === id())) number++
    const content = body.split(/\r?\n/).map((line) => ({ type: 'paragraph', content: line ? [{ type: 'text', text: line }] : [] }))
    if (editor.chain().focus().insertContent({ type: 'mathStatement', attrs: { kind, title: title.trim(), key: id() }, content }).run()) onClose()
  }

  return <div className="zh-modal-mask">
    <section className="zh-modal zh-modal--equations" role="dialog" aria-modal="true" aria-label={titleText}>
      <div className="zh-modal__head">{titleText}<button type="button" className="zh-modal__close" aria-label="关闭" onClick={onClose}>✕</button></div>
      <div className="zh-modal__body zh-scholar-form">
        {tab === 'footnotes' && <>
          <label>脚注内容<textarea className="zh-input" autoFocus value={note} onChange={(event) => setNote(event.target.value)} /></label>
          <button type="button" className="zh-btn-solid" onClick={insertNote}>插入脚注</button>
          {index.footnotes.size > 0 && <>
            <label>已有脚注<select className="zh-input" value={key} onChange={(event) => setKey(event.target.value)}>
              <option value="">选择脚注</option>
              {[...index.footnotes.values()].filter((target) => target !== null).map((target) =>
                <option key={target.key} value={target.key}>{target.label} · {target.key}</option>)}
            </select></label>
            <button type="button" className="zh-btn-plain" disabled={!key} onClick={() => insertRef('footnote', key)}>引用已有脚注</button>
          </>}
        </>}
        {tab === 'citations' && <>
          <button type="button" className="zh-btn-plain" disabled={loading} onClick={() => bibInput.current?.click()}>{loading ? '正在读取…' : '导入 BibTeX 文件'}</button>
          <input type="file" ref={bibInput} accept=".bib" hidden onChange={(event) => {
            const file = event.currentTarget.files?.[0]
            event.currentTarget.value = ''
            if (file) void importBib(file)
          }} />
          <label>文献<select className="zh-input" value={key} onChange={(event) => setKey(event.target.value)}>
            <option value="">选择文献</option>
            {[...index.library.values()].map((entry) => <option key={entry.key} value={entry.key}>{entry.key} · {entry.title}</option>)}
          </select></label>
          <button type="button" className="zh-btn-solid" disabled={!SCHOLAR_KEY.test(key)} onClick={() => insertRef('citation', key)}>插入文内引文</button>
        </>}
        {tab === 'statements' && <>
          <label>类型<select className="zh-input" value={kind} onChange={(event) => setKind(event.target.value as StatementKind)}>
            {Object.entries(STATEMENT_NAMES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select></label>
          <label>标题<input className="zh-input" value={title} onChange={(event) => setTitle(event.target.value)} /></label>
          <label>正文<textarea className="zh-input" value={body} onChange={(event) => setBody(event.target.value)} /></label>
          <button type="button" className="zh-btn-solid" onClick={insertStatement}>插入结构块</button>
          {index.statements.size > 0 && <>
            <label>已有结构块<select className="zh-input" value={key} onChange={(event) => setKey(event.target.value)}>
              <option value="">选择结构块</option>
              {[...index.statements.values()].filter((target) => target !== null).map((target) =>
                <option key={target.key} value={target.key}>{target.label} {target.title}</option>)}
            </select></label>
            <button type="button" className="zh-btn-plain" disabled={!key} onClick={() => insertRef('statement', key)}>插入结构块引用</button>
          </>}
        </>}
        {feedback && <p role="status">{feedback}</p>}
      </div>
    </section>
  </div>
}
