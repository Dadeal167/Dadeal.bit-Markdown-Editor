import { Fragment, useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { EditorApi } from './types'
import { useToolbarOrb } from './useToolbarOrb'
import { displayKey, shortcuts, TOOLBAR_ORB_REVEAL_EVENT, TOOLBAR_TOOLS_EVENT } from './shortcuts'
import type { SaveFormat } from './publication/saveOptions'
import ToolbarButton from './toolbar/ToolbarButton'
import { toolbarGroups, type ToolbarHandlers, type ToolbarMode } from './toolbar/toolbarItems'

interface Props {
  api: EditorApi
  handlers: ToolbarHandlers
  /** 插在最前面的自定义按钮（文档列表） */
  extraLeading?: ReactNode
  /** 排版（字号/字体/颜色）下拉，放在排版按钮那一组里 */
  typographyMenu?: ReactNode
  /** 特效设置面板（纯净版构建里为 null，那个按钮就整块不出现） */
  effectPanel?: ReactNode
  /** 「保存」按钮：点开选格式（Markdown / 知乎 / 通用版 / 网页 / PDF） */
  saveMenu?: ReactNode
  onDismissPanels?(): void
  panelsOpen?: boolean
  onOpenEffects?: () => void
  onSaveAction(format: SaveFormat): void
  hasLocalFile: boolean
}

const TOOLBAR_MODE_KEY = 'dadealbit-toolbar-mode-v1'

function loadToolbarMode(): ToolbarMode {
  try { return __BUILD_MODE__ === 'effect' && localStorage.getItem(TOOLBAR_MODE_KEY) === 'orb' ? 'orb' : 'bar' }
  catch { return 'bar' }
}

export default function Toolbar({ api, handlers, extraLeading, typographyMenu, effectPanel, saveMenu, onDismissPanels,
  panelsOpen, onOpenEffects, onSaveAction, hasLocalFile }: Props) {
  const [mode, setMode] = useState(loadToolbarMode)
  const [expanded, setExpanded] = useState(false)
  const [orbVisible, setOrbVisible] = useState(true)
  const [orbActivity, setOrbActivity] = useState(0)
  const [openMenu, setOpenMenu] = useState<string>()
  const dock = useRef<HTMLDivElement>(null)
  const orb = useRef<HTMLButtonElement>(null)
  const dismissPanels = useRef(onDismissPanels)
  dismissPanels.current = onDismissPanels
  const collapse = useCallback((focusOrb = false) => {
    setExpanded(false)
    setOpenMenu(undefined)
    dismissPanels.current?.()
    if (focusOrb) requestAnimationFrame(() => orb.current?.focus({ preventScroll: true }))
  }, [])
  const { resetPosition, dragging, pressing, style: orbStyle, ...orbEvents } = useToolbarOrb(mode === 'orb', orb, collapse,
    () => expanded ? collapse() : setExpanded(true))
  const revealOrb = useCallback(() => { setOrbVisible(true); setOrbActivity((value) => value + 1) }, [])

  useEffect(() => {
    if (mode === 'orb') revealOrb()
  }, [mode, revealOrb])

  useEffect(() => {
    if (mode !== 'orb' || expanded || dragging || pressing || !orbVisible) return
    const timer = window.setTimeout(() => {
      // 键盘焦点仍在按钮上时保留它，避免 Tab / Enter 操作中途丢失焦点。
      if (document.activeElement !== orb.current) setOrbVisible(false)
    }, 3000)
    return () => window.clearTimeout(timer)
  }, [mode, expanded, dragging, pressing, orbVisible, orbActivity])

  useEffect(() => {
    if (__BUILD_MODE__ !== 'effect') return
    document.documentElement.dataset.toolbarMode = mode
    return () => { delete document.documentElement.dataset.toolbarMode }
  }, [mode])

  useEffect(() => {
    if (mode !== 'orb' || !expanded) return
    const outside = (event: PointerEvent) => {
      if (!dock.current?.contains(event.target as Node)) collapse()
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || document.querySelector('.zh-modal-mask, .zh-search')) return
      if (dock.current?.querySelector('.zh-menu, .zh-docmenu, .zh-typomenu, .zh-fx:not([hidden])')) return
      event.preventDefault()
      collapse(true)
    }
    document.addEventListener('pointerdown', outside)
    // 子菜单先处理 Escape，下一次 Escape 收起工具栏。
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('keydown', escape)
    }
  }, [collapse, expanded, mode])

  const changeMode = (next: ToolbarMode) => {
    dismissPanels.current?.()
    setMode(next)
    setExpanded(false)
    setOpenMenu(undefined)
    try { localStorage.setItem(TOOLBAR_MODE_KEY, next) } catch { /* 当前会话仍可切换。 */ }
  }

  useEffect(() => {
    if (__BUILD_MODE__ !== 'effect') return
    const show = () => {
      if (mode !== 'orb') changeMode('orb')
      revealOrb()
    }
    window.addEventListener(TOOLBAR_ORB_REVEAL_EVENT, show)
    return () => window.removeEventListener(TOOLBAR_ORB_REVEAL_EVENT, show)
  }, [mode, revealOrb])

  useEffect(() => {
    if (mode === 'orb' && panelsOpen) setExpanded(true)
  }, [mode, panelsOpen])

  useEffect(() => {
    if (__BUILD_MODE__ !== 'effect') return
    const openTools = () => {
      dismissPanels.current?.()
      if (mode === 'orb') setExpanded(true)
      setOpenMenu('more')
    }
    window.addEventListener(TOOLBAR_TOOLS_EVENT, openTools)
    return () => window.removeEventListener(TOOLBAR_TOOLS_EVENT, openTools)
  }, [mode])

  const groups = toolbarGroups({ api, handlers, mode, changeMode, revealOrb, resetPosition, typographyMenu, saveMenu,
    effectPanel, onOpenEffects, onSaveAction, hasLocalFile })

  return (
    <div ref={dock} className={`zh-toolbar-dock zh-toolbar-dock--${mode}`}>
      {mode === 'orb' && <button ref={orb} type="button" className="zh-toolbar-orb"
        style={orbStyle} data-dragging={dragging || undefined} {...orbEvents}
        data-idle-hidden={!orbVisible && !expanded || undefined} aria-hidden={!orbVisible && !expanded || undefined}
        tabIndex={orbVisible || expanded ? 0 : -1}
        onPointerMove={(event) => { orbEvents.onPointerMove(event); revealOrb() }}
        onPointerDown={(event) => { orbEvents.onPointerDown(event); revealOrb() }}
        onPointerUp={(event) => { orbEvents.onPointerUp(event); revealOrb() }}
        onFocus={revealOrb} onBlur={revealOrb}
        title={`${expanded ? '收起工具栏' : '展开工具栏'} · 空闲 3 秒后隐藏，${displayKey(shortcuts.bindings().toolbarOrb)} 显示`}
        aria-label={expanded ? '收起工具栏' : '展开工具栏'}
        aria-description="点击展开或收起工具栏，拖动调整位置；空闲 3 秒后隐藏，可用快捷键重新显示。"
        aria-expanded={expanded} aria-controls="zh-main-toolbar"
        onMouseDown={(event) => event.preventDefault()}>
        <span aria-hidden="true" className="zh-toolbar-orb__mark"><i /><i /><i /><i /></span>
      </button>}
      <div id="zh-main-toolbar" className="zh-toolbar" hidden={mode === 'orb' && !expanded}
        role="region" aria-label="编辑工具栏">
      {mode === 'orb' && <div className="zh-toolbar__head">
        <strong>编辑工具栏</strong>
        <button type="button" className="zh-btn-plain" onMouseDown={(event) => event.preventDefault()}
          onClick={() => collapse(true)} aria-label="收起编辑工具栏">收起 ✕</button>
      </div>}
      <div className="zh-toolbar__inner">
        {groups.map((group, gi) => (
          <div className="zh-toolbar__group" key={gi}>
            {gi === 0 && extraLeading}
            {group.map((item) =>
              item.render ? (
                <Fragment key={item.key === 'save' ? item.key + ':' + expanded : item.key}>{item.render}</Fragment>
              ) : (
                <ToolbarButton key={item.key + ':' + expanded} item={item} open={openMenu === item.key}
                  onOpenChange={(open) => setOpenMenu((previous) => open ? item.key : previous === item.key ? undefined : previous)}
                  afterClick={api.focus} />
              ),
            )}
          </div>
        ))}
      </div>
      </div>
    </div>
  )
}
