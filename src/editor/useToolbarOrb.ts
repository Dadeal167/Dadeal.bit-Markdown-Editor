import { useEffect, useRef, useState } from 'react'
import type { MouseEvent, PointerEvent, RefObject } from 'react'

const POSITION_KEY = 'dadealbit-toolbar-orb-position-v1'
type Position = { x: number; y: number }
type Drag = { id: number; startX: number; startY: number; origin: Position; moved: boolean }

function constrain(position: Position, width = 46, height = 46): Position {
  const margin = 12
  return {
    x: Math.min(Math.max(margin, document.documentElement.clientWidth - width - margin), Math.max(margin, position.x)),
    y: Math.min(Math.max(margin, innerHeight - height - margin), Math.max(margin, position.y)),
  }
}

function loadPosition(): Position | null {
  try {
    const saved = JSON.parse(localStorage.getItem(POSITION_KEY) ?? 'null')
    return saved && Number.isFinite(saved.x) && Number.isFinite(saved.y) ? constrain(saved) : null
  } catch { return null }
}

function savePosition(position: Position) {
  try { localStorage.setItem(POSITION_KEY, JSON.stringify(position)) } catch { /* 本次会话仍可拖动。 */ }
}

export function useToolbarOrb(enabled: boolean, ref: RefObject<HTMLButtonElement | null>, onDragStart: () => void, onActivate: () => void) {
  const [position, setPosition] = useState(loadPosition)
  const [dragging, setDragging] = useState(false)
  const [pressing, setPressing] = useState(false)
  const latest = useRef(position)
  const drag = useRef<Drag | null>(null)

  const moveTo = (next: Position | null) => { latest.current = next; setPosition(next) }
  useEffect(() => {
    if (!enabled) return
    const resize = () => {
      if (!latest.current) return
      const rect = ref.current?.getBoundingClientRect()
      const next = constrain(latest.current, rect?.width, rect?.height)
      latest.current = next
      setPosition(next)
      savePosition(next)
    }
    resize()
    window.addEventListener('resize', resize)
    return () => {
      window.removeEventListener('resize', resize)
      drag.current = null
      setDragging(false)
      setPressing(false)
    }
  }, [enabled, ref])

  const finish = (event: PointerEvent<HTMLButtonElement>, cancelled = false) => {
    const current = drag.current
    if (!current || current.id !== event.pointerId) return
    drag.current = null
    setDragging(false)
    setPressing(false)
    if (current.moved && latest.current) savePosition(latest.current)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    const rect = event.currentTarget.getBoundingClientRect()
    if (!cancelled && !current.moved && event.clientX >= rect.left && event.clientX <= rect.right &&
        event.clientY >= rect.top && event.clientY <= rect.bottom) onActivate()
  }

  return {
    style: position ? { left: position.x, top: position.y } : undefined,
    dragging,
    pressing,
    resetPosition: () => {
      moveTo(null)
      try { localStorage.removeItem(POSITION_KEY) } catch { /* 当前页面仍可复位。 */ }
    },
    onPointerDown: (event: PointerEvent<HTMLButtonElement>) => {
      if (!event.isPrimary || event.button !== 0) return
      setPressing(true)
      const rect = event.currentTarget.getBoundingClientRect()
      drag.current = { id: event.pointerId, startX: event.clientX, startY: event.clientY,
        origin: { x: rect.left, y: rect.top }, moved: false }
      event.currentTarget.setPointerCapture(event.pointerId)
    },
    onPointerMove: (event: PointerEvent<HTMLButtonElement>) => {
      const current = drag.current
      if (!current || current.id !== event.pointerId) return
      const dx = event.clientX - current.startX
      const dy = event.clientY - current.startY
      if (!current.moved && Math.hypot(dx, dy) < 5) return
      if (!current.moved) { current.moved = true; setDragging(true); onDragStart() }
      const rect = event.currentTarget.getBoundingClientRect()
      moveTo(constrain({ x: current.origin.x + dx, y: current.origin.y + dy }, rect.width, rect.height))
    },
    onPointerUp: (event: PointerEvent<HTMLButtonElement>) => finish(event),
    onPointerCancel: (event: PointerEvent<HTMLButtonElement>) => finish(event, true),
    onLostPointerCapture: (event: PointerEvent<HTMLButtonElement>) => finish(event, true),
    onClick: (event: MouseEvent<HTMLButtonElement>) => {
      // 指针在释放时激活；原生 click 保留给键盘与辅助技术，避免触控双触发。
      const native = event.nativeEvent
      if (event.detail === 0 && !(native instanceof window.PointerEvent && native.pointerType)) onActivate()
      else { event.preventDefault(); event.stopPropagation() }
    },
  }
}
