interface DesktopConnection {
  port: number
  key: string
}

const STORAGE_KEY = 'dadealbit-desktop-zhihu-session'
let memory: DesktopConnection | null = null

function connection(port: unknown, key: unknown): DesktopConnection | null {
  const parsedPort = Number(port)
  return Number.isInteger(parsedPort) && parsedPort >= 1024 && parsedPort <= 65535 &&
    typeof key === 'string' && /^[A-Za-z0-9_-]{43}$/.test(key) ? { port: parsedPort, key } : null
}

export function desktopZhihuConnection(): DesktopConnection | null {
  if (location.protocol !== 'file:') return null
  const params = new URLSearchParams(location.hash.slice(1))
  if (params.has('desktop-zhihu-key') || params.has('desktop-zhihu-port')) {
    memory = connection(params.get('desktop-zhihu-port'), params.get('desktop-zhihu-key'))
    params.delete('desktop-zhihu-key')
    params.delete('desktop-zhihu-port')
    try {
      const rest = params.toString()
      history.replaceState(null, '', location.pathname + location.search + (rest ? '#' + rest : ''))
      if (memory) sessionStorage.setItem(STORAGE_KEY, JSON.stringify(memory))
      else sessionStorage.removeItem(STORAGE_KEY)
    } catch { /* The pairing remains available in this page's memory. */ }
    return memory
  }
  if (memory) return memory
  try {
    const saved = JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? 'null')
    return saved ? connection(saved.port, saved.key) : null
  } catch { return null }
}

export async function queryDesktopZhihu(desktop: DesktopConnection, path: 'extract' | 'images',
  payload: { url: string } | { images: string[] }, signal: AbortSignal): Promise<Record<string, unknown>> {
  let response: Response
  try {
    response = await fetch('http://127.0.0.1:' + desktop.port + '/' + path, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + desktop.key, 'Content-Type': 'application/json' },
      credentials: 'omit',
      redirect: 'error',
      body: JSON.stringify(payload),
      signal: AbortSignal.any([signal, AbortSignal.timeout(path === 'extract' ? 180000 : 26000)]),
    })
  } catch (cause) {
    signal.throwIfAborted()
    if (cause instanceof DOMException && cause.name === 'TimeoutError') {
      throw new Error('桌面提取超时。请在桌面提取器中检查知乎页面，再重试。')
    }
    throw new Error('未连接桌面提取器。请从桌面提取器点击「连接 Markdown 编辑器」并重新打开此文件。')
  }
  const result = await response.json() as Record<string, unknown>
  if (!response.ok) throw new Error(typeof result?.error === 'string' ? result.error : '桌面提取器返回了错误。')
  return result
}
