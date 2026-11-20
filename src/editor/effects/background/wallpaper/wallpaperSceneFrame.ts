import { runtime, licenses } from 'virtual:wallpaper-scene-runtime'
import type { MountOptions, SceneInstance, Source, PropertyValue } from 'webwallgl'
import type { WallpaperSceneSource } from './wallpaperScene'
import { wallpaperClipPlan, type WallpaperClipPlan, type WallpaperTimeSettings } from './wallpaperTime'
import { createWallpaperVideoClip } from './wallpaperVideoClip'

export interface SceneFrameSettings {
  playing: boolean
  fit: 'cover' | 'contain'
  properties: Record<string, PropertyValue>
  timeSchedule?: WallpaperTimeSettings | null
}

// 此函数整个放入独立 iframe，不读取编辑器的变量、文档或存储。
function startSceneFrame(clipPlan: typeof wallpaperClipPlan, createClip: typeof createWallpaperVideoClip) {
  // 隔离页面无 CacheStorage 权限，让渲染库使用其内存缓存分支。
  Object.defineProperty(window, 'caches', { value: undefined, configurable: true })
  let player: SceneInstance | undefined
  let channel: MessagePort | undefined
  let settings: SceneFrameSettings
  let disposed = false
  const send = (value: unknown) => channel?.postMessage(value)
  const sync = () => {
    if (!player || !settings) return
    player.setFit(settings.fit)
    player.setProperties(settings.properties)
    if (settings.playing && !document.hidden) player.resume()
    else player.pause()
  }
  document.addEventListener('visibilitychange', sync)
  window.addEventListener('message', async (event: MessageEvent) => {
    if (event.source !== parent || event.data?.type !== 'load-scene' || channel || !event.ports[0]) return
    channel = event.ports[0]
    settings = event.data.settings as SceneFrameSettings
    channel.onmessage = ({ data }) => {
      if (data.type === 'settings') { settings = data.settings; sync() }
      if (data.type === 'pointer') player?.pushPointer(data.x, data.y, data.buttons)
      if (data.type === 'pointer-leave') player?.pointerLeave()
      if (data.type === 'destroy') {
        disposed = true
        player?.destroy({ releasePkgCache: true })
        channel?.close()
      }
    }
    const assets = event.data.source as WallpaperSceneSource
    const files = new Map(assets.files.map(({ path, file }) => [path.toLowerCase(), file]))
    const keyOf = (name: string) => name.replace(/\\/g, '/').replace(/^(?:\.\/)+/, '').toLowerCase()
    const entry = files.get(assets.entry)
    const source: Source = {
      key: 'local-scene:' + assets.entry,
      project: async () => assets.project,
      scenePkg: async () => {
        const pkg = assets.entry.endsWith('.pkg') ? entry : files.get('scene.pkg')
        if (!pkg) throw new Error('项目缺少场景包。')
        return pkg.arrayBuffer()
      },
      sceneDir: async () => assets.entry.endsWith('.json') && entry ? {
        entry: assets.entry,
        read: async (name) => {
          const file = files.get(keyOf(name))
          return file ? new Uint8Array(await file.arrayBuffer()) : null
        },
      } : null,
    }
    try {
      const engine = (window as unknown as { WebWallGL: {
        createScene(element: HTMLElement, options: Partial<Omit<MountOptions, 'source'>> & {
          videoLoopPlan?: (texture: string, duration: number) => WallpaperClipPlan | undefined
          createVideoClip: typeof createWallpaperVideoClip
          onVideoTexture?: (texture: string, duration: number) => void
        }): SceneInstance
      } }).WebWallGL
      player = engine.createScene(document.getElementById('stage')!, {
        fps: 1000, volume: 0, fit: settings.fit, properties: settings.properties,
        quality: { postProcessing: 'high' },
        // 自动降档最终会关闭场景的功能性混合效果，导致日景退回底层夜景。
        autoQuality: false,
        videoLoopPlan: (texture, duration) => clipPlan(settings.timeSchedule ?? null, texture, duration),
        createVideoClip: createClip,
        onVideoTexture: (name, duration) => {
          if (!disposed && Number.isFinite(duration) && duration > 0) send({ type: 'video-texture', name, duration })
        },
        bake: false, audio: null, media: null, mountTimeoutMs: 60000,
        onError: (error) => { if (!disposed) send({ type: 'error', message: error.message }) },
        onDiagnostic: (message, level) => { if (!disposed && level === 'warn') send({ type: 'warning', message: message.slice(0, 500) }) },
      })
      await player.load(source)
      if (disposed) { player.destroy({ releasePkgCache: true }); return }
      sync()
      send({ type: 'ready', info: player.info })
      const timer = window.setInterval(() => {
        if (disposed) { window.clearInterval(timer); return }
        send({ type: 'stats', stats: player?.stats, quality: player?.getQuality() })
      }, 1000)
    } catch (error) {
      if (!disposed) send({ type: 'error', message: error instanceof Error ? error.message : String(error) })
      player?.destroy({ releasePkgCache: true })
    }
  })
}

export const sceneFrameDocument = `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' blob:; style-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:; connect-src data: blob:; worker-src blob:; font-src data: blob:">
<style>html,body,#stage{width:100%;height:100%;margin:0;overflow:hidden;background:transparent}canvas{display:block;width:100%;height:100%}</style>
</head><body><div id="stage"></div><script>/*${licenses.replace(/\*\//g, '* /')}*/
${runtime.replace(/<\/script/gi, '<\\/script')}
(${startSceneFrame.toString()})(${wallpaperClipPlan.toString()}, ${createWallpaperVideoClip.toString()})
</script></body></html>`
