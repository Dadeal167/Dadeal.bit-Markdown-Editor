export type LobbyMediaKind = 'image' | 'video'

export function lobbyMediaKind(file: File): LobbyMediaKind | null {
  if (/^image\/(png|jpe?g|webp|gif|avif|bmp)$/.test(file.type) || /\.(png|jpe?g|webp|gif|avif|bmp)$/i.test(file.name)) return 'image'
  if (/^video\//.test(file.type) || /\.(mp4|webm|ogv|mov|m4v)$/i.test(file.name)) return 'video'
  return null
}

export async function validateLobbyMedia(file: File, kind: LobbyMediaKind) {
  const url = URL.createObjectURL(file)
  try {
    if (kind === 'image') {
      const image = new Image()
      image.src = url
      await image.decode()
      return
    }
    const video = document.createElement('video')
    video.preload = 'metadata'
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = window.setTimeout(() => reject(new Error('视频加载超时。')), 12000)
        const finish = () => window.clearTimeout(timer)
        video.onloadedmetadata = () => { finish(); resolve() }
        video.onerror = () => { finish(); reject(new Error('无法解码视频。')) }
        video.src = url
      })
      if (!video.videoWidth) throw new Error('文件缺少视频画面。')
    } finally {
      video.removeAttribute('src')
      video.load()
    }
  } catch {
    throw new Error(kind === 'image' ? '无法读取图片。请选择有效的图片文件。' : '无法播放此视频。请选择浏览器支持的 MP4 或 WebM 文件。')
  } finally {
    URL.revokeObjectURL(url)
  }
}
