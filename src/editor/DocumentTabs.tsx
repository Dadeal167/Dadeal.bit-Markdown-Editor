import { useLayoutEffect, useRef } from 'react'
import type { KeyboardEvent } from 'react'

export interface OpenDocumentTab {
  id: string
  title: string
  pending: boolean
  description: string
}

export const documentTabId = (id: string) => 'zh-document-tab-' + encodeURIComponent(id)

interface Props {
  tabs: OpenDocumentTab[]
  currentId: string
  onSelect(id: string): boolean
  onClose(id: string): void
  onCreate(): void
}

export default function DocumentTabs({ tabs, currentId, onSelect, onClose, onCreate }: Props) {
  const list = useRef<HTMLDivElement>(null)
  const buttons = useRef(new Map<string, HTMLButtonElement>())
  const currentTitle = tabs.find((tab) => tab.id === currentId)?.title

  useLayoutEffect(() => {
    const strip = list.current
    const current = buttons.current.get(currentId)?.parentElement
    if (!strip || !current) return
    const bounds = strip.getBoundingClientRect()
    const target = current.getBoundingClientRect()
    if (target.left < bounds.left) strip.scrollLeft += target.left - bounds.left
    else if (target.right > bounds.right) strip.scrollLeft += target.right - bounds.right
  }, [currentId, currentTitle, tabs.length])

  const navigate = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const count = tabs.length
    const next = event.key === 'ArrowLeft' ? (index - 1 + count) % count
      : event.key === 'ArrowRight' ? (index + 1) % count
        : event.key === 'Home' ? 0 : event.key === 'End' ? count - 1 : undefined
    if (next === undefined) return
    event.preventDefault()
    const id = tabs[next].id
    if (onSelect(id)) buttons.current.get(id)?.focus({ preventScroll: true })
  }

  return <div className="zh-document-tabs">
    <div className="zh-document-tabs__list" role="tablist" aria-label="打开的文档" ref={list}>
      {tabs.map((tab, index) => {
        const current = currentId === tab.id
        return <div className="zh-document-tab" data-active={current || undefined} key={tab.id} role="presentation">
          <button type="button" role="tab" className="zh-document-tab__select" id={documentTabId(tab.id)}
            aria-controls="zh-document-panel" aria-selected={current} aria-description={tab.description}
            tabIndex={current ? 0 : -1} title={`${tab.title} · ${tab.description}`}
            ref={(button) => { if (button) buttons.current.set(tab.id, button); else buttons.current.delete(tab.id) }}
            onKeyDown={(event) => navigate(event, index)} onMouseDown={(event) => event.preventDefault()}
            onClick={() => onSelect(tab.id)}>
            {tab.pending && <span className="zh-document-tab__pending" aria-hidden="true" />}
            <span className="zh-document-tab__title">{tab.title}</span>
          </button>
          {tabs.length > 1 && <button type="button" className="zh-document-tab__close" aria-label={`关闭「${tab.title}」标签页`}
            title="关闭标签页" onMouseDown={(event) => event.preventDefault()} onClick={(event) => {
              const focused = event.currentTarget === document.activeElement
              onClose(tab.id)
              const nextFocus = tab.id === currentId ? tabs[index + 1]?.id ?? tabs[index - 1]?.id : currentId
              if (focused && nextFocus) buttons.current.get(nextFocus)?.focus({ preventScroll: true })
            }}>×</button>}
        </div>
      })}
    </div>
    <button type="button" className="zh-document-tab__add" title="新建文档标签页"
      aria-label="新建文档标签页" onMouseDown={(event) => event.preventDefault()} onClick={onCreate}>+</button>
  </div>
}
