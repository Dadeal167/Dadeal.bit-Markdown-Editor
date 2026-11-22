export interface Point {
  x: number
  y: number
}

const TAU = 2 * Math.PI
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y)

/** Sample at equal distances so pointer event frequency cannot affect the score. */
function sampleStroke(points: Point[], count: number): Point[] {
  const lengths = [0]
  for (let i = 1; i < points.length; i++) lengths.push(lengths[i - 1] + distance(points[i - 1], points[i]))
  const total = lengths[lengths.length - 1]
  if (total < 90) return []
  let end = 1
  return Array.from({ length: count }, (_, index) => {
    const target = (index * total) / (count - 1)
    while (end < lengths.length - 1 && lengths[end] < target) end++
    const [a, b] = [points[end - 1], points[end]]
    const segment = lengths[end] - lengths[end - 1]
    const ratio = segment ? (target - lengths[end - 1]) / segment : 0
    return { x: a.x + (b.x - a.x) * ratio, y: a.y + (b.y - a.y) * ratio }
  })
}

export function scoreCircle(stroke: Point[]): number {
  if (stroke.length < 8) return 0
  const points = sampleStroke(stroke, 128)
  if (!points.length) return 0

  const xs = points.map(point => point.x)
  const ys = points.map(point => point.y)
  const center = { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 }
  const radii = points.map(point => distance(point, center))
  const radius = radii.reduce((sum, value) => sum + value, 0) / radii.length
  if (radius < 16) return 0

  const angle = (point: Point) => Math.atan2(point.y - center.y, point.x - center.x)
  let sweep = 0
  let travel = 0
  for (let i = 1; i < points.length; i++) {
    const change = angle(points[i]) - angle(points[i - 1])
    const step = Math.atan2(Math.sin(change), Math.cos(change))
    sweep += step
    travel += Math.abs(step)
  }
  const turns = Math.abs(sweep) / TAU
  if (turns < 0.7 || turns > 1.25) return 0

  const radialError = Math.sqrt(radii.reduce((sum, r) => sum + (r / radius - 1) ** 2, 0) / radii.length)
  const gap = distance(points[0], points[points.length - 1]) / radius
  const backtracking = (travel - Math.abs(sweep)) / TAU
  const quality = 100 - 155 * radialError - 48 * gap - 80 * Math.abs(turns - 1) - 80 * backtracking
  return Math.round(Math.min(100, Math.max(0, quality)) * 10) / 10
}
