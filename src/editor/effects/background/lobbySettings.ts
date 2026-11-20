import type { LobbyInteractionOptions } from './spine/lobbyInteraction'

export const LOBBY_OPTIONS_KEY = 'md-editor-memory-lobby-v1'
export const MIN_LOBBY_OPACITY = 0
export const BUILT_IN_WALLPAPER_ID = 'built-in:CH0294_home'
export const BUILT_IN_WALLPAPER_NAME = 'CH0294 海边壁纸'
const LAYOUT_KEY_PREFIX = 'md-editor-memory-lobby-layout-v1:'

export interface LobbyLayout {
  editorX: number | null
  editorTop: number
  zoom: number
  spineX: number
  spineY: number
  mediaFit: 'cover' | 'contain'
}

export const DEFAULT_LOBBY_LAYOUT: LobbyLayout = { editorX: null, editorTop: 18, zoom: 100, spineX: 0, spineY: 0, mediaFit: 'cover' }

function bounded(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback
}

export function loadLobbyLayout(id: string, fallback: LobbyLayout = DEFAULT_LOBBY_LAYOUT): LobbyLayout {
  try {
    const saved = JSON.parse(localStorage.getItem(LAYOUT_KEY_PREFIX + id) ?? 'null') as Partial<LobbyLayout> | null
    return {
      editorX: saved && Object.hasOwn(saved, 'editorX')
        ? (typeof saved.editorX === 'number' ? bounded(saved.editorX, 0, 100, 50) : null) : fallback.editorX,
      editorTop: bounded(saved?.editorTop, 0, 180, fallback.editorTop),
      zoom: bounded(saved?.zoom, 40, 220, fallback.zoom),
      spineX: bounded(saved?.spineX, -50, 50, fallback.spineX),
      spineY: bounded(saved?.spineY, -50, 50, fallback.spineY),
      mediaFit: saved?.mediaFit === 'contain' || saved?.mediaFit === 'cover' ? saved.mediaFit : fallback.mediaFit,
    }
  } catch {
    return fallback
  }
}

export function saveLobbyLayout(id: string, layout: LobbyLayout) {
  try {
    localStorage.setItem(LAYOUT_KEY_PREFIX + id, JSON.stringify(layout))
  } catch {
    // 存储不可用时，当前页面仍可调整布局。
  }
}

export interface LobbyOptions extends LobbyInteractionOptions {
  enabled: boolean
  playing: boolean
  opacity: number
  material: 'glass' | 'frosted' | 'solid'
  blur: number
  meteors: boolean
  pauseWhileEditing: boolean
}

export function loadLobbyOptions(): LobbyOptions {
  const motion = !matchMedia('(prefers-reduced-motion: reduce)').matches
  const defaults: LobbyOptions = {
    enabled: false, playing: motion, opacity: 74, material: 'glass', blur: 15,
    gaze: motion, headPat: true, meteors: true, pauseWhileEditing: false,
  }
  try {
    const saved = JSON.parse(localStorage.getItem(LOBBY_OPTIONS_KEY) ?? 'null') as Partial<LobbyOptions> | null
    return {
      enabled: saved?.enabled === true,
      playing: typeof saved?.playing === 'boolean' ? saved.playing : defaults.playing,
      opacity: bounded(saved?.opacity, MIN_LOBBY_OPACITY, 100, defaults.opacity),
      material: saved?.material === 'frosted' || saved?.material === 'solid' ? saved.material : defaults.material,
      blur: bounded(saved?.blur, 0, 32, defaults.blur),
      gaze: typeof saved?.gaze === 'boolean' ? saved.gaze : defaults.gaze,
      headPat: typeof saved?.headPat === 'boolean' ? saved.headPat : defaults.headPat,
      meteors: typeof saved?.meteors === 'boolean' ? saved.meteors : defaults.meteors,
      pauseWhileEditing: saved?.pauseWhileEditing === true,
    }
  } catch {
    return defaults
  }
}
