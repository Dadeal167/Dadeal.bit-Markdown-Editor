import type { Editor } from '@tiptap/core'
import { useCallback, useRef, useState, useSyncExternalStore, type DragEvent } from 'react'
import { gotoPos } from './editorActions'
import { canMoveChapter, chapterIndex, chapterKey, chapterSiblings, contentsEntries, moveChapter, toggleChapter, type Chapter } from './tiptap/chapters'

function useDocumentState(editor: Editor) {
  const subscribe = useCallback((refresh: () => void) => {
    editor.on('transaction', refresh)
    return () => { editor.off('transaction', refresh) }
  }, [editor])
  return useSyncExternalStore(subscribe, () => editor.state)
}

interface DropTarget { pos: number; side: 'before' | 'after' }

export default function ChapterOutline({ editor, includeContents, onContentsChange, onClose }: {
  editor: Editor
  includeContents: boolean
  onContentsChange(value: boolean): void
  onClose(): void
}) {
  const state = useDocumentState(editor)
  const { chapters } = chapterIndex(state.doc)
  const folded = chapterKey.getState(state)?.folded
  const panel = useRef<HTMLElement>(null)
  const drag = useRef<{ pos: number; doc: typeof state.doc } | null>(null)
  const [drop, setDrop] = useState<DropTarget | null>(null)
  const [live, setLive] = useState('')

  const dropTarget = (event: DragEvent, chapter: Chapter): DropTarget | null => {
    const source = drag.current
    if (!source || source.doc !== editor.state.doc) return null
    const bounds = event.currentTarget.getBoundingClientRect()
    const side = event.clientY < bounds.top + bounds.height / 2 ? 'before' : 'after'
    return canMoveChapter(source.doc, source.pos, chapter.pos, side) ? { pos: chapter.pos, side } : null
  }

  const move = (source: Chapter, target: Chapter, side: DropTarget['side'], direction?: 'up' | 'down') => {
    const next = moveChapter(editor, source.pos, target.pos, side)
    if (next === null) return
    setLive(`已将「${source.text}」移到「${target.text}」${side === 'before' ? '之前' : '之后'}。`)
    if (direction) requestAnimationFrame(() => {
      const row = panel.current?.querySelector(`[data-chapter-pos="${next}"]`)
      const targetButton = row?.querySelector<HTMLButtonElement>(`[data-direction="${direction}"]:not(:disabled)`)
        ?? row?.querySelector<HTMLButtonElement>('.zh-outline__item')
      targetButton?.focus()
    })
  }

  return (
    <aside className="zh-outline zh-outline--chapters" aria-label="大纲" ref={panel}>
      <div className="zh-outline__head">
        <span>大纲</span>
        <button type="button" className="zh-outline__close" aria-label="关闭大纲" onClick={onClose}>✕</button>
      </div>
      <label className="zh-outline__option">
        <input type="checkbox" checked={includeContents} onChange={(event) => onContentsChange(event.target.checked)} />
        导出时添加目录
      </label>
      <span className="zh-outline__announcement" role="status">{live}</span>
      {chapters.length === 0 && <p className="zh-outline__empty">当前文档没有标题。</p>}
      {chapters.map((chapter) => {
        const group = chapterSiblings(state.doc, chapter)
        const index = group.indexOf(chapter)
        const previous = group[index - 1]
        const next = group[index + 1]
        const collapsed = folded?.has(chapter.pos) ?? false
        const canFold = chapter.topLevel && chapter.end > chapter.body
        const destination = drop?.pos === chapter.pos ? drop.side : undefined
        return (
          <div className="zh-outline__row" key={chapter.id} data-chapter-pos={chapter.pos} data-drop={destination}
            onDragOver={(event) => {
              const target = dropTarget(event, chapter)
              if (target) {
                event.preventDefault()
                event.dataTransfer.dropEffect = 'move'
              }
              setDrop((last) => last?.pos === target?.pos && last?.side === target?.side ? last : target)
            }}
            onDragLeave={(event) => {
              if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setDrop(null)
            }}
            onDrop={(event) => {
              const target = dropTarget(event, chapter)
              const source = target && drag.current && chapterIndex(editor.state.doc).byPos.get(drag.current.pos)
              if (target && source) {
                event.preventDefault()
                move(source, chapter, target.side)
              }
              drag.current = null
              setDrop(null)
            }}>
            <button type="button" title={chapter.text} className={`zh-outline__item zh-outline__item--h${chapter.level}`}
              onClick={() => gotoPos(editor, chapter.pos)}>{chapter.text}</button>
            <div className="zh-outline__actions">
              {canFold && <button type="button" title={collapsed ? '展开章节' : '折叠章节'} aria-expanded={!collapsed}
                aria-label={`${collapsed ? '展开' : '折叠'} ${chapter.text}`} onClick={() => toggleChapter(editor, chapter.pos)}>
                {collapsed ? '▸' : '▾'}
              </button>}
              {group.length > 1 && <>
                <button type="button" title="上移章节" data-direction="up" aria-label={`上移 ${chapter.text}`} disabled={!previous}
                  onClick={() => previous && move(chapter, previous, 'before', 'up')}>↑</button>
                <button type="button" title="下移章节" data-direction="down" aria-label={`下移 ${chapter.text}`} disabled={!next}
                  onClick={() => next && move(chapter, next, 'after', 'down')}>↓</button>
                <span className="zh-outline__grip" title="拖动到同级章节之前或之后" aria-hidden="true" draggable
                  onDragStart={(event) => {
                    drag.current = { pos: chapter.pos, doc: editor.state.doc }
                    event.dataTransfer.setData('application/x-dadealbit-chapter', String(chapter.pos))
                    event.dataTransfer.effectAllowed = 'move'
                  }} onDragEnd={() => { drag.current = null; setDrop(null) }}>⠿</span>
              </>}
            </div>
          </div>
        )
      })}
    </aside>
  )
}

export function PrintContents({ editor, title }: { editor: Editor; title: string }) {
  const entries = contentsEntries(useDocumentState(editor).doc, title)
  if (!entries.length) return null
  return <nav className="document-contents document-contents--print" aria-label="目录">
    <p className="document-contents__title">目录</p>
    {entries.map((item) => <p className={`document-contents__item document-contents__item--h${item.level}`} key={item.id}>
      <a href={`#${item.id}`}>{item.text}</a>
    </p>)}
  </nav>
}
