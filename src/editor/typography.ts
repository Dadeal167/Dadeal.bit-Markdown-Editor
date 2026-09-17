/**
 * 正文排版设置（字号 / 字体）与文字颜色。
 *
 * 范围说明（和公式弹窗里的字体功能**不重叠**）：
 * - 这里的字号 / 字体作用于**整篇正文**（写作用户的阅读偏好），存在 localStorage
 * - 文字颜色作用于**选中的正文文字**（套一个 mark，随 Markdown 以 <span style="color:…"> 存下来）
 * - 公式的外观仍然只由公式弹窗控制：数学节点显式 `marks: ''`，颜色/字体都碰不到它
 */

export interface Typography {
  /** 正文字号（px） */
  size: number
  /** 正文字体（CSS font-family 值；空串表示跟随系统默认） */
  family: string
}

export const TYPOGRAPHY_KEY = 'md-editor-typography-v1'

export const FONT_SIZES: { label: string; value: number }[] = [
  { label: '小', value: 14 },
  { label: '标准', value: 16 },
  { label: '大', value: 18 },
  { label: '特大', value: 20 },
  { label: '超大', value: 24 },
]

export const FONT_FAMILIES: { label: string; value: string; sample: string }[] = [
  { label: '系统默认', value: '', sample: 'Aa 数学笔记' },
  { label: '黑体', value: '"Microsoft YaHei", "PingFang SC", "Heiti SC", sans-serif', sample: 'Aa 数学笔记' },
  { label: '宋体', value: 'SimSun, "Songti SC", "Noto Serif SC", serif', sample: 'Aa 数学笔记' },
  { label: '楷体', value: 'KaiTi, "Kaiti SC", STKaiti, "Noto Serif SC", serif', sample: 'Aa 数学笔记' },
  { label: '仿宋', value: 'FangSong, STFangsong, "Noto Serif SC", serif', sample: 'Aa 数学笔记' },
  { label: '等线', value: 'DengXian, "Microsoft YaHei", sans-serif', sample: 'Aa 数学笔记' },
  { label: '衬线英文', value: 'Georgia, "Times New Roman", "Songti SC", serif', sample: 'Aa 数学笔记' },
  { label: '等宽', value: 'Consolas, "Courier New", "Microsoft YaHei", monospace', sample: 'Aa 数学笔记' },
]

/** 正文文字颜色（作用于选中内容） */
export const TEXT_COLORS: { label: string; value: string }[] = [
  { label: '黑色', value: '#191b1f' },
  { label: '红色', value: '#d93025' },
  { label: '橙色', value: '#e8710a' },
  { label: '金色', value: '#b8860b' },
  { label: '绿色', value: '#188038' },
  { label: '蓝色', value: '#1772f6' },
  { label: '紫色', value: '#7b1fa2' },
  { label: '灰色', value: '#8491a5' },
]

export const DEFAULT_TYPOGRAPHY: Typography = { size: 16, family: '' }

export function loadTypography(): Typography {
  try {
    const raw = localStorage.getItem(TYPOGRAPHY_KEY)
    if (!raw) return { ...DEFAULT_TYPOGRAPHY }
    const saved = JSON.parse(raw) as Partial<Typography>
    const size =
      typeof saved.size === 'number' && saved.size >= 12 && saved.size <= 40
        ? saved.size
        : DEFAULT_TYPOGRAPHY.size
    const family = typeof saved.family === 'string' ? saved.family : DEFAULT_TYPOGRAPHY.family
    return { size, family }
  } catch {
    return { ...DEFAULT_TYPOGRAPHY }
  }
}

export function saveTypography(t: Typography): void {
  try {
    localStorage.setItem(TYPOGRAPHY_KEY, JSON.stringify(t))
  } catch {
    /* 存不下就只在本会话生效 */
  }
}

/** 把设置写成 CSS 变量（正文与导出都用同一套变量） */
export function applyTypography(t: Typography, root: HTMLElement = document.documentElement): void {
  root.style.setProperty('--doc-font-size', `${t.size}px`)
  if (t.family) root.style.setProperty('--doc-font-family', t.family)
  else root.style.removeProperty('--doc-font-family')
}

/** 导出 HTML 时内联同样的样式，保证导出的文件也是用户选的排版 */
export function typographyCss(t: Typography): string {
  return [
    `  body { font-size: ${t.size}px;${t.family ? ` font-family: ${t.family};` : ''} }`,
    '  .zh-prose h1 { font-size: 1.5em; }',
    '  .zh-prose h2 { font-size: 1.31em; }',
    '  .zh-prose h3 { font-size: 1.19em; }',
  ].join('\n')
}
