import { useEffect, useRef, useState } from 'react'
import { saveWallpaperTime, validateWallpaperTime, wallpaperClipPlan, type WallpaperTimePreference, type WallpaperTimeSettings, type WallpaperVideoTexture } from './wallpaperTime'

interface DraftPeriod { at: string; start: string; end: string; entryStart: string; entryEnd: string }
const draftPeriods = (schedule: WallpaperTimeSettings | null): DraftPeriod[] =>
  schedule?.periods.map(({ at, start, end, entryStart, entryEnd }) => ({ at, start: String(start), end: String(end),
    entryStart: entryStart === undefined ? '' : String(entryStart), entryEnd: entryEnd === undefined ? '' : String(entryEnd) })) ??
  [{ at: '00:00', start: '0', end: '', entryStart: '', entryEnd: '' }]

export default function WallpaperTimeEditor({ layoutId, videos, schedule, preset, automatic, fullPreview, onChange }: {
  layoutId: string
  videos: WallpaperVideoTexture[]
  schedule: WallpaperTimeSettings | null
  preset: WallpaperTimeSettings | null
  automatic: boolean
  fullPreview: boolean
  onChange(schedule: WallpaperTimePreference): void
}) {
  const [texture, setTexture] = useState(schedule?.texture ?? '')
  const [periods, setPeriods] = useState(() => draftPeriods(schedule))
  const [message, setMessage] = useState('')
  const [now, setNow] = useState(() => new Date())
  const fileInput = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (!schedule) return
    const timer = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(timer)
  }, [schedule])
  const video = videos.find(({ name }) => name === texture) ?? videos[0]
  if (!video) return null
  const matches = (value: WallpaperTimeSettings | null) => !!value && videos.some(({ name, duration }) =>
    value.texture === name && value.periods.every(({ end, entryEnd }) => Math.max(end, entryEnd ?? 0) <= duration))
  const validPreset = preset && matches(preset) ? preset : null
  const scheduledVideo = videos.find(({ name }) => name === schedule?.texture)
  const current = scheduledVideo && wallpaperClipPlan(schedule, scheduledVideo.name, scheduledVideo.duration, now)

  const persist = (next: WallpaperTimePreference) => {
    onChange(next)
    try {
      saveWallpaperTime(layoutId, next)
      setMessage(next === undefined ? '已启用自动分时配置。' : next === 'full-preview'
        ? '正在循环预览整段视频。' : '已保存分时播放设置。')
    } catch {
      setMessage('设置已应用，浏览器存储不可用。')
    }
  }
  const apply = (value: unknown) => {
    const next = validateWallpaperTime(value)
    if (!next || !matches(next)) {
      setMessage('请确认视频轨、时段与片段范围。循环和过渡片段至少为 0.25 秒。')
      return
    }
    setTexture(next.texture)
    setPeriods(draftPeriods(next))
    persist(next)
  }
  const update = (index: number, key: keyof DraftPeriod, value: string) => {
    setPeriods((current) => current.map((period, n) => n === index ? { ...period, [key]: value } : period))
    setMessage('')
  }

  return <details className="zh-wallpaper-time">
    <summary>分时播放{current ? automatic ? '（自动）' : '（已启用）' : fullPreview ? '（整段预览）' : ''}</summary>
    {current && <p className="zh-fx__hint">当前时段从 {current.at} 开始，循环视频第 {current.range[0]}–{current.range[1]} 秒。</p>}
    {fullPreview && <p className="zh-fx__hint">整段预览会依次播放视频中的全部时段。</p>}
    {schedule && !matches(schedule) && <p role="status" className="zh-fx__hint">分时配置与当前视频轨或时长不匹配。</p>}
    {videos.length > 1 && <label className="zh-wallpaper-options__row">
      视频轨
      <select value={video.name} onChange={(event) => setTexture(event.target.value)}>
        {videos.map(({ name }) => <option key={name} value={name}>{name}</option>)}
      </select>
    </label>}
    <p className="zh-fx__hint">视频时长 {video.duration.toFixed(2)} 秒</p>
    {periods.map((period, index) => <fieldset className="zh-wallpaper-time__period" key={index}>
      <legend>时段 {index + 1}</legend>
      <label>起始时间<input type="time" value={period.at} onChange={(event) => update(index, 'at', event.target.value)} /></label>
      <label>片段起点（秒）<input type="number" min={0} max={video.duration} step="any" value={period.start}
        onChange={(event) => update(index, 'start', event.target.value)} /></label>
      <label>片段终点（秒）<input type="number" min={0} max={video.duration} step="any" value={period.end}
        onChange={(event) => update(index, 'end', event.target.value)} /></label>
      <label>原片过渡起点（秒）<input type="number" min={0} max={video.duration} step="any" placeholder="可选" value={period.entryStart}
        onChange={(event) => update(index, 'entryStart', event.target.value)} /></label>
      {period.entryStart !== '' && <label>原片过渡终点（秒）
        <input type="number" min={0} max={video.duration} step="any" placeholder="默认循环起点" value={period.entryEnd}
          onChange={(event) => update(index, 'entryEnd', event.target.value)} />
      </label>}
      {periods.length > 1 && <button className="zh-fx__pick" type="button" aria-label={`移除时段 ${index + 1}`}
        onClick={() => setPeriods((current) => current.filter((_, n) => n !== index))}>移除</button>}
    </fieldset>)}
    <div className="zh-fx__lobby-actions">
      <button className="zh-fx__pick" type="button" disabled={periods.length >= 12}
        onClick={() => setPeriods((current) => [...current, { at: '', start: '0', end: '', entryStart: '', entryEnd: '' }])}>添加时段</button>
      <button className="zh-fx__pick" type="button" onClick={() => fileInput.current?.click()}>导入分时配置</button>
      <button className="zh-fx__pick" type="button" onClick={() => apply({ texture: video.name, periods: periods.map(({ at, start, end, entryStart, entryEnd }) =>
        ({ at, start: start === '' ? NaN : Number(start), end: end === '' ? NaN : Number(end),
          entryStart: entryStart === '' ? undefined : Number(entryStart),
          entryEnd: entryStart === '' || entryEnd === '' ? undefined : Number(entryEnd) })) })}>应用分时播放</button>
      {schedule && <button className="zh-fx__pick" type="button" onClick={() => persist('full-preview')}>预览整段视频</button>}
      {validPreset && !automatic && <button className="zh-fx__pick" type="button" onClick={() => {
        setTexture(validPreset.texture)
        setPeriods(draftPeriods(validPreset))
        persist(undefined)
      }}>使用自动分时</button>}
    </div>
    <input ref={fileInput} type="file" accept=".json,application/json" hidden onChange={async (event) => {
      const input = event.currentTarget
      const file = input.files?.[0]
      input.value = ''
      if (!file) return
      try {
        if (file.size > 16_384) throw new Error()
        apply(JSON.parse(await file.text()))
      } catch { setMessage('无法读取分时配置文件。') }
    }} />
    {message && <p role="status" className="zh-fx__hint">{message}</p>}
  </details>
}
