import { BlendMode, Color, type GLTexture, type SceneRenderer, type Skeleton } from '@esotericsoftware/spine-webgl'

// CH0294 的前两组流星对应 Unity Timeline 的第 0 和第 80 帧，第二组持续 14 秒。
const openingEnd = 80 / 30
const secondGroupEnd = openingEnd + 14
const meteorTail = [
  { at: 0, alpha: 0.85, width: 1, u: 0.28 },
  { at: 0.17, alpha: 0.64, width: 0.80, u: 0.45 },
  { at: 0.46, alpha: 0.43, width: 0.53, u: 0.56 },
  { at: 0.76, alpha: 0.26, width: 0.29, u: 0.69 },
  { at: 1, alpha: 0, width: 0.15, u: 0.82 },
]
const meteorTailIndices = meteorTail.slice(1).flatMap((_, index) => {
  const a = index * 2
  return [a, a + 1, a + 2, a + 2, a + 1, a + 3]
})
const meteorGroups = [
  { start: 0, end: openingEnd, lifetime: 4, interval: 0.55, speed: 545, opacity: 1 },
  { start: openingEnd, end: secondGroupEnd, lifetime: 3, interval: 0.71, speed: 625, opacity: 0.88 },
  { start: secondGroupEnd, end: Infinity, lifetime: 8, interval: 1.6, speed: 345, opacity: 0.75 },
]

function randomUnit(index: number, salt: number) {
  const value = Math.sin(index * 127.1 + salt * 311.7) * 43758.5453
  return value - Math.floor(value)
}

export function createLobbyMeteors(skeleton: Skeleton, view: SceneRenderer, meteor: GLTexture) {
  const backgroundEnd = skeleton.findSlot('BG_Wave5')?.data.index
  const characterStart = skeleton.findSlot('R_Wing_2')?.data.index
  const meteorTint = new Color()
  const tailVertices = new Float32Array(meteorTail.length * 2 * 12)

  function drawMeteor(x: number, y: number, angle: number, length: number, size: number, alpha: number) {
    const radians = angle * Math.PI / 180
    const dx = Math.cos(radians)
    const dy = Math.sin(radians)
    let i = 0
    for (const segment of meteorTail) {
      const cx = x + dx * length * segment.at
      const cy = y + dy * length * segment.at
      const halfWidth = size * 0.32 * segment.width
      for (let side = -1; side <= 1; side += 2) {
        tailVertices[i++] = cx - dy * halfWidth * side
        tailVertices[i++] = cy + dx * halfWidth * side
        tailVertices[i++] = meteorTint.r
        tailVertices[i++] = meteorTint.g
        tailVertices[i++] = 1
        tailVertices[i++] = alpha * segment.alpha
        tailVertices[i++] = segment.u
        tailVertices[i++] = 0.5 - side * 0.42
        i += 4
      }
    }
    view.batcher.draw(meteor, tailVertices, meteorTailIndices)
    // Draw the original flare at its own aspect ratio to keep the core compact.
    const flareOffset = size * 2.6 * 0.18
    meteorTint.a = alpha
    view.drawTextureRotated(meteor, x - flareOffset, y - size / 2, size * 2.6, size, flareOffset, size / 2, angle, meteorTint)
  }

  function drawMeteors(time: number) {
    view.batcher.setBlendMode(BlendMode.Additive, false)
    for (const [groupIndex, group] of meteorGroups.entries()) {
      const last = Math.floor((Math.min(time, group.end) - group.start) / group.interval)
      const first = Math.max(0, Math.ceil((time - group.start - group.lifetime) / group.interval))
      for (let index = first; index <= last; index++) {
        const age = time - group.start - index * group.interval
        if (age < 0 || age >= group.lifetime) continue
        const seed = index + groupIndex * 101
        const life = age / group.lifetime
        const angle = 54 + randomUnit(seed, 6) * 7
        const radians = angle * Math.PI / 180
        const distance = group.speed * age * (0.77 + 0.46 * randomUnit(seed, 3))
        const x = -360 + randomUnit(seed, 1) * 2220 - Math.cos(radians) * distance
        const y = 2030 + randomUnit(seed, 2) * 640 - Math.sin(radians) * distance
        const fadeNearHorizon = Math.min(1, (y - 740) / 290)
        if (fadeNearHorizon <= 0) continue
        const alpha = Math.min(life / 0.09, 1, (1 - life) / 0.48) * group.opacity * fadeNearHorizon
        const length = 430 + randomUnit(seed, 4) * 350
        const size = 13 + randomUnit(seed, 5) * 10
        const hue = randomUnit(seed, 7)
        meteorTint.set(0.73 + hue * 0.27, 0.73 - hue * 0.19, 1, alpha)
        drawMeteor(x, y, angle, length, size, alpha)
      }
    }
  }

  return (time: number, pma: boolean) => {
    if (backgroundEnd !== undefined && characterStart !== undefined) {
      view.drawSkeleton(skeleton, pma, -1, backgroundEnd)
      drawMeteors(time)
      view.drawSkeleton(skeleton, pma, characterStart)
    } else {
      view.drawSkeleton(skeleton, pma)
      drawMeteors(time)
    }
  }
}
