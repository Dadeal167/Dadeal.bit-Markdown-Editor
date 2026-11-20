export interface WallpaperTimePeriod {
  at: string
  start: number
  end: number
  entryStart?: number
  entryEnd?: number
}

export interface WallpaperTimeSettings {
  texture: string
  periods: WallpaperTimePeriod[]
}

export interface WallpaperVideoTexture {
  name: string
  duration: number
}

// undefined 使用自动配置；整段预览是有明确标签的主动选择。
export type WallpaperTimePreference = WallpaperTimeSettings | 'full-preview' | undefined
export interface WallpaperClipPlan {
  at: string
  range: [number, number]
  entry?: { start: number; end?: number; from: string }
  next?: { start: number; seconds: number }
}

export function validateWallpaperTime(value: unknown): WallpaperTimeSettings | null {
  if (!value || typeof value !== 'object') return null
  const { texture, periods } = value as Partial<WallpaperTimeSettings>
  if (typeof texture !== 'string' || !texture || !Array.isArray(periods) || !periods.length || periods.length > 12) return null
  if (periods.some((period) => {
    if (!period || typeof period.at !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(period.at) ||
      !Number.isFinite(period.start) || !Number.isFinite(period.end) || period.start < 0 || period.end - period.start < 0.25) return true
    const { entryStart, entryEnd } = period
    if (entryStart === undefined) return entryEnd !== undefined
    const end = entryEnd === undefined ? period.start : entryEnd
    return !Number.isFinite(entryStart) || entryStart < 0 || !Number.isFinite(end) || end - entryStart < 0.25
  })) return null
  if (new Set(periods.map((period) => period.at)).size !== periods.length) return null
  return { texture, periods: periods.map(({ at, start, end, entryStart, entryEnd }) => ({ at, start, end, entryStart, entryEnd }))
    .sort((a, b) => a.at.localeCompare(b.at)) }
}

// 自包含函数，也会在场景的隔离 iframe 内调用。
export function wallpaperClipPlan(schedule: WallpaperTimeSettings | null, texture: string, duration: number, now?: Date): WallpaperClipPlan | undefined {
  if (!schedule || schedule.texture !== texture || !Number.isFinite(duration) || duration <= 0) return
  if (schedule.periods.some(({ end, entryEnd }) => Math.max(end, entryEnd ?? 0) > duration)) return
  const time = now ?? new Date()
  const clock = String(time.getHours()).padStart(2, '0') + ':' + String(time.getMinutes()).padStart(2, '0')
  const index = schedule.periods.findIndex(({ at }) => at > clock)
  const currentIndex = (index > 0 ? index : schedule.periods.length) - 1
  const period = schedule.periods[currentIndex]
  if (!period) return
  const next = schedule.periods[index < 0 ? 0 : index]
  const plan: WallpaperClipPlan = { at: period.at, range: [period.start, period.end] }
  if (next !== period) {
    const secondsAt = (at: string) => Number(at.slice(0, 2)) * 3600 + Number(at.slice(3)) * 60
    const secondsNow = time.getHours() * 3600 + time.getMinutes() * 60 + time.getSeconds() + time.getMilliseconds() / 1000
    const elapsed = (secondsNow - secondsAt(period.at) + 86400) % 86400
    if (period.entryStart !== undefined && elapsed < 4) {
      const previous = schedule.periods[(currentIndex - 1 + schedule.periods.length) % schedule.periods.length]
      plan.entry = { start: period.entryStart, end: period.entryEnd === period.start ? undefined : period.entryEnd, from: previous.at }
    }
    const seconds = (secondsAt(next.at) - secondsNow + 86400) % 86400
    plan.next = { start: next.entryStart ?? next.start, seconds }
  }
  return plan
}

const keyFor = (id: string) => 'md-editor-wallpaper-time-v1:' + id

export function loadWallpaperTime(id: string): WallpaperTimePreference {
  try {
    const saved = localStorage.getItem(keyFor(id))
    if (saved === null) return undefined
    const value: unknown = JSON.parse(saved)
    return value === 'full-preview' ? value : validateWallpaperTime(value) ?? undefined
  } catch { return undefined }
}

export function saveWallpaperTime(id: string, schedule: WallpaperTimePreference) {
  if (schedule === undefined) localStorage.removeItem(keyFor(id))
  else localStorage.setItem(keyFor(id), JSON.stringify(schedule))
}
