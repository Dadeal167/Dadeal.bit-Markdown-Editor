import { useEffect, useRef, useState } from 'react'
import type { PointerEvent } from 'react'
import { scoreCircle } from './circleScore'
import type { Point } from './circleScore'
import './circleEntry.css'

const SESSION_KEY = 'dadealbit-zhihu-circle-pass-v1'

export function circlePassSaved(): boolean {
  try { return sessionStorage.getItem(SESSION_KEY) === '1' }
  catch { return false }
}

export default function CircleEntry({ onPass, onClose }: { onPass(): void; onClose(): void }) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const points = useRef<Point[]>([])
  const pointer = useRef<number | null>(null)
  const [score, setScore] = useState<number | null>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    dialog.showModal()
    return () => dialog.close()
  }, [])

  function paint() {
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d')
    if (!canvas || !context || !canvas.clientWidth || !canvas.clientHeight) return
    context.setTransform(canvas.width / canvas.clientWidth, 0, 0, canvas.height / canvas.clientHeight, 0, 0)
    context.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight)
    const stroke = points.current
    if (!stroke.length) return
    context.strokeStyle = '#3984ff'
    context.lineWidth = 3
    context.lineCap = 'round'
    context.lineJoin = 'round'
    context.beginPath()
    context.moveTo(stroke[0].x, stroke[0].y)
    for (let i = 1; i < stroke.length; i++) context.lineTo(stroke[i].x, stroke[i].y)
    context.stroke()
  }

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const resize = () => {
      const scale = Math.min(window.devicePixelRatio || 1, 2)
      canvas.width = Math.round(canvas.clientWidth * scale)
      canvas.height = Math.round(canvas.clientHeight * scale)
      paint()
    }
    const observer = new ResizeObserver(resize)
    observer.observe(canvas)
    return () => observer.disconnect()
  }, [])

  function append(event: PointerEvent<HTMLCanvasElement>) {
    const bounds = event.currentTarget.getBoundingClientRect()
    const motion = event.nativeEvent.getCoalescedEvents?.()
    for (const position of motion?.length ? motion : [event]) {
      const stroke = points.current
      const point = { x: position.clientX - bounds.left, y: position.clientY - bounds.top }
      const last = stroke[stroke.length - 1]
      if (stroke.length >= 4096) break
      if (!last || Math.hypot(point.x - last.x, point.y - last.y) >= 0.75) stroke.push(point)
    }
    paint()
  }

  function start(event: PointerEvent<HTMLCanvasElement>) {
    if (pointer.current !== null || event.button !== 0) return
    event.currentTarget.setPointerCapture(event.pointerId)
    pointer.current = event.pointerId
    points.current = []
    setScore(null)
    append(event)
  }

  function finish(event: PointerEvent<HTMLCanvasElement>) {
    if (pointer.current !== event.pointerId) return
    append(event)
    pointer.current = null
    const result = scoreCircle(points.current)
    setScore(result)
    if (result <= 90) return
    try { sessionStorage.setItem(SESSION_KEY, '1') } catch { /* The current page can still open. */ }
    onPass()
  }

  function reset() {
    const active = pointer.current
    const canvas = canvasRef.current
    pointer.current = null
    if (active !== null && canvas?.hasPointerCapture(active)) canvas.releasePointerCapture(active)
    points.current = []
    setScore(null)
    paint()
  }

  return (
    <dialog ref={dialogRef} className="circle-entry" aria-labelledby="circle-entry-heading"
      onCancel={event => { event.preventDefault(); onClose() }}>
      <section className="circle-entry__panel">
        <header>
          <h1 id="circle-entry-heading">画一个圆</h1>
          <p id="circle-entry-hint">用鼠标、触屏或手写笔画一圈，得分超过 90 即可打开知乎草稿面板。</p>
        </header>
        <canvas ref={canvasRef} aria-label="画圆区域" aria-describedby="circle-entry-hint"
          onPointerDown={start} onPointerMove={event => { if (pointer.current === event.pointerId) append(event) }}
          onPointerUp={finish} onPointerCancel={event => { if (pointer.current === event.pointerId) reset() }}
          onLostPointerCapture={event => { if (pointer.current === event.pointerId) reset() }} />
        <footer>
          <p role="status">{score === null ? '松开后查看得分' : `${score.toFixed(1)} 分，请再画一次。`}</p>
          <div className="circle-entry__actions">
            <button type="button" onClick={reset}>清除</button>
            <button type="button" onClick={onClose}>返回</button>
          </div>
        </footer>
      </section>
    </dialog>
  )
}
