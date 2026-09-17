/**
 * 纯净版构建用的空实现（vite.config.ts 在 `--mode pure` 时把 effects/mouseSpark 指到这里）。
 *
 * 这样整段第三方特效代码（约 3 万字符）根本不会进产物，
 * 而不是"代码在、只是不调用"。函数签名与真实现保持一致，调用方不用改。
 */
export type MouseEffect = 'off' | 'click' | 'clickTrail'

export interface SparkSettings {
  scale: number
  opacity: number
  trailSpeed: number
  clickSpeed: number
  trailHz: number
}

export function applyMouseEffect(_mode: MouseEffect): void {
  /* 纯净版：没有特效 */
}

export function setMouseEffectColor(_rgb: string): void {
  /* 纯净版：没有特效 */
}

export function applyMouseEffectSettings(_s: SparkSettings): void {
  /* 纯净版：没有特效 */
}

export function readMouseEffectSettings(): SparkSettings | null {
  return null
}

export const isMouseEffectInstalled = () => false
