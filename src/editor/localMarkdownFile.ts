import { stripExporterHeader } from './zhihuMarkdown'
import { codeMask } from './tiptap/mathMarkdown'
import { markdownFrontMatter, prependMarkdownFrontMatter } from './markdownFrontMatter'

export interface LocalFileHandle extends FileSystemFileHandle {
  requestPermission(options: { mode: 'readwrite' }): Promise<PermissionState>
  createWritable(options?: FileSystemCreateWritableOptions & { mode?: 'exclusive' }): Promise<FileSystemWritableFileStream>
}

export interface LocalDirectoryHandle extends FileSystemDirectoryHandle {
  values(): AsyncIterableIterator<FileSystemHandle>
  queryPermission?(options: { mode: 'read' | 'readwrite' }): Promise<PermissionState>
  requestPermission?(options: { mode: 'read' | 'readwrite' }): Promise<PermissionState>
}

type MarkdownPickerWindow = Window & {
  showOpenFilePicker?: (options: { types: typeof markdownTypes }) => Promise<LocalFileHandle[]>
  showSaveFilePicker?: (options: { types: typeof markdownTypes; suggestedName: string }) => Promise<LocalFileHandle>
  showDirectoryPicker?: (options: { mode: 'read' | 'readwrite' }) => Promise<LocalDirectoryHandle>
}

export const markdownTypes = [{
  description: 'Markdown 文档',
  accept: { 'text/markdown': ['.md', '.markdown'], 'text/plain': ['.txt'] },
}]

export function localFilePickers() {
  return window as MarkdownPickerWindow
}

interface SourceFormat {
  header: string
  bom: boolean
  crlf: boolean
  finalNewline: boolean
}

export interface LocalMarkdownFile {
  handle: LocalFileHandle
  source: SourceFormat
  diskHash: string
  editorHash: string
  directory?: FileSystemDirectoryHandle
}

export function projectImportedImages(md: string, relative: boolean): string {
  if (!md.includes('[dadealbit-asset:')) return md
  const mask = /[`~]/.test(md) ? codeMask(md) : null
  const image = /(!\[(?:\\.|[^\]\\])*\]\()(data:[^\s)]+) "\[dadealbit-asset:([^\]\s]+)\](?: ((?:\\.|[^"\\])*))?"\)/g
  return md.replace(image, (match, open: string, data: string, source: string, title: string | undefined, index: number) => {
    if (mask?.[index]) return match
    try {
      const path = decodeURIComponent(source)
      if (/[\r\n"<>`]|^[a-z][a-z0-9+.-]*:|^\/\//i.test(path)) return match
      const src = relative ? path.replace(/[()]/g, '\\$&') : data
      return open + src + (title ? ' "' + title + '"' : '') + ')'
    } catch {
      return match
    }
  })
}

const encoder = new TextEncoder()

export async function markdownHash(value: string | ArrayBuffer): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', typeof value === 'string' ? encoder.encode(value) : value)
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function readLocalMarkdown(handle: LocalFileHandle) {
  const bytes = await (await handle.getFile()).arrayBuffer()
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  if (text.includes('\u0000')) throw new Error('请选择 UTF-8 编码的 Markdown 文本。')
  const yaml = /^---[ \t]*\r?\n(?=(?:[ \t]*#.*\r?\n|[ \t]*\r?\n)*[\w.-]+[ \t]*:)[\s\S]*?^(?:---|\.\.\.)[ \t]*(?:\r?\n|$)(?:[ \t]*\r?\n)*/m.exec(text)
  const exported = stripExporterHeader(text)
  const header = yaml?.index === 0 ? yaml[0]
    : exported !== text ? text.slice(0, text.length - exported.length) : ''
  const octets = new Uint8Array(bytes)
  return {
    bytes,
    markdown: text.slice(header.length),
    diskHash: await markdownHash(bytes),
    source: {
      header,
      bom: octets[0] === 0xef && octets[1] === 0xbb && octets[2] === 0xbf,
      crlf: /\r?\n/.exec(text)?.[0] === '\r\n',
      finalNewline: text.endsWith('\n'),
    },
  }
}

export function serializeLocalMarkdown(md: string, source: SourceFormat): string {
  let body = md.replace(/\r\n/g, '\n')
  if (source.finalNewline && body && !body.endsWith('\n')) body += '\n'
  if (!source.finalNewline && body.endsWith('\n')) body = body.slice(0, -1)
  if (source.crlf) body = body.replace(/\n/g, '\r\n')
  const newline = source.crlf ? '\r\n' : '\n'
  const header = markdownFrontMatter(body) && markdownFrontMatter(source.header) ? '' : source.header
  const separator = body && header && !header.endsWith('\n') ? newline + newline : ''
  return (source.bom ? '\uFEFF' : '') + header + separator + body
}

/** An associated file can have a YAML header stored alongside the draft instead of in its body. */
export function includeSourceFrontMatter(markdown: string, file?: LocalMarkdownFile): string {
  const header = file && markdownFrontMatter(file.source.header)
  return header && !markdownFrontMatter(markdown) ? prependMarkdownFrontMatter(header, markdown) : markdown
}

export async function localFileMatches(handle: LocalFileHandle, hash: string): Promise<boolean> {
  return await markdownHash(await (await handle.getFile()).arrayBuffer()) === hash
}

/** 提交前再核对一次磁盘，期间写入的是浏览器管理的临时文件。 */
export async function writeLocalMarkdown(handle: LocalFileHandle, content: string | ArrayBuffer, expectedHash?: string) {
  const stream = await handle.createWritable({ mode: 'exclusive' })
  try {
    await stream.write(content)
    if (expectedHash && !await localFileMatches(handle, expectedHash)) return false
    await stream.close()
    return true
  } finally {
    // 已提交的流不再可中止；出现冲突或写入失败时清理临时内容。
    await stream.abort().catch(() => {})
  }
}
