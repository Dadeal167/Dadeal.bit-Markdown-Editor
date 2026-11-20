import type { WallpaperClipPlan } from './wallpaperTime'

// 自包含函数，普通视频和隔离 iframe 中的场景视频纹理共用。
export function createWallpaperVideoClip({ active, standby, swap, plan }: {
  active(): HTMLVideoElement
  standby(): HTMLVideoElement
  swap(fade: boolean): void
  plan(duration: number): WallpaperClipPlan | undefined
}) {
  let hasPlayed = false
  let playedPeriod: string | undefined
  let entry: { at: string; start: number; end?: number } | undefined
  let holdSince: number | undefined
  let prepared: { video: HTMLVideoElement; start: number; running: boolean } | undefined
  let overlap: { video: HTMLVideoElement; at: string; loopStart: number; from: number; to: number } | undefined
  const stopStandby = () => {
    prepared?.video.pause()
    prepared = undefined
    overlap = undefined
  }
  const warm = (start: number, run: boolean) => {
    const video = standby()
    if (prepared?.video !== video || prepared.start !== start) {
      stopStandby()
      prepared = { video, start, running: false }
    }
    if (video.readyState < 1 || video.seeking) return
    const offset = video.currentTime - start
    if (offset < 0 || offset > (prepared.running ? .22 : .02)) {
      video.pause()
      prepared.running = false
      video.currentTime = start
      return
    }
    if (video.readyState < 2) return
    // 慢速预滚确认解码链已在产出帧。限制跨过的距离，给短片段留出余量。
    if (prepared.running && offset >= .16) video.pause()
    else if (run && !prepared.running) {
      prepared.running = true
      video.playbackRate = .125
      void video.play().catch(() => {})
    }
    return video
  }
  const frameRange = (timing: WallpaperClipPlan): [number, number] =>
    entry?.at === timing.at ? [entry.start, entry.end ?? timing.range[1]] : timing.range
  const begin = (timing: WallpaperClipPlan, intro: WallpaperClipPlan['entry']) => {
    playedPeriod = timing.at
    entry = intro ? { at: timing.at, start: intro.start, end: intro.end } : undefined
  }

  return {
    get holding() { return holdSince !== undefined },
    reset() { holdSince = undefined; stopStandby() },
    loopBlend() {
      if (!overlap || overlap.video.paused || overlap.video.seeking || overlap.video.readyState < 2) return
      const progress = Math.max(0, Math.min(1, (active().currentTime - overlap.from) / (overlap.to - overlap.from)))
      return { video: overlap.video, mix: progress * progress * (3 - 2 * progress) }
    },
    allowsFrame(video: HTMLVideoElement) {
      const timing = plan(video.duration)
      if (!timing) return true
      const [start, end] = frameRange(timing)
      return !video.seeking && video.currentTime >= start && video.currentTime < end
    },
    tick(): boolean {
      const video = active()
      const timing = plan(video.duration)
      if (!timing) {
        if (holdSince !== undefined) void video.play().catch(() => {})
        holdSince = undefined
        hasPlayed = false
        playedPeriod = undefined
        entry = undefined
        stopStandby()
        return false
      }
      const loopStart = timing.range[0]
      const [start, end] = frameRange(timing)
      if (overlap && (video.seeking || overlap.at !== timing.at || overlap.loopStart !== loopStart ||
        overlap.to !== end || video.currentTime < overlap.from || overlap.video.currentTime >= end)) stopStandby()
      if (video.seeking || video.readyState < 1) return true
      const intro = hasPlayed && timing.entry && timing.entry.from === playedPeriod ? timing.entry : undefined
      if (intro || video.currentTime < start || video.currentTime >= end) {
        const seekTo = intro?.start ?? loopStart
        const waiting = holdSince === undefined ? 0 : performance.now() - holdSince
        const spare = overlap?.video ?? (hasPlayed ? warm(seekTo, true) : undefined)
        const running = spare && !spare.paused && spare.currentTime >= seekTo + .025
        if (spare && !spare.seeking && spare.readyState >= 2 && (running || waiting >= 180)) {
          const fade = playedPeriod !== undefined && (playedPeriod !== timing.at || entry?.end !== undefined)
          begin(timing, intro)
          spare.playbackRate = video.playbackRate || 1
          prepared = undefined
          overlap = undefined
          holdSince = undefined
          swap(fade)
        } else if (!hasPlayed || waiting >= 900) {
          stopStandby()
          begin(timing, intro)
          video.currentTime = seekTo
          if (holdSince !== undefined) void video.play().catch(() => {})
          holdSince = undefined
        } else if (holdSince === undefined) {
          holdSince = performance.now()
          video.pause()
        }
        return true
      }
      if (holdSince !== undefined) {
        holdSince = undefined
        void video.play().catch(() => {})
      }
      hasPlayed ||= video.readyState >= 2
      if (video.readyState >= 2) playedPeriod = timing.at
      if (entry && entry.end === undefined && video.currentTime >= loopStart) entry = undefined
      if (overlap) return true
      const rate = video.playbackRate || 1
      const tail = end - video.currentTime
      const remaining = tail / rate
      const next = timing.next
      if (next && next.seconds < remaining && next.seconds <= 2) {
        warm(next.start, next.seconds <= .75)
      } else if (remaining <= 2) {
        const spare = warm(loopStart, remaining <= 1.1)
        const span = Math.min(.32 * rate, (end - loopStart) * .22)
        if (!entry && tail <= span && spare && !spare.paused && spare.currentTime >= loopStart + .025) {
          // 两段都以正常速度推进，在原片尾抵达终点前交接画面。
          spare.playbackRate = rate
          overlap = { video: spare, at: timing.at, loopStart, from: video.currentTime, to: end }
        }
      }
      return true
    },
  }
}
