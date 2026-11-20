import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { PropertyValue } from 'webwallgl'
import { sceneFrameDocument, type SceneFrameSettings } from './wallpaperSceneFrame'
import { webFrameDocument } from './wallpaperWebFrame'
import { loadSceneProperties, saveSceneProperties, type WallpaperSource } from './wallpaperScene'
import WallpaperTimeEditor from './WallpaperTimeEditor'
import { type WallpaperVideoTexture } from './wallpaperTime'
import { useWallpaperTime, WALLPAPER_TIME_FILE } from './useWallpaperTime'

export default function WallpaperSceneView({ source, layoutId, playing, fit, controlsTarget, onError }: {
  source: WallpaperSource
  layoutId: string
  playing: boolean
  fit: 'cover' | 'contain'
  controlsTarget: HTMLElement | null
  onError(message: string): void
}) {
  const [properties, setProperties] = useState(() => loadSceneProperties(layoutId, source.properties))
  const isWeb = source.kind === 'web'
  const media = isWeb ? undefined : source.files.find(({ path }) => path === source.entry)?.file
  const sidecar = isWeb ? undefined : source.files.find(({ path }) => path === WALLPAPER_TIME_FILE)?.file
  const { schedule: timeSchedule, pending, preset, automatic, fullPreview, setPreference } = useWallpaperTime(layoutId, media, sidecar)
  const [videos, setVideos] = useState<WallpaperVideoTexture[]>([])
  const [info, setInfo] = useState<{ width: number; height: number }>()
  const [viewport, setViewport] = useState(() => ({ width: innerWidth, height: innerHeight }))
  const [fps, setFps] = useState(0)
  const [quality, setQuality] = useState('')
  const [warnings, setWarnings] = useState<string[]>([])
  const [storageError, setStorageError] = useState('')
  const port = useRef<MessagePort | null>(null)
  const reportError = useRef(onError)
  reportError.current = onError
  const frame = useRef<HTMLIFrameElement>(null)
  const settings = useRef<SceneFrameSettings>({ playing, fit, properties, timeSchedule })
  settings.current = { playing, fit, properties, timeSchedule }

  useEffect(() => {
    if (!isWeb) return
    const resize = () => setViewport({ width: innerWidth, height: innerHeight })
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [isWeb])

  useEffect(() => {
    port.current?.postMessage({ type: 'settings', settings: settings.current })
  }, [playing, fit, properties, timeSchedule])

  useEffect(() => {
    const move = (event: PointerEvent) => {
      const rect = frame.current?.getBoundingClientRect()
      if (!rect?.width || !rect.height) return
      port.current?.postMessage({ type: 'pointer', x: (event.clientX - rect.left) / rect.width,
        y: (event.clientY - rect.top) / rect.height, buttons: event.buttons })
    }
    const leave = () => port.current?.postMessage({ type: 'pointer-leave' })
    document.addEventListener('pointermove', move, { passive: true })
    document.addEventListener('pointerdown', move, { passive: true })
    document.addEventListener('pointerup', move, { passive: true })
    document.addEventListener('pointerleave', leave)
    return () => {
      document.removeEventListener('pointermove', move)
      document.removeEventListener('pointerdown', move)
      document.removeEventListener('pointerup', move)
      document.removeEventListener('pointerleave', leave)
      port.current?.postMessage({ type: 'destroy' })
      port.current?.close()
    }
  }, [])

  const connect = () => {
    port.current?.close()
    const channel = new MessageChannel()
    port.current = channel.port1
    channel.port1.onmessage = ({ data }) => {
      if (data.type === 'error') reportError.current((isWeb ? '网页加载失败。' : '场景加载失败。') + String(data.message).slice(0, 350))
      if (data.type === 'ready') setInfo(data.info)
      if (data.type === 'video-texture' && typeof data.name === 'string' && Number.isFinite(data.duration) && data.duration > 0) {
        setVideos((current) => current.some(({ name }) => name === data.name) ? current :
          [...current, { name: data.name, duration: data.duration }])
      }
      if (data.type === 'stats') {
        setFps(Math.max(0, Math.round(Number(data.stats?.fps) || 0)))
        setQuality(String(data.quality?.postProcessing ?? ''))
      }
      if (data.type === 'warning') setWarnings((current) => current.includes(data.message) || current.length >= 8
        ? current : [...current, String(data.message)])
    }
    frame.current?.contentWindow?.postMessage({ type: 'load-scene', source, settings: settings.current }, '*', [channel.port2])
  }

  const change = (key: string, value: PropertyValue) => {
    const next = { ...properties, [key]: value }
    setProperties(next)
    try { saveSceneProperties(layoutId, next); setStorageError('') }
    catch { setStorageError('场景选项仅在本次会话中保留。') }
  }
  const definitions = Object.entries(source.properties).filter(([, property]) => !String(property.text).startsWith('ui_'))
  const audioProperties = new Set(definitions.filter(([, property]) => /音频|audio/i.test(property.text)).map(([key]) => key))
  const webScale = info && isWeb ? Math[fit === 'contain' ? 'min' : 'max'](viewport.width / info.width, viewport.height / info.height) : 1
  const webStyle = isWeb && info ? { width: info.width * webScale, height: info.height * webScale,
    left: (viewport.width - info.width * webScale) / 2, top: (viewport.height - info.height * webScale) / 2 } : undefined
  return <>
    {!pending && createPortal(<iframe ref={frame} className={'zh-fx__lobby-stage ' + (isWeb ? 'zh-fx__wallpaper-web' : 'zh-fx__wallpaper-scene')}
      style={webStyle} title={isWeb ? 'Live2D 网页背景' : 'Wallpaper Engine 场景背景'} sandbox="allow-scripts"
      srcDoc={isWeb ? webFrameDocument : sceneFrameDocument} onLoad={connect}
      tabIndex={-1} aria-hidden="true"
      data-web-state={isWeb ? info ? 'ready' : 'loading' : undefined}
      data-scene-state={!isWeb ? info ? 'ready' : 'loading' : undefined} data-scene-fps={fps} data-scene-quality={quality} />, document.body)}
    {controlsTarget && createPortal(<section className="zh-wallpaper-options" aria-label={isWeb ? '网页选项' : '场景选项'}>
      <div className="zh-fx__hint" role="status">{info
        ? `${isWeb ? 'Live2D 已加载' : '场景已加载'} · ${info.width} × ${info.height}${fps ? ' · ' + fps + ' FPS' : ''}`
        : isWeb ? '正在初始化 Live2D 模型与贴图…' : '正在初始化场景与贴图…'}</div>
      {videos.length > 0 && <WallpaperTimeEditor layoutId={layoutId} videos={videos} schedule={timeSchedule}
        preset={preset} automatic={automatic} fullPreview={fullPreview} onChange={setPreference} />}
      {definitions.map(([key, property]) => <fieldset key={key} className="zh-wallpaper-options__field" disabled={audioProperties.has(key)}>
      <label className="zh-wallpaper-options__row">
        <span>{property.text || key}</span>
        {property.type === 'bool' ? <input type="checkbox" checked={properties[key] === true}
          onChange={(event) => change(key, event.target.checked)} />
          : property.type === 'combo' ? <select value={String(properties[key])} onChange={(event) => change(key, event.target.value)}>
            {property.options?.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select> : property.type === 'slider' ? <input type="range" min={property.min} max={property.max} step={property.step ?? 'any'}
            value={Number(properties[key])} onChange={(event) => change(key, Number(event.target.value))} />
          : property.type === 'color' ? <input type="color"
            value={'#' + String(properties[key]).split(/\s+/).slice(0, 3).map((value) =>
              Math.max(0, Math.min(255, Math.round(Number(value) * 255))).toString(16).padStart(2, '0')).join('')}
            onChange={(event) => change(key, [1, 3, 5].map((offset) => Number.parseInt(event.target.value.slice(offset, offset + 2), 16) / 255).join(' '))} />
          : <input type="text" maxLength={1000} value={String(properties[key])} onChange={(event) => change(key, event.target.value)} />}
      </label></fieldset>)}
      {audioProperties.size > 0 && <div className="zh-fx__hint">系统音频感应尚未接入。</div>}
      {storageError && <div className="zh-fx__hint" role="alert">{storageError}</div>}
      {warnings.length > 0 && <details className="zh-fx__hint">
        <summary>场景兼容提示（{warnings.length}）</summary>
        <ul>{warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
      </details>}
    </section>, controlsTarget)}
  </>
}
