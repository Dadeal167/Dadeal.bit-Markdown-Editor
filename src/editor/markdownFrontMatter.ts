/** Recognize a YAML mapping at the start of the file and retain its original text. */
export function markdownFrontMatter(source: string): string {
  if (!/^(?:\uFEFF)?---[ \t]*\r?\n/.test(source)) return ''
  const match = /^(?:\uFEFF)?---[ \t]*\r?\n(?:[ \t]*(?:#[^\r\n]*)?\r?\n)*(?=[^\s:#][^:\r\n]*:(?:[ \t]|\r?$))[\s\S]*?^(?:---|\.\.\.)[ \t]*(?:\r?\n|$)(?:[ \t]*\r?\n)*/m.exec(source)
  return match?.index === 0 ? match[0] : ''
}

export function prependMarkdownFrontMatter(header: string, body: string): string {
  return header + (header && body && !header.endsWith('\n') ? '\n\n' : '') + body
}
