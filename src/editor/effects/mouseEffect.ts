/**
 * 纯净版构建用的空实现（vite.config.ts 在 `--mode pure` 时把 effects/mouseEffect 指到这里）。
 * 与真实现保持同样的导出签名，调用方不用改，但整块设置逻辑不会进产物。
 */
export type MouseEffect = 'off' | 'click' | 'clickTrail'

/** 纯净版里设置对象只是个占位（不参与任何逻辑），保持最小形状即可 */
export interface MouseEffectSettings {
  mode: MouseEffect
  [key: string]: unknown
}

export const DEFAULT_MOUSE_EFFECT_SETTINGS: MouseEffectSettings = { mode: 'off' }

export const MOUSE_EFFECTS: { value: MouseEffect; label: string }[] = []
export const MOUSE_EFFECT_COLORS: { value: string; label: string }[] = []

export const loadMouseEffectSettings = (): MouseEffectSettings => ({ ...DEFAULT_MOUSE_EFFECT_SETTINGS })
export const saveMouseEffectSettings = (_s: MouseEffectSettings): void => {}
export const applySettings = (_s: MouseEffectSettings): void => {}
export const resetMouseEffectSettings = (): MouseEffectSettings => ({ ...DEFAULT_MOUSE_EFFECT_SETTINGS })
export const colorHex = (): string => '#000000'
