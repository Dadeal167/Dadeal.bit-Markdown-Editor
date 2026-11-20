export interface PublicationLayout {
  preset: 'default' | 'handout' | 'solutions' | 'custom'
  paper: 'A4' | 'Letter'
  top: number
  right: number
  bottom: number
  left: number
  header: string
  footer: string
  numbers: boolean
  chapterBreaks: boolean
}

export const publicationPresets: Record<Exclude<PublicationLayout['preset'], 'custom'>, PublicationLayout> = {
  default: { preset: 'default', paper: 'Letter', top: 25.4, right: 25.4, bottom: 25.4, left: 25.4,
    header: '', footer: '', numbers: false, chapterBreaks: false },
  handout: { preset: 'handout', paper: 'A4', top: 22, right: 22, bottom: 20, left: 22,
    header: '{title}', footer: '', numbers: true, chapterBreaks: false },
  solutions: { preset: 'solutions', paper: 'A4', top: 22, right: 18, bottom: 20, left: 25,
    header: '{title}', footer: '试题解析', numbers: true, chapterBreaks: true },
}
const storageKey = 'dadealbit-publication-layout-v1'

export function loadPublicationLayout(): PublicationLayout {
  try {
    const value = JSON.parse(localStorage.getItem(storageKey) ?? 'null') as PublicationLayout | null
    if (value && Object.hasOwn(publicationPresets, value.preset)) return publicationPresets[value.preset as keyof typeof publicationPresets]
    if (value?.preset === 'custom' && ['A4', 'Letter'].includes(value.paper) &&
        [value.top, value.right, value.bottom, value.left].every((n) => Number.isFinite(n) && n >= 8 && n <= 50) &&
        typeof value.header === 'string' && typeof value.footer === 'string' &&
        typeof value.numbers === 'boolean' && typeof value.chapterBreaks === 'boolean') return value
  } catch { /* 读取失败时使用默认打印设置。 */ }
  return publicationPresets.default
}

export function savePublicationLayout(layout: PublicationLayout) {
  try { localStorage.setItem(storageKey, JSON.stringify(layout)) } catch { /* 当前会话仍可使用。 */ }
}

export function publicationText(text: string, title: string) {
  return text.replaceAll('{title}', () => title.trim()).replace(/[\u0000-\u001f\u007f]+/g, ' ').trim()
}

export function printPublicationCss(layout: PublicationLayout, title: string) {
  if (layout.preset === 'default') return ''
  const header = publicationText(layout.header, title)
  const footer = publicationText(layout.footer, title)
  const literal = (text: string) => '"' + text.replace(/["\\<]/g, (char) => '\\' + char.codePointAt(0)!.toString(16) + ' ') + '"'
  const page = layout.numbers ? [literal('第 '), 'counter(page)', literal(' 页')].join(' ') : ''
  const bottom = [footer && literal(footer), footer && page && literal(' · '), page].filter(Boolean).join(' ')
  return `@page {
    size: ${layout.paper};
    margin: ${layout.top}mm ${layout.right}mm ${layout.bottom}mm ${layout.left}mm;
    @top-center { content: ${header ? literal(header) : 'none'}; font: 9pt sans-serif; color: #4b5563; }
    @bottom-center { content: ${bottom || 'none'}; font: 9pt sans-serif; color: #4b5563; }
  }
  ${layout.chapterBreaks ? '.zh-prose > :is(h1,h2) ~ :is(h1,h2) { break-before: page; }' : ''}`
}
