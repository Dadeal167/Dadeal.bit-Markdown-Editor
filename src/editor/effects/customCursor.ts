import cursorUrl from './cursor.png'

// Original right-facing cursor. Its 96×80 canvas preserves the existing hotspot coordinates.
export interface CursorHotspot {
  x: number
  y: number
}

/**
 * 精灵图布局：图片 96×80 —— 箭头（32×32）画在左下角，**左边留 64 列、上边留 48 行**透明。
 *
 * 为什么留白：光标热点必须落在图片范围内，而"图能给的留白"直接决定箭头能相对点击点挪多远。
 * 老素材是 32×32，左右只能挪 32px、上下只能挪 19px —— 用户实际需要的偏移比这大，怎么调都对不上。
 * 现在（96×80）：左右可挪 −8…+87px，上下可挪 −12…+67px。
 * ⚠️ Chromium 对光标图的限制是 128×128，所以画布不能再大：要扩范围就得缩箭头或换更大限制的写法。
 */
export const CURSOR_SPRITE_PAD_LEFT = 64
export const CURSOR_SPRITE_PAD_TOP = 48

/**
 * 箭头尖端在图片里的像素位置 —— **从素材量出来的**，不要手写。
 *
 * 用 `node scripts/measure-cursor-tip.mjs --write` 重新量并写回下面两个常量。
 * 为什么必须量而不是记：这枚箭头的尖端是**斜切面**（最右一列连着好几个像素），
 * "尖在哪"靠眼睛记一定会偏 —— 旧默认热点偏了 22px（圆和点击点错位）就是这么来的。
 *
 * 实测（96×80 素材）：不透明范围 x 64..87 / y 48..79，最右列 x=87 上连着 6 个像素
 * （y=65..70），取中点为 (87, 68)，即尖端本身有 **±3px** 的模糊。
 */
export const TIP_PIXEL_X = 87
export const TIP_PIXEL_Y = 68

/**
 * 历史上这两个名字是分开定义的（"尖端对准"档用的坐标），其实是同一个点。
 * 现在统一成上面那一份，避免两处硬编码各自漂移 —— 这正是这次事故的成因。
 */
export const TIP_ALIGNED_X = TIP_PIXEL_X
export const TIP_ALIGNED_Y = TIP_PIXEL_Y

/** 再兼容一层旧名字（早期只有 TIP_X / TIP_Y） */
export const TIP_X = TIP_PIXEL_X
export const TIP_Y = TIP_PIXEL_Y

/** CSS 热点向左或向上移动时，素材的可见尖端相对点击点向右或向下移动。 */
export const DEFAULT_CURSOR_HOTSPOT: CursorHotspot = {
  // 校准值取自本机特效版：右移 21 CSS 像素，下移 20 CSS 像素。
  x: TIP_X - 21,
  y: TIP_Y - 20,
}

/** 面板里"整体右移多少 px"⇄ 热点 x（右移越多，x 越小） */
export const hotspotToShiftX = (x: number): number => TIP_ALIGNED_X - x
export const shiftXToHotspot = (shift: number): number => TIP_ALIGNED_X - shift

/** 面板里"整体下移多少 px"⇄ 热点 y（下移越多，y 越小） */
export const hotspotToDrop = (y: number): number => TIP_ALIGNED_Y - y
export const dropToHotspot = (drop: number): number => TIP_ALIGNED_Y - drop

const clampInt = (v: unknown, lo: number, hi: number, fallback: number) => {
  const n = Math.round(Number(v))
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback
}

/**
 * 把存档里的热点收拾成合法值。
 * 上限是**图片尺寸 − 1**：热点必须落在图里，越界的值浏览器会整条 cursor 都不认（那就变回系统箭头了）。
 */
export function normalizeHotspot(raw: Partial<CursorHotspot> | null | undefined): CursorHotspot {
  return {
    x: clampInt(raw?.x, 0, CURSOR_SPRITE_PAD_LEFT + 31, DEFAULT_CURSOR_HOTSPOT.x),
    y: clampInt(raw?.y, 0, CURSOR_SPRITE_PAD_TOP + 31, DEFAULT_CURSOR_HOTSPOT.y),
  }
}

/** 开关 + 热点：写进 `--fx-cursor`，样式表里 `cursor: var(--fx-cursor, auto)` 直接用 */
export function applyCustomCursor(
  on: boolean,
  hotspot: CursorHotspot = DEFAULT_CURSOR_HOTSPOT,
  effectOffset: { x: number; y: number } = { x: 0, y: 0 },
): void {
  try {
    const el = document.documentElement
    el.dataset.fxCursor = on ? '1' : '0'
    const { x, y } = normalizeHotspot(hotspot)
    el.style.setProperty('--fx-cursor', `url("${cursorUrl}") ${x} ${y}, auto`)
    /* 点击特效的位置 = 真实点击点 + 用户设的偏移（`clickOffsetX/Y`）。
     *
     * 这段改过两次，把来龙去脉记全，免得再来回翻：
     *
     *   第一版：锚点 = 尖端像素 − 热点，让圆**跟着箭头尖走**。
     *     想法是"用户瞄的是尖端"。问题：用户在面板里调热点时圆跟着跑，
     *     怎么调都对不齐（用户原话："调不了"）。
     *   第二版：锚点恒为 0，圆一律画在 `e.clientX/clientY`。
     *     但用户 2026-09-26 第二次报"点击特效又偏左了"，仍然要求
     *     **"保持鼠标指针位置不变，而让点击特效往右移"**。
     *   第三版（现在）：两者**彻底解耦** ——
     *     · 指针在哪 = 热点 `cursorHotspot`（面板「指针位置」那两条滑块）
     *     · 圆在哪   = `clickOffsetX/Y`（面板「点击特效位置」那两条滑块）
     *     默认给一个向右的小偏移（见 mouseEffect 里的 DEFAULT_CLICK_OFFSET_X）。
     *
     * 实测数据也记一下，省得以后又以为"是坐标算错了"：
     * `.probe/probe-circle-vs-tip.mjs` 在 dpr 1 / 1.25 / 1.5 下量圆心的实际落点，
     * 偏差分别是 (+2.7,+6.7) / (−0.9,+0.9) / (−1.8,+1.6) px —— 也就是**圆本来就在
     * 点击点上**。用户看到的偏差来自"箭头尖那 6px 宽的钝口看着像在哪儿"
     * （measure-cursor-tip：尖端列 6 像素 → ±3px 模糊）。
     * 这类"看着不对齐"不该由我这边量出来的数字去否定，给他能自己挪的旋钮就是正解。 */
    const w = window as unknown as { setEffectAnchor?: (dx: number, dy: number) => void }
    w.setEffectAnchor?.(Number(effectOffset?.x) || 0, Number(effectOffset?.y) || 0)
  } catch {
    /* 没有 document（比如单测环境）就算了 */
  }
}
