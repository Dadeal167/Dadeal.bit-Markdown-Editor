import { useCallback, useSyncExternalStore } from 'react'
import type { Editor } from '@tiptap/core'
import { equationNumberText, indexEquations } from './math/equationIndex'
import { equationMarkup } from './math/equationSyntax'
import { useEscapeClose } from './useEscapeClose'

interface Props {
  editor: Editor
  automatic: boolean
  onToggle(value: boolean): void
  onInsert(pos: number): void
  onJump(pos: number): void
  onClose(): void
}

export default function EquationToolsModal({ editor, automatic, onToggle, onInsert, onJump, onClose }: Props) {
  useEscapeClose(true, onClose)
  const subscribe = useCallback((refresh: () => void) => {
    editor.on('transaction', refresh)
    return () => { editor.off('transaction', refresh) }
  }, [editor])
  const doc = useSyncExternalStore(subscribe, () => editor.state.doc)
  const index = indexEquations(doc, automatic)
  const items = index.entries.filter((entry) => entry.display && equationMarkup(entry.latex).core.trim())
  const missing = [...index.referenced].filter((name) => !index.byLabel.get(name)?.number)

  return (
    <div className="zh-modal-mask">
      <section className="zh-modal zh-modal--equations" role="dialog" aria-modal="true" aria-label="公式编号与引用">
        <div className="zh-modal__head">
          公式编号与引用
          <button type="button" className="zh-modal__close" aria-label="关闭公式编号与引用" onClick={onClose}>✕</button>
        </div>
        <div className="zh-modal__body">
          <label className="zh-equations__toggle">
            <input type="checkbox" checked={automatic} onChange={(event) => onToggle(event.target.checked)} autoFocus />
            自动编号当前文档的行间公式
          </label>
          <p className="zh-equations__hint">选择「插入引用」可在正文光标处插入编号。公式重新排序后，引用会自动更新。</p>
          {missing.length > 0 && (
            <p role="status" className="zh-equations__hint">无法解析的引用（{missing.length}）{missing.slice(0, 4).join('、')}</p>
          )}
          {items.length === 0 && <p className="zh-equations__hint">当前文档没有行间公式。</p>}
          <ul className="zh-equations__list">
            {items.map((entry) => {
              const duplicate = entry.label && index.byLabel.get(entry.label) === null
              const disabled = duplicate || (entry.suppressed && !entry.number)
              return (
                <li className="zh-equations__row" key={entry.pos}>
                  <button type="button" className="zh-equations__locate" onClick={() => onJump(entry.pos)}>
                    <span className="zh-equations__number">{entry.number
                      ? equationNumberText(entry.number, entry.parentheses) : '未编号'}</span>
                    <code title={entry.latex}>{equationMarkup(entry.latex).core.trim()}</code>
                    {entry.label && <small>{duplicate ? '重复标签 ' : ''}{entry.label}</small>}
                  </button>
                  <button type="button" className="zh-btn-plain" disabled={Boolean(disabled)} onClick={() => onInsert(entry.pos)}>
                    插入引用
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      </section>
    </div>
  )
}
