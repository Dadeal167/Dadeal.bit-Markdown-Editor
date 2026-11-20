import type { Editor } from '@tiptap/core'
import { closeHistory } from '@tiptap/pm/history'
import type { Mark, Node } from '@tiptap/pm/model'
import { readFileAsDataUrl } from '../editorActions'
import type { LocalDirectoryHandle } from '../localMarkdownFile'
import { normalizeWorkspacePath } from './documentWorkspace'

export interface AssetScope {
  root: FileSystemDirectoryHandle
  folder: string[]
}
export interface AssetReference {
  kind: 'image' | 'video'
  path: string
  name: string
  position: number
  end: number
  mark?: Mark
  embedded: boolean
}
export type AssetStatus = '本地可用' | '本地缺失' | '待连接文件夹' | '已嵌入' | '网络地址'
export interface AssetRepair {
  reference: AssetReference
  path?: string
  file: File
}
interface Candidate { path: string[]; file: File }

const videoFile = /\.(mp4|m4v|webm|og[gv]|mov)(?:[?#]|$)/i
const external = /^(?:[a-z][a-z\d+.-]*:|\/\/)/i
const imageType: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
  avif: 'image/avif', bmp: 'image/bmp', svg: 'image/svg+xml',
}
const mime = (file: File) => imageType[file.name.split('.').at(-1)?.toLowerCase() ?? '']

export function documentAssets(doc: Node): AssetReference[] {
  const assets: AssetReference[] = []
  doc.descendants((node, position) => {
    const end = position + node.nodeSize
    if (node.type.name === 'image' || node.type.name === 'videoEmbed') {
      const embedded = /^data:/i.test(String(node.attrs.src ?? ''))
      const path = String(node.attrs.localAsset || node.attrs.src || '')
      if (path) assets.push({
        kind: node.type.name === 'image' ? 'image' : 'video', path, embedded, position, end,
        name: String(node.attrs.alt || (embedded && !node.attrs.localAsset ? '内嵌图片' : path.split('/').at(-1) || path)),
      })
      return
    }
    const mark = node.isText && node.marks.find((entry) => entry.type.name === 'link' && videoFile.test(String(entry.attrs.href)))
    if (mark) assets.push({ kind: 'video', path: String(mark.attrs.href), name: node.text ?? '', position, end, mark, embedded: false })
  })
  return assets
}

function decodedPath(path: string) {
  try { return decodeURIComponent(path.split(/[?#]/, 1)[0]).replaceAll('\\', '/') }
  catch { return null }
}

export async function resolveProjectAsset(scope: AssetScope, path: string) {
  if (!path || external.test(path)) return null
  const decoded = decodedPath(path)
  if (!decoded || /[:\0]/.test(decoded)) return null
  const relative = normalizeWorkspacePath(decoded.startsWith('/') ? decoded : [...scope.folder, decoded].join('/'))
  if (!relative) return null
  try {
    let directory = scope.root
    const parts = relative.split('/')
    const name = parts.pop()!
    for (const part of parts) directory = await directory.getDirectoryHandle(part)
    return await (await directory.getFileHandle(name)).getFile()
  } catch { return null }
}

export async function classifyAssets(assets: AssetReference[], scope?: AssetScope) {
  const checks = new Map<string, Promise<File | null>>()
  return Promise.all(assets.map(async (asset): Promise<AssetStatus> => {
    if (asset.embedded && external.test(asset.path)) return '已嵌入'
    if (external.test(asset.path)) return '网络地址'
    if (!scope) return asset.embedded ? '已嵌入' : '待连接文件夹'
    let check = checks.get(asset.path)
    if (!check) {
      check = resolveProjectAsset(scope, asset.path)
      checks.set(asset.path, check)
    }
    return await check ? '本地可用' : '本地缺失'
  }))
}

export async function readAssetDirectory(directory: LocalDirectoryHandle) {
  const files: Candidate[] = []
  async function visit(folder: LocalDirectoryHandle, prefix: string[]) {
    for await (const entry of folder.values()) {
      if (entry.name.startsWith('.')) continue
      const path = [...prefix, entry.name]
      if (entry.kind === 'directory') await visit(entry as LocalDirectoryHandle, path)
      else if (/\.(png|jpe?g|gif|webp|avif|bmp|svg|mp4|m4v|webm|og[gv]|mov)$/i.test(entry.name)) {
        files.push({ path, file: await (entry as FileSystemFileHandle).getFile() })
      }
    }
  }
  await visit(directory, [])
  return files
}

export function assetFileList(files: File[]): Candidate[] {
  return files.map((file) => ({ file, path: (file.webkitRelativePath || file.name).split('/').slice(file.webkitRelativePath ? 1 : 0) }))
}

function relativePath(from: string[], to: string[]) {
  let shared = 0
  while (shared < from.length && from[shared] === to[shared]) shared++
  return [...from.slice(shared).map(() => '..'), ...to.slice(shared).map((part) =>
    encodeURIComponent(part).replace(/[!'()*]/g, (char) => '%' + char.charCodeAt(0).toString(16)))].join('/')
}

export function planAssetRepairs(assets: AssetReference[], statuses: AssetStatus[], candidates: Candidate[],
  scope?: AssetScope, chosenFolder?: string[] | null) {
  const byName = new Map<string, Candidate[]>()
  const fold = (text: string) => text.normalize('NFC').toLowerCase()
  for (const candidate of candidates) {
    const name = fold(candidate.file.name)
    const matches = byName.get(name)
    if (matches) matches.push(candidate)
    else byName.set(name, [candidate])
  }
  const repairs: AssetRepair[] = []
  const unresolved: { reference: AssetReference; reason: string }[] = []
  for (const [index, reference] of assets.entries()) {
    if (statuses[index] === '本地可用' || external.test(reference.path)) continue
    const original = decodedPath(reference.path)?.split('/').map(fold)
    if (!original) continue
    const matches = (byName.get(original.at(-1) ?? '') ?? []).map((candidate) => {
      const path = candidate.path.map(fold)
      let score = 0
      while (score < path.length && path.at(-1 - score) === original.at(-1 - score)) score++
      return { candidate, score }
    }).sort((a, b) => b.score - a.score)
    if (!matches.length) { unresolved.push({ reference, reason: '未找到同名文件' }); continue }
    if (matches[1]?.score === matches[0].score) { unresolved.push({ reference, reason: '存在多个同名文件' }); continue }
    const { file, path } = matches[0].candidate
    const destination = scope && chosenFolder ? relativePath(scope.folder, [...chosenFolder, ...path]) : undefined
    if (reference.kind === 'video' && !destination) {
      unresolved.push({ reference, reason: '视频需要位于已连接的文档文件夹或工作区内' })
    } else if (reference.kind === 'image' && !mime(file)) {
      unresolved.push({ reference, reason: '无法识别图片格式' })
    } else {
      repairs.push({ reference, file, path: destination })
    }
  }
  return { repairs, unresolved }
}

export async function applyAssetRepairs(editor: Editor, snapshot: Node, repairs: AssetRepair[], scope: AssetScope | undefined, canApply: () => boolean) {
  if (scope) {
    const files = new Map(repairs.flatMap(({ path, file }) => path ? [[path, file] as const] : []))
    const matches = await Promise.all([...files].map(async ([path, expected]) => {
      const current = await resolveProjectAsset(scope, path)
      return current?.size === expected.size && current.lastModified === expected.lastModified
    }))
    if (matches.includes(false)) throw new Error('素材文件已发生变化，请重新选择文件夹并生成预览。')
  }
  const images = new Map<File, Promise<string>>()
  for (const { file, reference } of repairs) {
    if (reference.kind !== 'image' || images.has(file)) continue
    images.set(file, readFileAsDataUrl(new File([file], file.name, { type: mime(file) })))
  }
  const data = new Map(await Promise.all([...images].map(async ([file, url]) => [file, await url] as const)))
  if (editor.isDestroyed || !editor.isEditable || editor.state.doc !== snapshot || !canApply()) {
    throw new Error('正文已更新，请重新打开素材管理并生成预览。')
  }
  const transaction = closeHistory(editor.state.tr)
  for (const { reference, path, file } of repairs) {
    if (reference.mark) {
      transaction.removeMark(reference.position, reference.end, reference.mark)
      transaction.addMark(reference.position, reference.end, reference.mark.type.create({ ...reference.mark.attrs, href: path }))
      continue
    }
    const node = snapshot.nodeAt(reference.position)!
    const attrs = reference.kind === 'image' ? { ...node.attrs, src: data.get(file), localAsset: path ?? '' } : { ...node.attrs, src: path }
    transaction.setNodeMarkup(reference.position, undefined, attrs)
  }
  if (transaction.docChanged) editor.view.dispatch(transaction)
}
