import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import WallpaperTimeEditor from '../wallpaper/WallpaperTimeEditor'
import { wallpaperClipPlan } from '../wallpaper/wallpaperTime'
import { useWallpaperTime } from '../wallpaper/useWallpaperTime'
import { createWallpaperVideoClip } from '../wallpaper/wallpaperVideoClip'

import type { LobbyMediaKind } from './mediaAssets'

export default function LobbyMedia({ file, kind, playing, fit, layoutId, timeConfig, controlsTarget, onError, onPlaybackBlocked }: {
  file: File
  kind: LobbyMediaKind
  playing: boolean
  fit: 'cover' | 'contain'
  layoutId: string
  timeConfig?: File
  controlsTarget: HTMLElement | null
  onError(message: string): void
  onPlaybackBlocked(message: string): void
}) {
  const element = useRef<HTMLImageElement | HTMLVideoElement | null>(null)
  const [duration, setDuration] = useState(0)
  const { schedule, pending, preset, automatic, fullPreview, setPreference } = useWallpaperTime(layoutId, kind === 'video' ? file : undefined, timeConfig)
  const syncPlayback = useRef<() => void>(undefined)
  const settings = useRef({ schedule, pending, playing, fit, onPlaybackBlocked })
  settings.current = { schedule, pending, playing, fit, onPlaybackBlocked }
  useEffect(() => {
    const node = element.current
    if (!node) return
    const url = URL.createObjectURL(file)
    node.src = url
    if (!(node instanceof HTMLVideoElement)) return () => {
      node.removeAttribute('src')
      URL.revokeObjectURL(url)
    }

    let active = node
    let standby: HTMLVideoElement | undefined
    let preload: HTMLVideoElement | undefined
    let frame = 0
    const play = () => {
      void active.play().catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'NotAllowedError') {
          settings.current.onPlaybackBlocked('浏览器阻止了视频播放。请关闭并重新启用「播放动画」。')
        }
      })
    }
    const clip = createWallpaperVideoClip({
      active: () => active,
      standby: () => {
        if (standby) return standby
        preload = document.createElement('video')
        preload.className = 'zh-fx__lobby-video'
        preload.style.objectFit = settings.current.fit
        preload.style.visibility = 'hidden'
        preload.style.zIndex = '1'
        preload.setAttribute('aria-hidden', 'true')
        preload.muted = true
        preload.loop = true
        preload.playsInline = true
        preload.preload = 'auto'
        preload.src = url
        node.parentElement?.append(preload)
        standby = preload
        return preload
      },
      swap: () => {
        if (!standby) return
        active.pause()
        active.style.visibility = 'hidden'
        active.style.zIndex = '1'
        active.classList.remove('zh-fx__lobby-media')
        ;[active, standby] = [standby, active]
        active.classList.add('zh-fx__lobby-media')
        active.style.visibility = ''
        active.style.opacity = ''
        active.style.zIndex = '0'
        if (active.paused) play()
      },
      plan: (duration) => wallpaperClipPlan(settings.current.schedule, file.name, duration),
    })
    const syncBlend = () => {
      if (!standby) return
      const blend = clip.loopBlend()
      standby.style.visibility = blend ? 'visible' : 'hidden'
      standby.style.opacity = blend ? String(blend.mix) : ''
    }
    const tick = () => {
      clip.tick()
      syncBlend()
      frame = requestAnimationFrame(tick)
    }
    const sync = () => {
      const { fit, playing, pending, schedule } = settings.current
      active.style.objectFit = fit
      if (standby) standby.style.objectFit = fit
      if (playing && !pending && !document.hidden) {
        if (!clip.holding) play()
        if (schedule && !frame) frame = requestAnimationFrame(tick)
        else if (!schedule && frame) {
          cancelAnimationFrame(frame)
          frame = 0
          clip.tick()
        }
      } else {
        active.pause()
        clip.reset()
        cancelAnimationFrame(frame)
        frame = 0
      }
      syncBlend()
    }
    syncPlayback.current = sync
    sync()
    document.addEventListener('visibilitychange', sync)
    return () => {
      syncPlayback.current = undefined
      document.removeEventListener('visibilitychange', sync)
      cancelAnimationFrame(frame)
      for (const video of [node, preload]) {
        if (!video) continue
        video.pause()
        video.removeAttribute('src')
        video.load()
      }
      node.classList.add('zh-fx__lobby-media')
      node.style.visibility = ''
      node.style.opacity = ''
      node.style.zIndex = ''
      preload?.remove()
      URL.revokeObjectURL(url)
    }
  }, [file, kind])

  useEffect(() => { syncPlayback.current?.() }, [playing, pending, schedule, fit])

  const className = 'zh-fx__lobby-stage zh-fx__lobby-media'
  return <>{createPortal(kind === 'video'
    ? <div className="zh-fx__lobby-stage" aria-hidden="true">
      <video className="zh-fx__lobby-video zh-fx__lobby-media" style={{ objectFit: fit }} ref={(node) => { element.current = node }}
        muted loop playsInline preload="auto" onLoadedMetadata={(event) => setDuration(event.currentTarget.duration)}
        onError={() => onError('视频背景播放失败。')} />
    </div>
    : <img className={className} style={{ objectFit: fit }} ref={(node) => { element.current = node }} alt="" aria-hidden="true"
      onError={() => onError('图片背景加载失败。')} />, document.body)}
    {controlsTarget && !pending && Number.isFinite(duration) && duration > 0 && createPortal(
      <WallpaperTimeEditor layoutId={layoutId} videos={[{ name: file.name, duration }]} schedule={schedule}
        preset={preset} automatic={automatic} fullPreview={fullPreview} onChange={setPreference} />,
      controlsTarget,
    )}
  </>
}
