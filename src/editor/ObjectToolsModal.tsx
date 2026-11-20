import { useCallback, useState, useSyncExternalStore } from 'react'
import type { Editor } from '@tiptap/core'
import { gotoDocumentNode, indexObjects, updateObjectCaption, type DocumentObject } from './tiptap/objectReferences'
import { objectName } from './tiptap/objectMarkup'
import { useEscapeClose } from './useEscapeClose'

export default function ObjectToolsModal({ editor, onClose }: { editor: Editor; onClose(): void }) {
  const [editing, setEditing] = useState<number | null>(null)
  const [caption, setCaption] = useState('')
  const subscribe = useCallback((refresh: () => void) => {
    editor.on('transaction', refresh)
    return () => { editor.off('transaction', refresh) }
  }, [editor])
  const doc = useSyncExternalStore(subscribe, () => editor.state.doc)
  const index = indexObjects(doc)
  const active = editing === null ? undefined : index.byPos.get(editing)
  const missing = index.references.filter((ref) => !index.byId.get(ref.id)).length
  useEscapeClose(true, () => active ? setEditing(null) : onClose())

  const edit = (item: DocumentObject) => {
    setCaption(item.caption)
    setEditing(item.pos)
  }
  const forward = (item: DocumentObject) => {
    onClose()
    gotoDocumentNode(editor, item.pos)
  }

  return (
    <div className="zh-modal-mask">
      <section className="zh-modal zh-modal--equations" role="dialog" aria-modal="true" aria-labelledby="zh-object-heading">
        <div className="zh-modal__head">
          <span id="zh-object-heading">图表题注与引用</span>
          <button type="button" className="zh-modal__close" aria-label="关闭" onClick={onClose} autoFocus>✕</button>
        </div>
        <div className="zh-modal__body">
          <p className="zh-equations__hint">保存题注或插入引用时，图片和表格会分别编号。调整图表顺序后，正文引用会自动更新。</p>
          {missing > 0 && <p role="status" className="zh-preflight__warning">{missing} 处图表引用已失效。可在「导出前检查」中定位。</p>}
          {index.items.length === 0 && <p className="zh-equations__hint">当前文档没有图片或表格。</p>}
          {active ? <form className="zh-object-form" onSubmit={(event) => {
            event.preventDefault()
            if (updateObjectCaption(editor, active.pos, caption.trim())) setEditing(null)
          }}>
            <label htmlFor="zh-object-caption">{active.number || active.title}的题注</label>
            <input id="zh-object-caption" className="zh-input" value={caption} onChange={(event) => setCaption(event.target.value)}
              placeholder="可留空，仅保留编号" autoFocus />
            <div className="zh-object-form__actions">
              {active.id && <button type="button" className="zh-btn-plain" onClick={() => {
                if (updateObjectCaption(editor, active.pos, null)) setEditing(null)
              }}>移除编号和题注</button>}
              <button type="button" className="zh-btn-plain" onClick={() => setEditing(null)}>取消</button>
              <button type="submit" className="zh-btn-solid">保存题注</button>
            </div>
          </form> : <ul className="zh-equations__list">
            {index.items.map((item) => (
              <li className="zh-equations__row zh-object-row" key={item.pos}>
                <button type="button" className="zh-equations__locate" title="在正文中定位" onClick={() => forward(item)}>
                  <span className="zh-equations__number">{item.number || `${objectName(item.kind)} · 未编号`}</span>
                  <small>{item.caption || item.title}</small>
                  {item.id && index.byId.get(item.id) === null && <small className="zh-preflight__warning">标识重复</small>}
                </button>
                <button type="button" className="zh-btn-plain" onClick={() => edit(item)}>编辑题注</button>
                <button type="button" className="zh-btn-plain" onClick={() => {
                  if (updateObjectCaption(editor, item.pos, item.caption, true)) onClose()
                }}>插入引用</button>
              </li>
            ))}
          </ul>}
        </div>
      </section>
    </div>
  )
}
