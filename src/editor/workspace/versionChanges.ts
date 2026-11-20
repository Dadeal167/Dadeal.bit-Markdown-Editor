import { diffArrays } from 'diff'

export interface VersionChange { start: number; end: number; oldText: string; currentText: string }

function markdownBlocks(markdown: string): string[] {
  const blocks: string[] = []
  let buffer = ''
  let fence = ''
  const flush = () => { if (buffer) blocks.push(buffer); buffer = '' }
  for (const line of markdown.match(/[^\n]*\n|[^\n]+$/g) ?? []) {
    const marker = /^ {0,3}(`{3,}|~{3,}|\$\$)(.*)$/.exec(line.trimEnd())
    if (fence) {
      buffer += line
      if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length && !marker[2].trim()) {
        fence = ''
        flush()
      }
    } else if (marker) {
      flush()
      buffer = line
      if (marker[1] === '$$' && /\$\$\s*$/.test(marker[2])) flush()
      else fence = marker[1]
    } else if (!line.trim()) {
      flush()
      blocks.push(line)
    } else buffer += line
  }
  flush()
  return blocks
}

export function versionChanges(older: string, current: string): VersionChange[] | null {
  const pieces = diffArrays(markdownBlocks(older), markdownBlocks(current), { timeout: 220 })
  if (!pieces) return null
  const changes: VersionChange[] = []
  let offset = 0
  let active: VersionChange | undefined
  for (const piece of pieces) {
    const text = piece.value.join('')
    if (!piece.added && !piece.removed) {
      if (active) changes.push(active)
      active = undefined
      offset += text.length
      continue
    }
    active ??= { start: offset, end: offset, oldText: '', currentText: '' }
    if (piece.removed) active.oldText += text
    else {
      active.currentText += text
      offset += text.length
      active.end = offset
    }
  }
  if (active) changes.push(active)
  return changes
}
