import {
  applyMouseEffect,
  applyMouseEffectSettings,
  setMouseEffectColor as applySparkColor,
  type MouseEffect,
} from './mouseSpark'
import { applyCustomCursor, DEFAULT_CURSOR_HOTSPOT, normalizeHotspot, type CursorHotspot } from './customCursor'

/**
 * 鼠标特效的全部设置：档位、颜色、视觉表现参数。
 *
 * 默认值对齐原版手感：只显点击波纹、淡蓝、不透明度 80%、
 * 拖尾与点击共用一个动画速度（想分开调就把 sameSpeed 关掉）。
 */
const KEY = 'md-editor-mouse-effect-v2'

export type { MouseEffect }

export interface MouseEffectSettings {
  /** 档位：关闭 / 只显点击波纹 / 点击 + 拖尾 */
  mode: MouseEffect
  /** 颜色，值是特效内部用的 "r,g,b" 字符串 */
  color: string
  /** 第二个颜色（可选，做渐变用）；空字符串 = 单色 */
  color2: string
  /** 自己挑过的颜色（"r,g,b"），面板上排成"我的颜色"，最多 8 个 */
  customColors: string[]
  /** 彩虹：颜色随时间/位置自动流动（主色当起点色） */
  rainbow: boolean
  /** 缩放比例 0.5–3 */
  scale: number
  /** 全局不透明度 0.1–1 */
  opacity: number
  /** 拖尾与点击是否共用同一个动画速度 */
  sameSpeed: boolean
  /** 共用时的动画播放速度 0.2–3 */
  speed: number
  /** 分开调时的拖尾衰减速度 0.2–3 */
  trailSpeed: number
  /** 分开调时的点击爆发速度 0.2–3 */
  clickSpeed: number
  /** 拖尾刷新率（Hz）10–240 */
  trailHz: number
  /** 使用《蔚蓝档案》的箭头指针 */
  cursor: boolean
  /** 指针热点（"点哪儿"）：箭头是钝尖，可以自己微调到点得准 */
  cursorHotspot: CursorHotspot
  /**
   * 点击特效（圆圈）相对**真实点击点**的偏移，单位是 CSS 像素。
   *
   * 为什么单独给特效一个偏移、而且不去动指针：
   * 用户 2026-09-26 第二次报"点击特效偏左"，并且明确要求
   * **"保持鼠标指针位置不变，让点击特效往右移"** —— 也就是"指针怎么放"和"圆画在哪"
   * 必须是两件互不影响的事（早先两者绑在一起时，用户原话是"调不了"）。
   *
   * 实测（`.probe/probe-circle-vs-tip.mjs`，dpr 1 / 1.25 / 1.5 各量一遍）：
   * 圆本来就落在 `e.clientX/clientY` 上（偏差 ≤2px），也就是说**代码没把圆画歪**；
   * 但用户看到的确实偏 —— 判断基准是屏幕那枚箭头尖的可见位置（尖端本身是 6px 宽的钝口，
   * 见 measure-cursor-tip："尖端列像素数 6 → ±3px 模糊"）。
   * 结论：这种"看着不对齐"没法靠我这边量出来的数字否定掉，得**让用户自己能挪**。
   * 所以默认给一个可见的右移（DEFAULT_CLICK_OFFSET_X），再配两条滑块随时微调。
   */
  clickOffsetX: number
  clickOffsetY: number
}

/** 点击特效的默认偏移：往右一点点（用户要"往右移"），上下不动 */
export const DEFAULT_CLICK_OFFSET_X = 5
export const DEFAULT_CLICK_OFFSET_Y = 0
/** 偏移的可调范围（滑块与 normalize 共用） */
export const CLICK_OFFSET_RANGE = 40

export const DEFAULT_MOUSE_EFFECT_SETTINGS: MouseEffectSettings = {
  mode: 'click',
  color: '45,175,255',
  color2: '',
  customColors: [],
  rainbow: false,
  scale: 1.5,
  opacity: 0.8,
  sameSpeed: true,
  speed: 1,
  trailSpeed: 1,
  clickSpeed: 1,
  trailHz: 60,
  cursor: true,
  cursorHotspot: { ...DEFAULT_CURSOR_HOTSPOT },
  clickOffsetX: DEFAULT_CLICK_OFFSET_X,
  clickOffsetY: DEFAULT_CLICK_OFFSET_Y,
}

export const MOUSE_EFFECTS: { value: MouseEffect; label: string }[] = [
  { value: 'off', label: '关闭' },
  { value: 'click', label: '只显点击波纹' },
  { value: 'clickTrail', label: '点击 + 拖尾' },
]

/** 预设颜色（值是特效内部用的 "r,g,b" 字符串） */
export const MOUSE_EFFECT_COLORS: { value: string; label: string }[] = [
  { value: '45,175,255', label: '默认蓝' },
  { value: '0,200,200', label: '青' },
  { value: '160,110,255', label: '紫' },
  { value: '255,105,180', label: '粉' },
  { value: '255,190,60', label: '金' },
  { value: '60,200,120', label: '绿' },
]

const clamp = (v: number, lo: number, hi: number, fallback: number) =>
  Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback

const RGB_RE = /^\d{1,3},\d{1,3},\d{1,3}$/

/** 把存档里的值收拾成合法设置（存坏了也不至于让特效失控） */
function normalize(raw: Partial<MouseEffectSettings> | null): MouseEffectSettings {
  const d = DEFAULT_MOUSE_EFFECT_SETTINGS
  if (!raw) return { ...d }
  return {
    mode: raw.mode === 'off' || raw.mode === 'click' || raw.mode === 'clickTrail' ? raw.mode : d.mode,
    color: typeof raw.color === 'string' && RGB_RE.test(raw.color) ? raw.color : d.color,
    color2: typeof raw.color2 === 'string' && RGB_RE.test(raw.color2) ? raw.color2 : '',
    customColors: Array.isArray(raw.customColors)
      ? raw.customColors.filter((c): c is string => typeof c === 'string' && RGB_RE.test(c)).slice(0, 8)
      : [],
    rainbow: raw.rainbow === true,
    scale: clamp(Number(raw.scale), 0.5, 3, d.scale),
    opacity: clamp(Number(raw.opacity), 0.1, 1, d.opacity),
    sameSpeed: raw.sameSpeed !== false,
    speed: clamp(Number(raw.speed), 0.2, 3, d.speed),
    trailSpeed: clamp(Number(raw.trailSpeed), 0.2, 3, d.trailSpeed),
    clickSpeed: clamp(Number(raw.clickSpeed), 0.2, 3, d.clickSpeed),
    trailHz: clamp(Number(raw.trailHz), 10, 240, d.trailHz),
    // 没存过就默认开（用户就是要这枚指针）；只有明确存成 false 才关
    cursor: raw.cursor !== false,
    cursorHotspot: normalizeHotspot(raw.cursorHotspot),
    clickOffsetX: clamp(
      Number(raw.clickOffsetX),
      -CLICK_OFFSET_RANGE,
      CLICK_OFFSET_RANGE,
      DEFAULT_CLICK_OFFSET_X,
    ),
    clickOffsetY: clamp(
      Number(raw.clickOffsetY),
      -CLICK_OFFSET_RANGE,
      CLICK_OFFSET_RANGE,
      DEFAULT_CLICK_OFFSET_Y,
    ),
  }
}

export function loadMouseEffectSettings(): MouseEffectSettings {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) return normalize(JSON.parse(raw) as Partial<MouseEffectSettings>)
  } catch {
    /* 隐私模式 / 存坏了，用默认值 */
  }
  return { ...DEFAULT_MOUSE_EFFECT_SETTINGS }
}

/** 生效：档位 + 颜色 + 视觉参数一次性写进特效 */
export function applySettings(s: MouseEffectSettings): void {
  applyMouseEffect(s.mode)
  applySparkColor(s.color, s.color2, s.rainbow)
  applyCustomCursor(s.cursor, s.cursorHotspot, { x: s.clickOffsetX, y: s.clickOffsetY })
  applyMouseEffectSettings({
    scale: s.scale,
    opacity: s.opacity,
    // 共用速度时两个都用 speed；分开调时各用各的
    trailSpeed: s.sameSpeed ? s.speed : s.trailSpeed,
    clickSpeed: s.sameSpeed ? s.speed : s.clickSpeed,
    trailHz: s.trailHz,
  })
}

/** 存档并立即生效 */
export function saveMouseEffectSettings(s: MouseEffectSettings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s))
  } catch {
    /* 存不下也照样生效 */
  }
  applySettings(s)
}

/** 恢复默认设置（清掉存档） */
export function resetMouseEffectSettings(): MouseEffectSettings {
  try {
    localStorage.removeItem(KEY)
  } catch {
    /* 忽略 */
  }
  const d = { ...DEFAULT_MOUSE_EFFECT_SETTINGS }
  applySettings(d)
  return d
}

/** 颜色转成 #RRGGBB，界面上显示用 */
export function colorHex(rgb: string): string {
  const [r, g, b] = rgb.split(',').map((n) => Number(n) || 0)
  return `#${[r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('')}`
}

/** #RRGGBB → "r,g,b"（取色器返回值转成特效内部格式） */
export function hexToRgb(hex: string): string {
  const h = hex.replace('#', '')
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)).join(',')
}

/** 把一个颜色记进"我的颜色"（去重、最近用的排最前、最多 8 个） */
export function rememberColor(list: string[], rgb: string): string[] {
  if (!RGB_RE.test(rgb)) return list
  return [rgb, ...list.filter((c) => c !== rgb)].slice(0, 8)
}
