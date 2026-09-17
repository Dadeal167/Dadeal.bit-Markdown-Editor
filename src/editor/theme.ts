/**
 * 浅色 / 深色 / 跟随系统。
 * 主题只是个 data 属性（`<html data-theme="dark">`），样式集中在 index.css 里，
 * 所以切换是瞬时的，不需要重建编辑器。选择存 localStorage。
 */

export type Theme = 'light' | 'dark' | 'system'

export const THEME_KEY = 'md-editor-theme-v1'

export function loadTheme(): Theme {
  try {
    const raw = localStorage.getItem(THEME_KEY)
    if (raw === 'light' || raw === 'dark' || raw === 'system') return raw
  } catch {
    /* 忽略 */
  }
  return 'system'
}

export function saveTheme(theme: Theme): void {
  try {
    localStorage.setItem(THEME_KEY, theme)
  } catch {
    /* 忽略 */
  }
}

/** 'system' 时看系统偏好 */
export function resolveTheme(theme: Theme): 'light' | 'dark' {
  if (theme !== 'system') return theme
  if (typeof window === 'undefined' || !window.matchMedia) return 'light'
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function applyTheme(theme: Theme): 'light' | 'dark' {
  const resolved = resolveTheme(theme)
  document.documentElement.dataset.theme = resolved
  // 让浏览器自带的控件（滚动条、取色器）也跟着变
  document.documentElement.style.colorScheme = resolved
  return resolved
}

/** 系统主题变化时回调（只在 theme === 'system' 时有意义） */
export function watchSystemTheme(onChange: () => void): () => void {
  if (typeof window === 'undefined' || !window.matchMedia) return () => {}
  const mq = window.matchMedia('(prefers-color-scheme: dark)')
  const handler = () => onChange()
  mq.addEventListener('change', handler)
  return () => mq.removeEventListener('change', handler)
}
