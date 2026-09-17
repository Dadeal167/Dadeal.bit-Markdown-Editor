import { useEffect, useRef } from 'react'
import type { Doc } from './documents'
import { docLabel } from './documents'

interface Props {
  docs: Doc[]
  currentId: string
  /** 由外部控制开合，好让快捷键也能打开它 */
  open: boolean
  onOpenChange(open: boolean): void
  onSwitch(id: string): void
  onCreate(): void
  onDelete(id: string): void
}

function relTime(at: number): string {
  const s = Math.max(1, Math.floor((Date.now() - at) / 1000))
  if (s < 60) return '刚刚'
  const m = Math.floor(s / 60)
  if (m < 60) return `${m} 分钟前`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} 小时前`
  return `${Math.floor(h / 24)} 天前`
}

/** 工具栏上的「文档」：新建 / 切换 / 删除 */
export default function DocMenu({
  docs,
  currentId,
  open,
  onOpenChange,
  onSwitch,
  onCreate,
  onDelete,
}: Props) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onOpenChange(false)
    }
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onOpenChange(false)
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', esc)
    }
  }, [open, onOpenChange])

  const current = docs.find((d) => d.id === currentId)

  return (
    <div className="zh-tb-wrap" ref={ref}>
      <button
        type="button"
        className={`zh-btn${open ? ' zh-btn--active' : ''}`}
        title={`我的文档（共 ${docs.length} 篇）`}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => onOpenChange(!open)}
      >
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H9l1.5 2h8A1.5 1.5 0 0 1 20 7.5v11A1.5 1.5 0 0 1 18.5 20h-13A1.5 1.5 0 0 1 4 18.5z" />
        </svg>
        <span className="zh-btn__label">文档</span>
      </button>

      {open && (
        <div className="zh-docmenu">
          <div className="zh-docmenu__head">
            <span>我的文档 · {docs.length} 篇</span>
            <button
              type="button"
              className="zh-docmenu__new"
              onClick={() => {
                onCreate()
                onOpenChange(false)
              }}
            >
              ＋ 新建
            </button>
          </div>

          <div className="zh-docmenu__list">
            {docs.map((d) => (
              <div key={d.id} className={`zh-docmenu__item${d.id === currentId ? ' zh-docmenu__item--active' : ''}`}>
                <button
                  type="button"
                  className="zh-docmenu__open"
                  title="切换到这这篇文档"
                  onClick={() => {
                    if (d.id !== currentId) onSwitch(d.id)
                    onOpenChange(false)
                  }}
                >
                  <span className="zh-docmenu__title">{docLabel(d)}</span>
                  <span className="zh-docmenu__time">
                    {d.id === currentId ? '正在编辑 · ' : ''}
                    {relTime(d.at)}
                  </span>
                </button>
                <button
                  type="button"
                  className="zh-docmenu__del"
                  title="删除这篇文档"
                  onClick={() => {
                    if (docs.length <= 1) {
                      window.alert('至少要留一篇文档')
                      return
                    }
                    const name = docLabel(d)
                    if (window.confirm(`删除「${name}」？删了就找不回来了。`)) onDelete(d.id)
                  }}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>

          <div className="zh-docmenu__foot">
            当前：{current ? docLabel(current) : '—'}　·　点标题可改名，自动保存
          </div>
        </div>
      )}
    </div>
  )
}
