import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'

export default function LobbyWindow({ stream, playing, fit, onEnded, onError }: {
  stream: MediaStream
  playing: boolean
  fit: 'cover' | 'contain'
  onEnded(): void
  onError(message: string): void
}) {
  const video = useRef<HTMLVideoElement>(null)
  const report = useRef({ onEnded, onError })
  report.current = { onEnded, onError }
  useEffect(() => {
    const node = video.current
    if (!node) return
    node.srcObject = stream
    const ended = () => report.current.onEnded()
    const tracks = stream.getVideoTracks()
    tracks.forEach((track) => track.addEventListener('ended', ended))
    return () => {
      tracks.forEach((track) => track.removeEventListener('ended', ended))
      node.srcObject = null
      stream.getTracks().forEach((track) => track.stop())
    }
  }, [stream])
  useEffect(() => {
    const node = video.current
    if (!node) return
    let current = true
    const sync = () => {
      if (playing && !document.hidden) void node.play().catch((error: unknown) => {
        if (current && !(error instanceof DOMException && error.name === 'AbortError')) {
          report.current.onError('窗口画面播放失败。请重新选择共享窗口。')
        }
      })
      else node.pause()
    }
    sync()
    document.addEventListener('visibilitychange', sync)
    return () => { current = false; document.removeEventListener('visibilitychange', sync) }
  }, [playing, stream])
  return createPortal(<video ref={video} className="zh-fx__lobby-stage zh-fx__lobby-window"
    style={{ objectFit: fit }} muted playsInline aria-hidden="true" />, document.body)
}
