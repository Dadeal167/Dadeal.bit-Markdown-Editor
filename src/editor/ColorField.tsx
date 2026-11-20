import { useEffect, useRef, useState } from 'react'

/**
 * 面板里的取色器。
 *
 * 为什么不用系统取色器（`<input type="color">`）：实测用户那边点「挑选颜色」出不来
 * 系统调色板（那个输入框为了不显示小方块被放在屏幕外，某些浏览器就不弹了），
 * 于是"根本没法自定义颜色"。这里自己画一个：色相条 + 深浅条 + 浓淡条 + 手填色值，
 * 全部在面板里，不依赖任何系统弹窗。
 */
export interface Hsl {
  h: number // 0–360
  s: number // 0–100
  l: number // 0–100
}

/** "#ff69b4" / "ff69b4" / "#f0a" → HSL */
export function hexToHsl(hex: string): Hsl | null {
  let h = hex.trim().replace(/^#/, '')
  if (h.length === 3) h = h.split('').map((c) => c + c).join('')
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return null
  const r = parseInt(h.slice(0, 2), 16) / 255
  const g = parseInt(h.slice(2, 4), 16) / 255
  const b = parseInt(h.slice(4, 6), 16) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  const d = max - min
  let hue = 0
  if (d !== 0) {
    if (max === r) hue = ((g - b) / d) % 6
    else if (max === g) hue = (b - r) / d + 2
    else hue = (r - g) / d + 4
    hue *= 60
    if (hue < 0) hue += 360
  }
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1))
  return { h: Math.round(hue), s: Math.round(s * 100), l: Math.round(l * 100) }
}

/** HSL → "r,g,b"（特效内部用的格式） */
export function hslToRgbString({ h, s, l }: Hsl): string {
  const sn = s / 100
  const ln = l / 100
  const c = (1 - Math.abs(2 * ln - 1)) * sn
  const hp = (((h % 360) + 360) % 360) / 60
  const x = c * (1 - Math.abs((hp % 2) - 1))
  const [r1, g1, b1] =
    hp < 1 ? [c, x, 0] : hp < 2 ? [x, c, 0] : hp < 3 ? [0, c, x] : hp < 4 ? [0, x, c] : hp < 5 ? [x, 0, c] : [c, 0, x]
  const m = ln - c / 2
  return [r1, g1, b1].map((v) => Math.round((v + m) * 255)).join(',')
}

interface Props {
  /** 当前颜色的 HSL（由调用方从设置里算出来） */
  value: Hsl
  /** 拖动过程中实时回调 */
  onChange(next: Hsl): void
  /** 松手/改完（用于记进"我的颜色"） */
  onCommit?(next: Hsl): void
  label?: string
}

export default function ColorField({ value, onChange, onCommit, label }: Props) {
  const [hexText, setHexText] = useState('')
  const editing = useRef(false)
  const rgb = hslToRgbString(value)
  const hex = '#' + rgb.split(',').map((n) => Number(n).toString(16).padStart(2, '0')).join('')

  useEffect(() => {
    if (!editing.current) setHexText(hex.toUpperCase())
  }, [hex])

  const commitHex = () => {
    editing.current = false
    const next = hexToHsl(hexText)
    if (next) {
      onChange(next)
      onCommit?.(next)
    } else {
      setHexText(hex.toUpperCase())
    }
  }

  const setHueBar = (e: React.ChangeEvent<HTMLInputElement>) => {
    const next = { ...value, h: Number(e.target.value) }
    onChange(next)
    onCommit?.(next)
  }
  const setSatBar = (e: React.ChangeEvent<HTMLInputElement>) => {
    const next = { ...value, s: Number(e.target.value) }
    onChange(next)
    onCommit?.(next)
  }
  const setLightBar = (e: React.ChangeEvent<HTMLInputElement>) => {
    const next = { ...value, l: Number(e.target.value) }
    onChange(next)
    onCommit?.(next)
  }

  return (
    <div className="zh-cf">
      {label && <div className="zh-cf__label">{label}</div>}
      <div className="zh-cf__preview" style={{ background: hex }} title={hex.toUpperCase()} />
      <div className="zh-cf__bars">
        <input
          className="zh-cf__bar zh-cf__bar--hue"
          type="range"
          min={0}
          max={360}
          value={value.h}
          onChange={setHueBar}
          onMouseUp={() => onCommit?.(value)}
          aria-label="色相"
        />
        <input
          className="zh-cf__bar zh-cf__bar--sat"
          type="range"
          min={0}
          max={100}
          value={value.s}
          onChange={setSatBar}
          onMouseUp={() => onCommit?.(value)}
          aria-label="浓淡"
        />
        <input
          className="zh-cf__bar zh-cf__bar--light"
          type="range"
          min={0}
          max={100}
          value={value.l}
          onChange={setLightBar}
          onMouseUp={() => onCommit?.(value)}
          aria-label="明暗"
        />
      </div>
      <input
        className="zh-cf__hex"
        type="text"
        value={hexText}
        spellCheck={false}
        onFocus={() => {
          editing.current = true
        }}
        onChange={(e) => setHexText(e.target.value)}
        onBlur={commitHex}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        }}
        aria-label="色值"
      />
    </div>
  )
}
