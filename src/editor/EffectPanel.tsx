import type { MouseEffectSettings } from './effects/mouseEffect'

interface Props {
  open: boolean
  onOpenChange(open: boolean): void
  settings: MouseEffectSettings
  onChange(next: MouseEffectSettings): void
  onReset(): void
}

/** 纯净版构建用的空组件（vite.config.ts 在 `--mode pure` 时把 EffectPanel 指到这里）。 */
export default function EffectPanel(_props: Props) {
  return null
}
