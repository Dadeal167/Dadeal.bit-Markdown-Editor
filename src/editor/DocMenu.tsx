import { useEffect, useRef, useState } from 'react'
import type { Doc, DocVersion } from './documents'
import { docLabel } from './documents'
import { useAnchoredMenu } from './useAnchoredMenu'

interface Props {
  docs: Doc[]
  trashed: Doc[]
  currentId: string
  /** 由外部控制开合，好让快捷键也能打开它 */
  open: boolean
  onOpenChange(open: boolean): void
  onSwitch(id: string): void
  onCreate(): void
  onDelete(id: string): void
  onRestoreTrashed(id: string): string
  onSaveVersion(): string
  onRestoreVersion(version: DocVersion): string
  onCompareVersion?(version: DocVersion): void
  onBackup(): string
  onRestore(file: File): Promise<string>
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
  trashed,
  currentId,
  open,
  onOpenChange,
  onSwitch,
  onCreate,
  onDelete,
  onRestoreTrashed,
  onSaveVersion,
  onRestoreVersion,
  onCompareVersion,
  onBackup,
  onRestore,
}: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  useAnchoredMenu(open, ref, menu)
  const backupInput = useRef<HTMLInputElement>(null)
  const [restoring, setRestoring] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [section, setSection] = useState<'docs' | 'trash' | 'history'>('docs')
  const [selectedVersion, setSelectedVersion] = useState<DocVersion | null>(null)

  const backup = () => {
    try {
      setFeedback(onBackup())
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : '备份导出失败。')
    }
  }

  const restore = async (file: File) => {
    setRestoring(true)
    setFeedback('')
    try {
      setFeedback(await onRestore(file))
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : '无法恢复备份。')
    } finally {
      setRestoring(false)
    }
  }

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
        onClick={() => { setSection('docs'); setSelectedVersion(null); setFeedback(''); onOpenChange(!open) }}
      >
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H9l1.5 2h8A1.5 1.5 0 0 1 20 7.5v11A1.5 1.5 0 0 1 18.5 20h-13A1.5 1.5 0 0 1 4 18.5z" />
        </svg>
        <span className="zh-btn__label">文档</span>
      </button>

      {open && (
        <div className="zh-docmenu" ref={menu}>
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

          <div className="zh-docmenu__backup" role="group" aria-label="文档管理">
            <button type="button" aria-pressed={section === 'docs'} onClick={() => { setSection('docs'); setFeedback('') }}>全部文档</button>
            <button type="button" aria-pressed={section === 'trash'} onClick={() => { setSection('trash'); setFeedback('') }}>回收站（{trashed.length}）</button>
            <button type="button" aria-pressed={section === 'history'} onClick={() => {
              setSection('history'); setSelectedVersion(null); setFeedback('')
            }}>版本历史</button>
          </div>
          {section === 'docs' && <div className="zh-docmenu__list">
            {docs.map((d) => (
              <div key={d.id} className={`zh-docmenu__item${d.id === currentId ? ' zh-docmenu__item--active' : ''}`}>
                <button
                  type="button"
                  className="zh-docmenu__open"
                  title="切换到此文档"
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
                  title="移入回收站"
                  onClick={() => {
                    const name = docLabel(d)
                    if (window.confirm('将「' + name + '」移入回收站？')) onDelete(d.id)
                  }}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>}

          {section === 'trash' && <div className="zh-docmenu__list">
            {trashed.length === 0 && <div className="zh-docmenu__foot">回收站为空。</div>}
            {[...trashed].sort((a, b) => (b.trashedAt ?? 0) - (a.trashedAt ?? 0)).map((doc) => (
              <div className="zh-docmenu__item" key={doc.id}>
                <div className="zh-docmenu__open">
                  <span className="zh-docmenu__title">{docLabel(doc)}</span>
                  <span className="zh-docmenu__time">{new Date(doc.trashedAt ?? doc.at).toLocaleString()}</span>
                </div>
                <button type="button" className="zh-docmenu__new" onClick={() => setFeedback(onRestoreTrashed(doc.id))}>恢复</button>
              </div>
            ))}
          </div>}

          {section === 'history' && <div className="zh-docmenu__list">
            <div className="zh-docmenu__backup">
              <button type="button" onClick={() => setFeedback(onSaveVersion())}>保存当前版本</button>
            </div>
            {!current?.versions?.length && <div className="zh-docmenu__foot">当前文档暂无历史版本。</div>}
            {(current?.versions ?? []).map((version, index) => (
              <div className="zh-docmenu__item" key={index}>
                <button type="button" className="zh-docmenu__open" onClick={() => setSelectedVersion(version)}>
                  <span className="zh-docmenu__title">{docLabel({ ...version, id: currentId })}</span>
                  <span className="zh-docmenu__time">{new Date(version.at).toLocaleString()}</span>
                </button>
              </div>
            ))}
            {selectedVersion && current?.versions?.includes(selectedVersion) && (
              <div className="zh-docmenu__foot">
                <pre className="zh-docmenu__preview">{selectedVersion.md.slice(0, 480)}</pre>
                {onCompareVersion && <button type="button" className="zh-docmenu__new" onClick={() => onCompareVersion(selectedVersion)}>与当前文档对比</button>}
                <button type="button" className="zh-docmenu__new" onClick={() => {
                  setFeedback(onRestoreVersion(selectedVersion))
                  setSelectedVersion(null)
                }}>恢复此版本</button>
              </div>
            )}
          </div>}

          <div className="zh-docmenu__backup">
            <button type="button" disabled={restoring} onClick={backup}>备份全部文档</button>
            <button type="button" disabled={restoring} onClick={() => backupInput.current?.click()}>
              {restoring ? '正在恢复…' : '恢复备份'}
            </button>
            <input ref={backupInput} type="file" hidden accept=".json,application/json" onChange={(event) => {
              const file = event.currentTarget.files?.[0]
              event.currentTarget.value = ''
              if (file) void restore(file)
            }} />
          </div>
          {feedback && <div className="zh-docmenu__foot" role="status">{feedback}</div>}
          <div className="zh-docmenu__foot">
            当前：{current ? docLabel(current) : '—'}　·　标题与正文自动保存
          </div>
        </div>
      )}
    </div>
  )
}
