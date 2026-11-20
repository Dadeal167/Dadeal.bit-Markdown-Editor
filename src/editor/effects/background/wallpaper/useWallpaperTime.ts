import { useEffect, useState } from 'react'
import { loadWallpaperTime, validateWallpaperTime, type WallpaperTimeSettings } from './wallpaperTime'

type Preset = WallpaperTimeSettings & { match: { bytes: number; sha256: string } }
const presets = Object.values(import.meta.glob<Preset>('../../../../../examples/wallpaper-time/*.json', { eager: true, import: 'default' }))

export const WALLPAPER_TIME_FILE = 'wallpaper-time.json'

async function findAutomaticSchedule(media: File, sidecar?: File) {
  if (sidecar && sidecar.size <= 16_384) {
    try {
      const schedule = validateWallpaperTime(JSON.parse(await sidecar.text()))
      if (schedule) return schedule
    } catch { /* 仍可匹配已知素材。 */ }
  }
  const candidates = presets.filter(({ match }) => match?.bytes === media.size)
  if (!candidates.length) return null
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', await media.arrayBuffer()))
  const signature = Array.from(hash, (byte) => byte.toString(16).padStart(2, '0')).join('')
  return validateWallpaperTime(candidates.find(({ match }) => match.sha256 === signature))
}

export function useWallpaperTime(id: string, media?: File, sidecar?: File) {
  const [preference, setPreference] = useState(() => loadWallpaperTime(id))
  const [preset, setPreset] = useState<WallpaperTimeSettings | null | undefined>(undefined)
  const canMatch = Boolean(media && (sidecar || presets.some(({ match }) => match?.bytes === media.size)))

  useEffect(() => {
    if (!media || !canMatch) return
    let active = true
    void findAutomaticSchedule(media, sidecar).then(
      (schedule) => { if (active) setPreset(schedule) },
      () => { if (active) setPreset(null) },
    )
    return () => { active = false }
  }, [media, sidecar, canMatch])

  return {
    schedule: preference === 'full-preview' ? null : preference ?? preset ?? null,
    pending: canMatch && preset === undefined && preference === undefined,
    automatic: preference === undefined && !!preset,
    fullPreview: preference === 'full-preview',
    preset: preset ?? null,
    setPreference,
  }
}
