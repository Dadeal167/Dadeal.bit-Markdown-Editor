export type ObjectKind = 'fig' | 'tab'

export function objectId(value: unknown, kind?: ObjectKind): string {
  const id = typeof value === 'string' ? value : ''
  return /^(?:fig|tab)-[a-z0-9][a-z0-9-]{0,63}$/.test(id) && (!kind || id.startsWith(kind + '-')) ? id : ''
}

export function objectName(kind: ObjectKind): string {
  return kind === 'fig' ? '图' : '表'
}

export function objectKind(id: string): ObjectKind {
  return id.startsWith('fig-') ? 'fig' : 'tab'
}

export function objectCaptionText(number: string, caption: string): string {
  return caption ? `${number}　${caption}` : number
}

export function decodeObjectCaption(value: string): string {
  try { return decodeURIComponent(value) } catch { return '' }
}

export const figureMarker = /^\[dadealbit-figure:(fig-[a-z0-9-]+):([^\]\s]*)\](?: |$)/
