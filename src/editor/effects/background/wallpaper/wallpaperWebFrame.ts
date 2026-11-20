import type { WallpaperWebSource } from './wallpaperScene'
import type { SceneFrameSettings } from './wallpaperSceneFrame'

// 用户网页与资源只在这个独立、无同源权限的 iframe 中运行。
function startWebFrame() {
  let channel: MessagePort | undefined
  let settings: SceneFrameSettings
  let disposed = false
  let ready = false
  let drewModel = false
  let backgroundReady = false
  let dimensions = { width: innerWidth, height: innerHeight }
  let draws = 0
  let frames = 0
  const send = (value: unknown) => channel?.postMessage(value)
  const fail = (error: unknown) => send({ type: 'error', message: error instanceof Error ? error.message : String(error) })
  const nativeFrame = requestAnimationFrame.bind(window)
  const nativeCancel = cancelAnimationFrame.bind(window)
  const nativeFetch = fetch.bind(window)
  const callbacks = new Map<number, FrameRequestCallback>()
  const urls = new Set<string>()
  let nextFrame = 0
  let pendingFrame = 0
  let refreshFrames = 0
  let propertyListener: { applyUserProperties?(properties: unknown): void; setPaused?(paused: boolean): void } | undefined
  const running = () => !disposed && settings?.playing && !document.hidden
  const canRender = () => !disposed && !document.hidden && (!ready || running() || refreshFrames > 0)
  const pump = () => {
    if (pendingFrame || !canRender() || !callbacks.size) return
    pendingFrame = nativeFrame((time) => {
      pendingFrame = 0
      if (!canRender()) return
      if (refreshFrames > 0) refreshFrames--
      const batch = [...callbacks.values()]
      callbacks.clear()
      const before = draws
      for (const callback of batch) { try { callback(time) } catch (error) { fail(error) } }
      if (draws > before) frames++
      pump()
    })
  }
  window.requestAnimationFrame = (callback) => { const id = ++nextFrame; callbacks.set(id, callback); pump(); return id }
  window.cancelAnimationFrame = (id) => { callbacks.delete(id) }
  const sync = () => {
    const paused = !running()
    propertyListener?.setPaused?.(paused)
    propertyListener?.applyUserProperties?.(Object.fromEntries(Object.entries(settings.properties).map(([key, value]) => [key, { value }])))
    document.documentElement.style.setProperty('--wallpaper-animation', paused ? 'paused' : 'running')
    for (const media of document.querySelectorAll<HTMLMediaElement>('audio,video')) {
      media.muted = true
      if (paused) media.pause()
      else void media.play().catch(() => {})
    }
    if (paused && pendingFrame) { nativeCancel(pendingFrame); pendingFrame = 0 }
    pump()
  }
  Object.defineProperty(window, 'wallpaperPropertyListener', {
    configurable: true, get: () => propertyListener,
    set: (listener) => { propertyListener = listener; if (settings) sync() },
  })
  Object.assign(window, {
    wallpaperRegisterAudioListener: () => {},
    wallpaperRequestRandomFileForProperty: () => {},
  })
  const notifyReady = () => {
    if (!ready && drewModel && backgroundReady) {
      ready = true
      refreshFrames = Math.max(refreshFrames, 1)
      send({ type: 'ready', info: dimensions })
    }
  }
  // 暂停时也要完成首帧和窗口尺寸更新，随后继续保持静止。
  window.addEventListener('resize', () => { refreshFrames = 2; pump() })
  // 以模型实际绘制作为成功条件，不能仅凭出现空 canvas 就报告已加载。
  for (const proto of [WebGLRenderingContext.prototype, WebGL2RenderingContext.prototype]) {
    for (const name of ['drawElements', 'drawArrays'] as const) {
      const original = proto[name]
      ;(proto as unknown as Record<string, Function>)[name] = function (this: WebGLRenderingContext, ...args: number[]) {
        const result = (original as Function).apply(this, args)
        draws++
        drewModel = true
        notifyReady()
        return result
      }
    }
  }
  window.addEventListener('error', (event) => { if (event.error) fail(event.error) })
  window.addEventListener('unhandledrejection', (event) => { fail(event.reason) })
  document.addEventListener('visibilitychange', () => { if (settings) sync() })
  window.addEventListener('message', async (event: MessageEvent) => {
    if (event.source !== parent || event.data?.type !== 'load-scene' || channel || !event.ports[0]) return
    channel = event.ports[0]
    settings = event.data.settings
    let lastButtons = 0
    channel.onmessage = ({ data }) => {
      if (data.type === 'settings') { settings = data.settings; sync() }
      if (data.type === 'pointer') {
        const x = Number(data.x) * innerWidth
        const y = Number(data.y) * innerHeight
        if (!Number.isFinite(x) || !Number.isFinite(y)) return
        const target = document.elementFromPoint(x, y) ?? document.querySelector('canvas') ?? document.body
        const buttons = Number(data.buttons) || 0
        const eventInit = { clientX: x, clientY: y, screenX: x, screenY: y, buttons, bubbles: true }
        target.dispatchEvent(new PointerEvent('pointermove', { ...eventInit, pointerId: 1, pointerType: 'mouse', isPrimary: true }))
        target.dispatchEvent(new MouseEvent('mousemove', eventInit))
        if ((buttons & 1) !== (lastButtons & 1)) {
          target.dispatchEvent(new PointerEvent(buttons & 1 ? 'pointerdown' : 'pointerup',
            { ...eventInit, pointerId: 1, pointerType: 'mouse', isPrimary: true }))
          target.dispatchEvent(new MouseEvent(buttons & 1 ? 'mousedown' : 'mouseup', eventInit))
          if (!(buttons & 1)) target.dispatchEvent(new MouseEvent('click', eventInit))
        }
        lastButtons = buttons
      }
      if (data.type === 'pointer-leave') {
        document.querySelector('canvas')?.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }))
        lastButtons = 0
      }
      if (data.type === 'destroy') {
        disposed = true
        if (pendingFrame) nativeCancel(pendingFrame)
        callbacks.clear()
        for (const url of urls) URL.revokeObjectURL(url)
        channel?.close()
      }
    }
    try {
      const source = event.data.source as WallpaperWebSource
      const files = new Map(source.files.map(({ path, file }) => [path.toLowerCase(), file]))
      const base = new URL(source.entry, 'https://wallpaper.invalid/').href
      const mapped = new Map<string, string>()
      const css = new Map<string, string>()
      for (const [path, file] of files) if (/\.css$/i.test(path)) css.set(path, await file.text())
      const resource = (input: string, relativeTo = base): string => {
        if (/^(?:blob:|data:|#)/i.test(input)) return input
        const url = new URL(input.replace(/\\/g, '/'), relativeTo)
        if (url.origin !== 'https://wallpaper.invalid') throw new Error('此网页引用了未导入的外部资源：' + url.hostname)
        const path = decodeURIComponent(url.pathname.slice(1)).toLowerCase()
        const previous = mapped.get(path)
        if (previous) return previous
        const file = files.get(path)
        if (!file) throw new Error('网页缺少资源：' + path)
        const extension = path.split('.').pop() ?? ''
        const types: Record<string, string> = { js: 'application/javascript', css: 'text/css', json: 'application/json',
          png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml', wasm: 'application/wasm' }
        const plain = URL.createObjectURL(new Blob([file], { type: types[extension] ?? file.type }))
        urls.add(plain)
        mapped.set(path, plain)
        if (css.has(path)) {
          const rewritten = rewriteCSS(css.get(path)!, url.href)
          const styled = URL.createObjectURL(new Blob([rewritten], { type: 'text/css' }))
          urls.add(styled)
          mapped.set(path, styled)
          return styled
        }
        return plain
      }
      const rewriteCSS = (text: string, relativeTo = base): string => text
        .replace(/url\(\s*(['"]?)(.*?)\1\s*\)/gi, (_, _quote: string, url: string) => `url("${resource(url, relativeTo)}")`)
        .replace(/@import\s+(['"])(.*?)\1/gi, (_, _quote: string, url: string) => `@import "${resource(url, relativeTo)}"`)
      window.fetch = (input, init) => {
        const value = input instanceof Request ? new Request(resource(input.url), input) : resource(String(input))
        return nativeFetch(value, init)
      }
      const originalOpen = XMLHttpRequest.prototype.open
      XMLHttpRequest.prototype.open = function (method: string, url: string | URL, async: boolean = true, username?: string | null, password?: string | null) {
        return originalOpen.call(this, method, resource(String(url)), async, username, password)
      }
      // Image.src 与 setAttribute 两条路径都覆盖，支持 PIXI / Cubism 的贴图加载。
      const patchURL = (proto: object, property: string) => {
        const descriptor = Object.getOwnPropertyDescriptor(proto, property)
        if (!descriptor?.set) return
        Object.defineProperty(proto, property, { ...descriptor, set(value: string) { descriptor.set!.call(this, resource(String(value))) } })
      }
      patchURL(HTMLImageElement.prototype, 'src')
      patchURL(HTMLScriptElement.prototype, 'src')
      patchURL(HTMLLinkElement.prototype, 'href')
      patchURL(HTMLMediaElement.prototype, 'src')
      const setAttribute = Element.prototype.setAttribute
      Element.prototype.setAttribute = function (name: string, value: string) {
        if ((name.toLowerCase() === 'src' && /^(IMG|SCRIPT|VIDEO|AUDIO|SOURCE)$/.test(this.tagName)) ||
            (name.toLowerCase() === 'href' && this.tagName === 'LINK')) value = resource(value)
        if (name.toLowerCase() === 'style') value = rewriteCSS(value)
        return setAttribute.call(this, name, value)
      }
      const entry = files.get(source.entry)
      if (!entry) throw new Error('网页入口文件缺失。')
      const html = new DOMParser().parseFromString(await entry.text(), 'text/html')
      const scripts = [...html.querySelectorAll('script')].filter((script) =>
        !script.type || /^(?:module|(?:text|application)\/(?:javascript|ecmascript))$/i.test(script.type))
      if (scripts.some((script) => script.type === 'module')) throw new Error('当前 Live2D 导入尚不支持 ES 模块入口。')
      scripts.forEach((script) => script.remove())
      html.querySelectorAll('base,meta[http-equiv]').forEach((node) => node.remove())
      const baseNode = document.createElement('base')
      baseNode.href = base
      document.head.append(baseNode)
      for (const style of html.querySelectorAll('style')) style.textContent = rewriteCSS(style.textContent ?? '')
      for (const node of html.querySelectorAll('[src],[href],[style]')) {
        for (const name of ['src', 'href']) {
          if (node.hasAttribute(name) && (name === 'src' || node.tagName === 'LINK')) node.setAttribute(name, resource(node.getAttribute(name)!))
        }
        if (node.hasAttribute('style')) node.setAttribute('style', rewriteCSS(node.getAttribute('style')!))
      }
      document.head.append(...[...html.head.childNodes].map((node) => document.importNode(node, true)))
      document.body.replaceChildren(...[...html.body.childNodes].map((node) => document.importNode(node, true)))
      const style = document.createElement('style')
      style.textContent = 'html,body{width:100%;height:100%;overflow:hidden}*{animation-play-state:var(--wallpaper-animation,running)!important}'
      document.head.append(style)
      const background = /url\(["']?(.*?)["']?\)/.exec(getComputedStyle(document.body).backgroundImage)?.[1]
      if (background) {
        const image = new Image()
        image.src = background
        await image.decode()
        if (image.naturalWidth && image.naturalHeight) dimensions = { width: image.naturalWidth, height: image.naturalHeight }
      }
      backgroundReady = true
      const deferred = scripts.filter((script) => script.defer || script.async)
      for (const original of [...scripts.filter((script) => !script.defer && !script.async), ...deferred]) {
        const script = document.createElement('script')
        if (original.src || original.getAttribute('src')) {
          const url = resource(original.getAttribute('src')!)
          await new Promise<void>((resolve, reject) => {
            script.onload = () => resolve()
            script.onerror = () => reject(new Error('网页脚本加载失败：' + original.getAttribute('src')))
            script.src = url
            document.body.append(script)
          })
        } else { script.textContent = original.textContent; document.body.append(script) }
      }
      document.dispatchEvent(new Event('DOMContentLoaded', { bubbles: true }))
      window.dispatchEvent(new Event('load'))
      sync()
      notifyReady()
      let lastTime = performance.now()
      const timer = window.setInterval(() => {
        if (disposed) { clearInterval(timer); return }
        const now = performance.now()
        send({ type: 'stats', stats: { fps: running() ? frames * 1000 / (now - lastTime) : 0 } })
        frames = 0
        lastTime = now
      }, 1000)
      window.setTimeout(() => { if (!ready && !disposed) fail(new Error('网页模型加载超时，请查看资源是否完整。')) }, 45000)
    } catch (error) { fail(error) }
  })
}

export const webFrameDocument = `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' blob:; style-src 'unsafe-inline' blob:; img-src data: blob:; media-src data: blob:; connect-src data: blob:; worker-src blob:; font-src data: blob:; base-uri https://wallpaper.invalid">
<style>html,body{width:100%;height:100%;margin:0;overflow:hidden}</style></head><body>
<script>(${startWebFrame.toString()})()</script></body></html>`
