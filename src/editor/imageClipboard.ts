export function clipboardGifSource(value: unknown): string {
  const source = typeof value === 'string' ? value.trim() : ''
  if (!source) return ''
  if (/^data:image\/gif;base64,R0lGOD/i.test(source)) return source
  if (!/^(?:https?:)?\/\//i.test(source)) return ''
  try {
    const url = new URL(source, 'https://example.invalid/')
    if (!url.username && !url.password && /\.gif$/i.test(url.pathname)) return url.href
  } catch { /* Invalid image URL. */ }
  return ''
}

export function clipboardGifLink(data: DataTransfer | null, text: string): string {
  const links = data?.getData('text/uri-list').split(/\r?\n/).map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#')) ?? []
  return clipboardGifSource(links.length === 1 ? links[0] : text)
}

function zhihuGifFromCover(image: HTMLImageElement, source: string | null): string {
  if (image.getAttribute('alt')?.trim() !== '动图封面' || !source) return ''
  try {
    const url = new URL(source, 'https://example.invalid/')
    if (url.protocol !== 'https:' || url.username || url.password || url.port ||
        !url.hostname.endsWith('.zhimg.com') ||
        !/\/v2-[0-9a-f]{32}(?:_[a-z0-9]+)?\.(?:jpe?g|png|webp)$/i.test(url.pathname)) return ''
    // Edge copies this labeled cover together with a static PNG. Zhihu serves the GIF at the same CDN path.
    url.pathname = url.pathname.replace(/\.[^.\/]+$/, '.gif')
    return url.href
  } catch { return '' }
}

export function restoreClipboardGifSources(html: string): string {
  if (!/<img\b/i.test(html)) return html
  const template = document.createElement('template')
  template.innerHTML = html
  let changed = false
  for (const image of template.content.querySelectorAll('img')) {
    const current = image.getAttribute('src')
    const original = [
      image.getAttribute('data-actualsrc'), image.getAttribute('data-original'),
      image.getAttribute('data-src'), current, image.closest('a')?.getAttribute('href'),
    ].map(clipboardGifSource).find(Boolean) || zhihuGifFromCover(image, current)
    if (!original || original === current) continue
    image.setAttribute('src', original)
    changed = true
  }
  return changed ? template.innerHTML : html
}
