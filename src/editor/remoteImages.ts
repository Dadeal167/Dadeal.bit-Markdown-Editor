import type { Editor } from '@tiptap/core'
import type { Node } from '@tiptap/pm/model'
import { closeHistory } from '@tiptap/pm/history'
import { sniffImage } from '../../scripts/imageFormat.mjs'
import { MAX_IMAGE_FILE, readFileAsDataUrl } from './editorActions'
import { isZhihuImageUrl, requestZhihuImages } from './zhihuImport'

const MAX_BATCH_BYTES = 24 * 1024 * 1024
const EXTRA_IMAGE_TYPES = /^image\/(?:avif|bmp|svg\+xml|x-icon|vnd\.microsoft\.icon)$/i

export interface RemoteImage {
  source: string
  name: string
}

function remoteUrl(source: string): string | null {
  if (!/^(?:https?:)?\/\//i.test(source)) return null
  try {
    const url = new URL(source.startsWith('//') ? 'https:' + source : source)
    if (!url.username && !url.password && (url.protocol === 'http:' || url.protocol === 'https:')) return url.href
  } catch { /* Keep malformed links as they are. */ }
  return null
}

export function remoteImages(doc: Node): RemoteImage[] {
  const unique = new Map<string, RemoteImage>()
  doc.descendants((node) => {
    if (node.type.name !== 'image') return
    const source = String(node.attrs.src ?? '')
    if (unique.has(source) || !/^(?:https?:)?\/\//i.test(source)) return
    const alt = String(node.attrs.alt ?? '').replace(/\s+/g, ' ').trim()
    unique.set(source, { source, name: alt || '图片 ' + (unique.size + 1) })
  })
  return [...unique.values()]
}

async function readRemoteImage(url: string, limit: number, signal: AbortSignal) {
  const response = await fetch(url, { credentials: 'omit', referrerPolicy: 'no-referrer', signal })
  if (!response.ok || !response.body || Number(response.headers.get('content-length')) > limit) {
    await response.body?.cancel().catch(() => {})
    return null
  }
  const chunks: Uint8Array[] = []
  const reader = response.body.getReader()
  let size = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > limit) {
        await reader.cancel()
        return null
      }
      chunks.push(value)
    }
  } finally { reader.releaseLock() }
  if (!size) return null
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  const declared = response.headers.get('content-type')?.split(';', 1)[0].trim() ?? ''
  const mime = sniffImage(bytes)?.mime ?? (EXTRA_IMAGE_TYPES.test(declared) ? declared : '')
  return mime ? { data: await readFileAsDataUrl(new File([bytes], 'remote-image', { type: mime })), size } : null
}

function embeddedBytes(data: string) {
  const length = data.length - data.indexOf(',') - 1
  return length * 3 / 4 - (data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0)
}

export async function saveRemoteImages(editor: Editor, snapshot: Node, images: RemoteImage[],
  canApply: () => boolean, signal: AbortSignal, progress: (done: number) => void) {
  const urls = images.map((image) => ({ source: image.source, url: remoteUrl(image.source) }))
  const zhihu = [...new Set(urls.map(({ url }) => url).filter((url): url is string =>
    Boolean(url && isZhihuImageUrl(url) && url.length <= 4096)))].slice(0, 32)
  const deadline = Date.now() + 30000
  const extension = location.protocol === 'file:' && zhihu.length
    ? await requestZhihuImages(zhihu, signal).catch(() => new Map<string, string>())
    : new Map<string, string>()
  let remaining = MAX_BATCH_BYTES
  const results = new Map<string, { data: string; size: number } | null>()
  const replacements = new Map<string, string>()
  for (const [index, { source, url }] of urls.entries()) {
    signal.throwIfAborted()
    const time = deadline - Date.now()
    if (url && remaining > 0 && time > 0) {
      if (!results.has(url)) {
        const limit = Math.min(remaining, MAX_IMAGE_FILE)
        const data = extension.get(url)
        const size = data ? embeddedBytes(data) : 0
        const result = data && size > 0 && size <= limit ? { data, size }
          : await readRemoteImage(url, limit, AbortSignal.any([signal, AbortSignal.timeout(Math.min(time, 5000))]))
            .catch(() => null)
        if (result) remaining -= result.size
        results.set(url, result)
      }
      const image = results.get(url)
      if (image) replacements.set(source, image.data)
    }
    progress(index + 1)
  }
  signal.throwIfAborted()
  if (!canApply() || editor.isDestroyed || !editor.isEditable || editor.state.doc !== snapshot) {
    throw new Error('正文已更新，请重新打开素材管理。')
  }
  const transaction = closeHistory(editor.state.tr)
  snapshot.descendants((node, position) => {
    if (node.type.name !== 'image') return
    const src = replacements.get(String(node.attrs.src ?? ''))
    if (src) transaction.setNodeMarkup(position, undefined, { ...node.attrs, src, localAsset: '' })
  })
  if (transaction.docChanged) editor.view.dispatch(transaction)
  return { saved: replacements.size, remaining: images.length - replacements.size }
}
