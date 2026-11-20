import type { Editor } from '@tiptap/core'
import { sniffImage } from '../../scripts/imageFormat.mjs'
import { getMarkdown } from './editorActions'
import { findAssetFile, writeLocalMarkdown, type LocalFileHandle } from './localMarkdownFile'

function extension(bytes: Uint8Array, mime: string) {
  return sniffImage(bytes)?.ext ?? ({
    'image/bmp': 'bmp', 'image/avif': 'avif', 'image/svg+xml': 'svg', 'image/x-icon': 'ico',
  }[mime] || '')
}

export async function storeClipboardAsset(directory: FileSystemDirectoryHandle, dataUrl: string) {
  const blob = await (await fetch(dataUrl)).blob()
  const buffer = await blob.arrayBuffer()
  const ext = extension(new Uint8Array(buffer), blob.type)
  if (!ext) throw new Error('无法确定图片类型。')
  const assets = await directory.getDirectoryHandle('assets', { create: true })
  const name = 'clipboard-' + crypto.randomUUID() + '.' + ext
  const handle = await assets.getFileHandle(name, { create: true }) as LocalFileHandle
  await writeLocalMarkdown(handle, buffer)
  return 'assets/' + name
}

export async function packMarkdownAssets(editor: Editor, title: string, directory?: FileSystemDirectoryHandle) {
  const tr = editor.state.tr
  const images: { pos: number; attrs: Record<string, unknown> }[] = []
  tr.doc.descendants((node, pos) => { if (node.type.name === 'image') images.push({ pos, attrs: node.attrs }) })
  const files: Record<string, Uint8Array> = {}
  const paths = new Map<string, string>()
  let missing = 0
  for (const { attrs, pos } of images) {
    const src = String(attrs.src ?? '')
    const local = String(attrs.localAsset ?? '')
    const embedded = /^data:image\//i.test(src)
    if (!embedded && /^(?:https?:)?\/\//i.test(src)) continue
    const key = embedded ? src : local || src
    let path = paths.get(key)
    if (!path) {
      try {
        const blob = embedded ? await (await fetch(src)).blob() : directory ? await findAssetFile(directory, key) : null
        if (blob) {
          const bytes = new Uint8Array(await blob.arrayBuffer())
          const ext = extension(bytes, blob.type) || extension(bytes, ({ svg: 'image/svg+xml',
            avif: 'image/avif', bmp: 'image/bmp', ico: 'image/x-icon' } as Record<string, string>)[key.split('.').at(-1)?.toLowerCase() ?? ''])
          if (ext) {
            path = 'assets/image-' + (paths.size + 1) + '.' + ext
            paths.set(key, path)
            files[path] = bytes
          }
        }
      } catch { /* 计入缺失资源，保留原 Markdown 引用。 */ }
    }
    if (path) tr.setNodeMarkup(pos, undefined, { ...attrs, src: path, localAsset: '' })
    else missing += 1
  }
  const markdown = getMarkdown(editor, tr.doc)
  const name = title.trim().replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/^[ .]+|[ .]+$/g, '') || '未命名文档'
  files[name + '.md'] = new TextEncoder().encode(markdown)
  const { zipSync } = await import('fflate')
  const zip = zipSync(files, { level: 0 })
  return { name: name + '.zip', missing, blob: new Blob([new Uint8Array(zip)], { type: 'application/zip' }) }
}
