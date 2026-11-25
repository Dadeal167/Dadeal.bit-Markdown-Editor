import { desktopZhihuConnection, queryDesktopZhihu } from './zhihuDesktop'

const CHANNEL = 'dadealbit.zhihu-import.v1'
const MAX_IMAGE_DATA_LENGTH = 16 * 1024 * 1024 + 64

export interface ZhihuImportedArticle {
  title: string
  markdown: string
  linkedImages: number
}

export function zhihuImportUrl(value: string): string | null {
  try {
    const url = new URL(value.trim())
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return null
    if (url.hostname === 'zhuanlan.zhihu.com' && /^\/p\/\d+\/?$/.test(url.pathname)) {
      return url.origin + url.pathname.replace(/\/$/, '')
    }
    if ((url.hostname === 'www.zhihu.com' || url.hostname === 'zhihu.com') &&
        /^\/question\/\d+\/answer\/\d+\/?$/.test(url.pathname)) {
      return 'https://www.zhihu.com' + url.pathname.replace(/\/$/, '')
    }
  } catch { /* Invalid URL. */ }
  return null
}

export function requestZhihuArticle(url: string, signal: AbortSignal, progress: (message: string) => void) {
  const desktop = desktopZhihuConnection()
  if (desktop) {
    progress('桌面提取器正在读取知乎正文…')
    return queryDesktopZhihu(desktop, 'extract', { url }, signal).then((result) => {
      const article = result.url === url ? readZhihuArticle(result) : undefined
      if (!article) throw new Error('无法识别桌面提取器返回的正文。')
      return article
    })
  }
  return requestExtension({ url }, signal, progress, 45000, (data): ZhihuImportedArticle | undefined => {
    return data.url === url ? readZhihuArticle(data) : undefined
  })
}

function readZhihuArticle(data: Record<string, unknown>): ZhihuImportedArticle | undefined {
  if (typeof data.title !== 'string' || typeof data.markdown !== 'string' || !data.markdown.trim() ||
    data.markdown.length > 21 * 1024 * 1024 || data.markdown.includes('\u0000')) return
  const linkedImages = typeof data.linkedImages === 'number' && Number.isSafeInteger(data.linkedImages) &&
    data.linkedImages > 0 ? data.linkedImages : 0
  return { title: data.title.trim().slice(0, 200) || '知乎文档', markdown: data.markdown, linkedImages }
}

export function isZhihuImageUrl(address: string): boolean {
  try {
    const url = new URL(address)
    return url.protocol === 'https:' && !url.username && !url.password && !url.port &&
      (url.hostname === 'zhimg.com' || url.hostname.endsWith('.zhimg.com'))
  } catch { return false }
}

export function requestZhihuImages(images: string[], signal: AbortSignal) {
  const requested = new Set(images)
  const readImages = (data: Record<string, unknown>) => {
    if (!Array.isArray(data.images) || data.images.length > requested.size) return
    const result = new Map<string, string>()
    for (const entry of data.images) {
      if (typeof entry?.url === 'string' && requested.has(entry.url) && typeof entry.dataUrl === 'string' &&
        /^data:image\/(?:png|jpeg|gif|webp|avif|bmp);base64,/i.test(entry.dataUrl) &&
        entry.dataUrl.length <= MAX_IMAGE_DATA_LENGTH) {
        result.set(entry.url, entry.dataUrl)
      }
    }
    return result
  }
  const desktop = desktopZhihuConnection()
  if (desktop) return queryDesktopZhihu(desktop, 'images', { images }, signal).then((result) =>
    readImages(result) ?? new Map<string, string>())
  return requestExtension({ images }, signal, () => {}, 16000, readImages, 1000)
}

function requestExtension<T>(request: { url: string } | { images: string[] }, signal: AbortSignal,
  progress: (message: string) => void, timeoutMs: number, readResult: (data: Record<string, unknown>) => T | undefined,
  connectionMs = 4000) {
  return new Promise<T>((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason)
      return
    }
    const channel = new MessageChannel()
    const port = channel.port1
    let timer = window.setTimeout(() => timeout(
      '未连接知乎提取器。请从桌面提取器点击「连接 Markdown 编辑器」，也可启用新版浏览器扩展。'), connectionMs)
    function finish(settle: () => void) {
      window.clearTimeout(timer)
      signal.removeEventListener('abort', cancel)
      port.close()
      settle()
    }
    function cancel() {
      port.postMessage({ type: 'cancel' })
      finish(() => reject(signal.reason))
    }
    function timeout(message: string) {
      port.postMessage({ type: 'cancel' })
      finish(() => reject(new Error(message)))
    }
    signal.addEventListener('abort', cancel, { once: true })
    port.onmessage = ({ data }) => {
      if (data?.type === 'ready') {
        window.clearTimeout(timer)
        timer = window.setTimeout(() => timeout('提取器响应超时。请稍后重试。'), timeoutMs)
      } else if (data?.type === 'progress' && typeof data.message === 'string') {
        progress(data.message)
      } else if (data?.type === 'error' && typeof data.message === 'string') {
        finish(() => reject(new Error(data.message)))
      } else {
        const result = data?.type === 'result' ? readResult(data) : undefined
        if (result !== undefined) finish(() => resolve(result))
        else finish(() => reject(new Error('提取器返回的数据无法识别。请确认编辑器和扩展均已更新。')))
      }
    }
    // A file:// document has an opaque origin. The transferred port carries replies to this request only.
    window.postMessage({ type: CHANNEL, ...request }, '*', [channel.port2])
  })
}
