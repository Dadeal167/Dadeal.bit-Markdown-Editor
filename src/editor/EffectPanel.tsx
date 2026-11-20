import { Suspense, lazy, useEffect, useRef, useState } from 'react'
import { IconSpark } from './icons'
import { useAnchoredMenu } from './useAnchoredMenu'
import './effects/effectStyles.css'
import './effects/background/background.css'
import { loadLobbyOptions } from './effects/background/lobbySettings'
import { loadWritingPresets } from './effects/background/writingPresets'
import PointerSettings from './effects/pointer/PointerSettings'
import type { MouseEffectSettings } from './effects/mouseEffect'

const LobbyControls = lazy(() => import('./effects/background/LobbyControls'))

interface Props {
  documentId?: string
  open: boolean
  onOpenChange(open: boolean): void
  settings: MouseEffectSettings
  onChange(next: MouseEffectSettings): void
  onReset(): void
}

/** 工具栏「特效」按钮的下拉面板：档位 + 视觉表现 + 颜色 */
export default function EffectPanel({ documentId, open, onOpenChange, settings, onChange, onReset }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  useAnchoredMenu(open, ref, panel)

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

  const [lobbyMounted, setLobbyMounted] = useState(() => loadLobbyOptions().enabled)
  useEffect(() => {
    if (open || (documentId && loadWritingPresets().bindings[documentId])) setLobbyMounted(true)
  }, [documentId, open])
  const [page, setPage] = useState<'background' | 'pointer'>('background')
  const showPage = (next: typeof page) => {
    if (next === page) return
    if (panel.current) panel.current.scrollTop = 0
    setPage(next)
  }

  return (
    <div className="zh-tb-wrap" ref={ref}>
      <button
        type="button"
        className={`zh-btn${open ? ' zh-btn--active' : ''}`}
        title="特效"
        aria-expanded={open}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => onOpenChange(!open)}
      >
        <IconSpark />
        <span className="zh-btn__label">特效</span>
      </button>

      <div ref={panel} className="zh-fx" hidden={!open}>
        {open && <div className="zh-fx__pages" role="group" aria-label="特效设置">
          <button type="button" aria-pressed={page === 'background'} onClick={() => showPage('background')}>背景</button>
          <button type="button" aria-pressed={page === 'pointer'} onClick={() => showPage('pointer')}>鼠标</button>
        </div>}
        <div className="zh-fx__page" hidden={!open || page !== 'background'}>
          {(open || lobbyMounted) && <Suspense fallback={null}><LobbyControls documentId={documentId} open={open && page === 'background'} /></Suspense>}
        </div>
        <PointerSettings visible={open && page === 'pointer'} settings={settings} onChange={onChange} onReset={onReset} />
      </div>
    </div>
  )
}
