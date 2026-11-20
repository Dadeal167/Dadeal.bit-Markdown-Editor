import { lobbyMediaKind } from '../media/mediaAssets'
import type { LobbyMediaSource } from '../lobbyDatabase'
import { TextureAtlas } from '@esotericsoftware/spine-webgl'
import { scenePropertyDefinitions, type WallpaperSceneSource, type WallpaperWebSource } from './wallpaperScene'
import { WALLPAPER_TIME_FILE } from './useWallpaperTime'

export interface WallpaperSpine {
  label: string
  files: File[]
  path: string
}

function projectPath(value: unknown): string {
  if (typeof value !== 'string') return ''
  const path = value.trim().replace(/\\/g, '/').replace(/^(?:\.\/)+/, '')
  if (!path || path.startsWith('/') || /[:\u0000-\u001f]/.test(path)) return ''
  const parts = path.split('/')
  return parts.some((part) => !part || part === '..' || part === '.') ? '' : path.toLowerCase()
}

export async function readWallpaperProject(files: File[]) {
  const paths = new Map<string, File>()
  for (const file of files) {
    const relative = file.webkitRelativePath
    const path = projectPath(relative ? relative.slice(relative.indexOf('/') + 1) : file.name)
    if (path) paths.set(path, file)
  }
  const manifest = paths.get('project.json')
  if (!manifest) throw new Error('未找到 project.json。请选择单个 Wallpaper Engine 壁纸的文件夹。')
  if (manifest.size > 2 * 1024 * 1024) throw new Error('Wallpaper Engine 项目配置过大，无法读取。')

  let config: Record<string, unknown>
  try {
    const data: unknown = JSON.parse(await manifest.text())
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error()
    config = data as Record<string, unknown>
  } catch {
    throw new Error('无法读取 project.json。请选择有效的 Wallpaper Engine 项目。')
  }

  const folder = manifest.webkitRelativePath.split('/')[0]
  const title = (typeof config.title === 'string' ? config.title.replace(/\s+/g, ' ').trim().slice(0, 160) : '') || folder || 'Wallpaper Engine 壁纸'
  const type = typeof config.type === 'string' ? config.type.trim().toLowerCase() : ''
  let scene: WallpaperSceneSource | null = null
  if (type === 'scene') {
    const declared = projectPath(config.file)
    const loose = declared.endsWith('.json') && paths.has(declared)
    const entry = loose ? declared : declared.endsWith('.pkg') && paths.has(declared) ? declared : 'scene.pkg'
    const file = paths.get(entry)
    if (file && (loose || new TextDecoder().decode(await file.slice(0, 40).arrayBuffer()).includes('PKGV'))) {
      scene = { kind: 'scene', name: title + ' · 场景', entry, project: config,
        files: [...paths].map(([path, file]) => ({ path, file })), properties: scenePropertyDefinitions(config) }
    }
  }
  const spines: WallpaperSpine[] = []
  const versions = new Set<string>()
  if (type === 'web') {
    for (const [path, file] of paths) {
      if (!path.endsWith('.skel')) continue
      const header = new TextDecoder().decode(await file.slice(0, 64).arrayBuffer())
      const version = /\b(\d+\.\d+\.\d+)\b/.exec(header)?.[1]
      if (version) versions.add(version)
      if (!new TextDecoder().decode(await file.slice(9, 16).arrayBuffer()).startsWith('4.2.')) continue
      const atlasFile = paths.get(path.replace(/\.skel$/, '.atlas'))
      if (!atlasFile) continue
      const base = path.slice(0, path.lastIndexOf('/') + 1)
      try {
        const atlas = new TextureAtlas(await atlasFile.text())
        const textures = atlas.pages.map((page) => {
          const local = paths.get(base + projectPath(page.name))
          return local ?? paths.get(projectPath(page.name))
        })
        if (!atlas.pages.length || textures.some((image) => !image)) continue
        const resolution = /(?:^|[/_-])(2k|4k|8k)(?:\/|$)/i.exec(base)?.[1]?.toUpperCase()
        spines.push({ path, label: resolution ?? (spines.length ? base.replace(/\/$/, '') : '标准'),
          files: [file, atlasFile, ...textures as File[]] })
      } catch { /* 检查其他完整资源组。 */ }
    }
    const rank = (label: string) => label === '8K' ? 2 : label === '4K' ? 1 : 0
    spines.sort((a, b) => rank(a.label) - rank(b.label) || a.path.localeCompare(b.path))
  }
  const original = paths.get(projectPath(config.file))
  const webEntry = projectPath(config.file)
  const web: WallpaperWebSource | null = type === 'web' && original && /\.html?$/i.test(webEntry) &&
    [...paths.keys()].some((path) => /(?:\.model3|\.model)\.json$/i.test(path))
    ? { kind: 'web', name: title + ' · Live2D', entry: webEntry, project: config,
      files: [...paths].map(([path, file]) => ({ path, file })), properties: scenePropertyDefinitions(config) } : null
  const kind = original ? lobbyMediaKind(original) : null
  const main: LobbyMediaSource | null = original && kind && (type === kind || !type)
    ? { file: original, name: `${title} · Wallpaper Engine`, timeConfig: kind === 'video' ? paths.get(WALLPAPER_TIME_FILE) : undefined } : null
  const previewFile = paths.get(projectPath(config.preview))
  const preview: LobbyMediaSource | null = previewFile && lobbyMediaKind(previewFile) === 'image'
    ? { file: previewFile, name: `${title} · 壁纸预览图` } : null
  const types = new Map([['scene', '场景壁纸'], ['web', '网页壁纸'], ['application', '应用壁纸']])
  const reason = type === 'video' || type === 'image'
    ? '项目中的背景文件缺失或格式不受支持。'
    : type === 'web' && versions.size && !spines.length
      ? `此网页项目使用 Spine ${[...versions].join('、')}，当前直接导入支持 Spine 4.2。`
      : `当前版本通过窗口共享显示${types.get(type) ?? '此类 Wallpaper Engine 项目'}。`
  return { main, preview, spines, scene, web, reason, title, type }
}
