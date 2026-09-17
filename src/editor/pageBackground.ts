/**
 * 纸张背景色（整篇）。
 *
 * 为什么单独一个模块：它和「主题（浅色/深色）」是**两件事** ——
 * 主题决定整个界面（工具栏、面板、状态栏）的明暗，背景色只决定**那张纸**的颜色。
 * 用户要的是"换成米黄色的纸，看着不刺眼"，而不是把工具栏也染成米黄。
 *
 * 三条设计决定（都有理由，改之前先看这里）：
 *
 * 1. **只改纸，不改界面**：变量只作用在 `.editor-card`（白卡）和正文文字颜色上，
 *    工具栏 / 面板 / 状态栏仍然由主题管 —— 否则选了深色纸，菜单也会跟着变暗，
 *    而菜单的配色是跟着主题走的一整套，硬套会到处对不上。
 *
 * 2. **字色自动跟着纸走**：纸上如果是深色（用户用取色器挑了个深蓝），
 *    正文得用浅色字，否则就是深底黑字、看不见。判据用 WCAG 的相对亮度
 *    （阈值 0.42）。用户自己**给某段文字设的颜色**不受影响
 *    （那是 TextColor mark，深色模式下另有一层可读性修补，见 readableColors.ts）。
 *
 * 3. **存 localStorage 的一个新键**：不动已有的键（改了键 = 用户已有的设置全丢，
 *    这是仓库里写死的规矩）。空串表示"默认（跟随主题）"，也就是什么都不设 ——
 *    这样老用户升级上来看到的还是原来的样子。
 */

export interface PageBackground {
  /** 纸张颜色（`#rrggbb`）；空串 = 默认（跟随当前主题的纸色） */
  color: string
}

export const PAGE_BG_KEY = 'md-editor-bg-v1'

/** 预设：都是浅色纸（深字可读），想更暗就用右边的取色器自己挑 */
export const PAGE_BG_PRESETS: { label: string; value: string }[] = [
  { label: '默认', value: '' },
  { label: '白', value: '#ffffff' },
  { label: '米白', value: '#fbf8f1' },
  { label: '淡黄', value: '#fdf6e3' },
  { label: '淡绿', value: '#f1f8f2' },
  { label: '淡蓝', value: '#f0f6fd' },
  { label: '淡紫', value: '#f7f3fb' },
  { label: '浅灰', value: '#f4f5f7' },
]

export const DEFAULT_PAGE_BACKGROUND: PageBackground = { color: '' }

/** 浅纸上的字色 / 深纸上的字色（和主题里的正文色是同一档观感） */
export const INK_ON_LIGHT = '#191b1f'
export const INK_ON_DARK = '#e8eaed'

const HEX = /^#[0-9a-fA-F]{6}$/

export function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && HEX.test(value)
}

/** sRGB 分量 → 线性（WCAG 定义） */
function channel(v: number): number {
  const s = v / 255
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}

/** 相对亮度 0（黑）~ 1（白） */
export function relativeLuminance(hex: string): number {
  if (!isHexColor(hex)) return 1
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

/**
 * 这张纸算不算"深色"（要用浅色字）。
 * 阈值 0.42：0.42 以下连深灰都算进去了；上面 8 个预设的亮度都在 0.85 以上，
 * 所以正常情况下永远不会误判（只有用户自己挑深色才会触发）。
 */
export function isDarkPaper(hex: string): boolean {
  return relativeLuminance(hex) < 0.42
}

/** 正文在这张纸上该用什么字色 */
export function inkFor(hex: string): string {
  return isDarkPaper(hex) ? INK_ON_DARK : INK_ON_LIGHT
}

export function loadPageBackground(): PageBackground {
  try {
    const raw = localStorage.getItem(PAGE_BG_KEY)
    if (!raw) return { ...DEFAULT_PAGE_BACKGROUND }
    const saved = JSON.parse(raw) as Partial<PageBackground>
    return { color: isHexColor(saved.color) ? saved.color : '' }
  } catch {
    return { ...DEFAULT_PAGE_BACKGROUND }
  }
}

export function savePageBackground(bg: PageBackground): void {
  const color = isHexColor(bg.color) ? bg.color : ''
  try {
    /* 从来没设过（键都不存在）又选的是"默认" → 一个字都不写。
       这样"没用过这个功能的人"存档里不会平白多出一个键（实测过：一挂载就写，
       会留下 {"color":""} 这种看着像设置过的残渣）。 */
    if (!color && localStorage.getItem(PAGE_BG_KEY) === null) return
    localStorage.setItem(PAGE_BG_KEY, JSON.stringify({ color }))
  } catch {
    /* 存不下就只在本会话生效 */
  }
}

/**
 * 写成 CSS 变量。空串（默认）时**把变量删掉**，让主题自己的纸色生效 ——
 * 这样"默认"看起来就和没有这个功能时一模一样。
 */
export function applyPageBackground(bg: PageBackground, root: HTMLElement = document.documentElement): void {
  if (isHexColor(bg.color)) {
    root.style.setProperty('--doc-bg', bg.color)
    root.style.setProperty('--doc-ink', inkFor(bg.color))
  } else {
    root.style.removeProperty('--doc-bg')
    root.style.removeProperty('--doc-ink')
  }
}

/**
 * 导出（网页 / PDF）时内联的同一套样式。
 * 返回空串表示"没设过背景"，这时导出的文件一个字都不多 —— 老行为原样保留。
 */
export function pageBackgroundCss(bg: PageBackground): string {
  if (!isHexColor(bg.color)) return ''
  return `  body { background: ${bg.color}; color: ${inkFor(bg.color)}; }\n`
}
