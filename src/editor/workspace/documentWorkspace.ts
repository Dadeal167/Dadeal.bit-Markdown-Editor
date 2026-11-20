import MarkdownIt from 'markdown-it'
import { WIKI_LINK, parseWikiLink, registerWikiLinks } from '../tiptap/WikiLink'
import { replaceMathSpans } from '../tiptap/mathMarkdown'
import { localFileMatches, markdownHash, readLocalMarkdown, serializeLocalMarkdown, writeLocalMarkdown,
  type LocalDirectoryHandle, type LocalFileHandle } from '../localMarkdownFile'

export const workspaceMarkdown = new MarkdownIt({ html: true })
registerWikiLinks(workspaceMarkdown)

export interface WorkspaceFile {
  path: string
  handle: LocalFileHandle
  directory: LocalDirectoryHandle
  source: Awaited<ReturnType<typeof readLocalMarkdown>> | null
}

async function listWorkspace(root: LocalDirectoryHandle) {
  const entries: WorkspaceFile[] = []
  async function visit(directory: LocalDirectoryHandle, prefix: string) {
    for await (const entry of directory.values()) {
      const path = prefix + entry.name
      if (entry.kind === 'directory' && !/^(?:\.|assets?$)/i.test(entry.name)) {
        await visit(entry as LocalDirectoryHandle, path + '/')
      } else if (entry.kind === 'file' && /\.(?:md|markdown)$/i.test(entry.name) && !entry.name.startsWith('.')) {
        entries.push({ path, handle: entry as LocalFileHandle, directory, source: null })
      }
    }
  }
  await visit(root, '')
  return entries.sort((a, b) => a.path.localeCompare(b.path, 'zh'))
}

export async function scanWorkspace(root: LocalDirectoryHandle) {
  const entries = await listWorkspace(root)
  for (let at = 0; at < entries.length; at += 12) {
    await Promise.all(entries.slice(at, at + 12).map(async (file) => {
      file.source = await readLocalMarkdown(file.handle).catch(() => null)
    }))
  }
  return entries
}

function parentPath(path: string) {
  return path.slice(0, path.lastIndexOf('/') + 1)
}

export function normalizeWorkspacePath(path: string) {
  const parts: string[] = []
  for (const part of path.split('/')) {
    if (part === '..') {
      if (!parts.length) return null
      parts.pop()
    } else if (part && part !== '.') parts.push(part)
  }
  return parts.join('/')
}

const fold = (value: string) => value.normalize('NFC').toLowerCase()
const stem = (path: string) => path.replace(/\.(?:md|markdown)$/i, '')

function existingPath(paths: readonly string[], name: string, key: (path: string) => string = (path) => path) {
  const exact = paths.filter((path) => key(path) === name)
  if (exact.length) return exact
  return paths.filter((path) => fold(key(path)) === fold(name))
}

export function resolveWikiPath(paths: readonly string[], from: string, name: string) {
  if (!name) return paths.includes(from) ? from : undefined
  const candidates = name.startsWith('/') ? [normalizeWorkspacePath(name)]
    : [normalizeWorkspacePath(parentPath(from) + name), normalizeWorkspacePath(name)]
  const key = (path: string) => /\.(?:md|markdown)$/i.test(name) ? path : stem(path)
  for (const candidate of new Set(candidates)) {
    if (!candidate) continue
    const matching = existingPath(paths, candidate, key)
    if (matching.length) return matching.length === 1 ? matching[0] : undefined
  }
  if (name.includes('/')) return undefined
  const matching = existingPath(paths, name, (path) => key(path.slice(parentPath(path).length)))
  return matching.length === 1 ? matching[0] : undefined
}

export const headingSlug = (value: string) => fold(value.trim()).replace(/[^\p{L}\p{N}_\s-]/gu, '').replace(/\s+/g, '-')
export function headingMatches(text: string, fragment: string) {
  let label = fragment.replace(/^#/, '').trim()
  try { label = decodeURIComponent(label) } catch { /* 原样匹配标题 */ }
  return label !== '' && (fold(text.trim()) === fold(label) || headingSlug(text) === fold(label))
}

export function workspaceHeadings(markdown: string) {
  const tokens = workspaceMarkdown.parse(markdown, {})
  return tokens.flatMap((token, index) => token.type === 'heading_open' ? [{
    text: tokens[index + 1].children?.filter((child) => child.type === 'text' || child.type === 'code_inline')
      .map((child) => child.content).join('') ?? '',
    level: Number(token.tag.slice(1)),
    line: (token.map?.[0] ?? 0) + 1,
  }] : [])
}

// 通过 Markdown 解析器排除代码块、行内代码和转义链接，同时保留源码位置。
export function wikiOccurrences(markdown: string) {
  if (!markdown.includes('[[')) return []
  let marker = '\uE000'
  while (markdown.includes(marker)) marker += '\uE001'
  const candidates: { at: number; raw: string }[] = []
  const marked = markdown.replace(WIKI_LINK, (raw: string, _name, _fragment, _alias, at: number) => {
    if (!parseWikiLink(raw)) return raw
    const index = candidates.push({ raw, at }) - 1
    return raw.slice(0, -2) + marker + index + '\uE002]]'
  })
  const valid: typeof candidates = []
  for (const token of workspaceMarkdown.parse(marked.includes('$') ? replaceMathSpans(marked).md : marked, {})) {
    for (const child of token.children ?? []) {
      if (child.type !== 'wiki_link_open') continue
      const raw = child.attrGet('data-wiki-link') ?? ''
      const tagged = raw.lastIndexOf(marker)
      if (tagged >= 0) {
        const candidate = candidates[Number(raw.slice(tagged + marker.length, -3))]
        if (candidate) valid.push(candidate)
      }
    }
  }
  return valid.sort((a, b) => a.at - b.at)
}

export function markdownFileLink(from: string, destination: string) {
  if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(destination)) return null
  const raw = destination.split(/[?#]/, 1)[0]
  try {
    const name = decodeURIComponent(raw)
    if (!/\.(?:md|markdown)$/i.test(name)) return null
    const path = normalizeWorkspacePath(name.startsWith('/') ? name : parentPath(from) + name)
    return path ? { path, fragment: destination.includes('#') ? destination.slice(destination.indexOf('#')) : '' } : null
  } catch { return null }
}

function resolveMarkdownPath(paths: readonly string[], from: string, destination: string) {
  const link = markdownFileLink(from, destination)
  if (!link) return undefined
  const matching = existingPath(paths, link.path)
  return matching.length === 1 ? matching[0] : undefined
}

function standardOccurrences(markdown: string) {
  if (!/\.(?:md|markdown)\b/i.test(markdown)) return []
  let marker = '-dadealbit-link-position-'
  while (markdown.includes(marker)) marker += '-'
  const candidates = [...markdown.matchAll(/\][(][ \t]*|^[ \t>]*\[(?!\^)(?:\\.|[^\]\r\n])+\]:[ \t]*/gm)].flatMap((match) => {
    const start = match.index! + match[0].length
    const link = workspaceMarkdown.helpers.parseLinkDestination(markdown, start, markdown.length)
    if (!link.ok || !/\.(?:md|markdown)(?=[?#]|$)/i.test(link.str)) return []
    const angled = markdown[start] === '<'
    const at = start + Number(angled)
    const end = link.pos - Number(angled)
    return [{ at, end, raw: markdown.slice(at, end), destination: link.str }]
  })
  if (!candidates.length) return []
  let marked = markdown
  for (let i = candidates.length - 1; i >= 0; i--) {
    const { end } = candidates[i]
    marked = marked.slice(0, end) + marker + i + marked.slice(end)
  }
  const env: { references?: Record<string, { href: string }> } = {}
  const tokens = workspaceMarkdown.parse(marked.includes('$') ? replaceMathSpans(marked).md : marked, env)
  const ids = new Set<number>()
  const add = (href: string) => {
    const index = href.lastIndexOf(marker)
    if (index >= 0 && /^\d+$/.test(href.slice(index + marker.length))) ids.add(Number(href.slice(index + marker.length)))
  }
  for (const token of tokens) {
    for (const child of token.children ?? []) if (child.type === 'link_open') add(child.attrGet('href') ?? '')
  }
  for (const ref of Object.values(env.references ?? {})) add(ref.href)
  return candidates.filter((_link, index) => ids.has(index))
}

export function workspaceBacklinks(files: WorkspaceFile[], target: string, drafts: ReadonlyMap<string, string>) {
  const paths = files.map((file) => file.path)
  return files.filter((file) => file.path !== target).flatMap((file) => {
    const md = drafts.get(file.path) ?? file.source?.markdown ?? ''
    const wiki = wikiOccurrences(md).filter(({ raw }) => {
      const link = parseWikiLink(raw)
      return link && resolveWikiPath(paths, file.path, link.name) === target
    }).length
    const count = wiki + standardOccurrences(md).filter(({ destination }) => resolveMarkdownPath(paths, file.path, destination) === target).length
    return count ? [{ file, count }] : []
  })
}

export function renamedWorkspaceLinks(markdown: string, paths: string[], from: string, oldPath: string, newPath: string) {
  const nextPaths = paths.map((path) => path === oldPath ? newPath : path)
  const links = wikiOccurrences(markdown).filter(({ raw }) => {
    const link = parseWikiLink(raw)
    return link?.name && resolveWikiPath(paths, from, link.name) === oldPath
  })
  const name = newPath.slice(parentPath(newPath).length)
  const changes = links.map(({ at, raw }) => {
    const link = parseWikiLink(raw)!
    const includeExtension = /\.(?:md|markdown)$/i.test(link.name)
    const relative = parentPath(link.name) + (includeExtension ? name : stem(name))
    const replacement = resolveWikiPath(nextPaths, from === oldPath ? newPath : from, relative) === newPath
      ? relative : '/' + (includeExtension ? newPath : stem(newPath))
    return { at, raw, replacement: '[[' + replacement + link.fragment + link.alias + ']]' }
  })
  const filename = name.replace(/[ %<>()]/g, (char) => '%' + char.codePointAt(0)!.toString(16).toUpperCase())
  for (const { at, raw, destination } of standardOccurrences(markdown)) {
    if (resolveMarkdownPath(paths, from, destination) !== oldPath) continue
    const prefix = raw.split(/[?#]/, 1)[0]
    const replacement = parentPath(prefix) + filename + raw.slice(prefix.length)
    changes.push({ at, raw, replacement })
  }
  changes.sort((a, b) => a.at - b.at)
  let result = markdown
  for (const { at, raw, replacement } of changes.slice().reverse()) {
    result = result.slice(0, at) + replacement + result.slice(at + raw.length)
  }
  return { markdown: result, changes }
}

export function previewWorkspaceRename(files: WorkspaceFile[], target: WorkspaceFile, input: string) {
  const name = input.trim()
  if (!name || /[<>:"/\\|?*#[\]\u0000-\u001f]|[ .]$|^\./.test(name) ||
      /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name) || name.length > 180) {
    throw new Error('请输入有效的 Markdown 文件名。')
  }
  const filename = /\.(?:md|markdown)$/i.test(name) ? name : name + (target.handle.name.match(/\.(?:md|markdown)$/i)?.[0] ?? '.md')
  const path = parentPath(target.path) + filename
  if (files.some((file) => fold(file.path) === fold(path))) throw new Error('文件名已存在。请选择其他名称。')
  const paths = files.map((file) => file.path)
  if (files.some((file) => !file.source)) throw new Error('工作区中有无法读取的 Markdown 文档。请修复后刷新工作区。')
  const edits = files.flatMap((file) => {
    const { markdown, changes } = renamedWorkspaceLinks(file.source!.markdown, paths, file.path, target.path, path)
    return changes.length ? [{ file, markdown, changes }] : []
  })
  return { filename, path, target, files, edits }
}

export type WorkspaceRename = ReturnType<typeof previewWorkspaceRename>

async function assertVacant(directory: LocalDirectoryHandle, name: string) {
  for await (const entry of directory.values()) {
    if (fold(entry.name) === fold(name)) throw new Error('目标名称已被占用。请刷新工作区后重试。')
  }
}

export async function commitWorkspaceRename(root: LocalDirectoryHandle, plan: WorkspaceRename) {
  const { directory, handle: original } = plan.target
  const source = plan.target.source!
  const indexed = await listWorkspace(root)
  if (indexed.length !== plan.files.length || indexed.some((file, index) => file.path !== plan.files[index].path)) {
    throw new Error('预览后工作区文件列表发生变化。请刷新工作区并重新预览。')
  }
  const fresh = await Promise.all(plan.files.map((file) => localFileMatches(file.handle, file.source!.diskHash)))
  if (fresh.some((matches) => !matches)) throw new Error('预览后有文件发生变化。请刷新工作区并重新预览。')
  const updated = plan.edits.filter((edit) => edit.file !== plan.target)
  const self = plan.edits.find((edit) => edit.file === plan.target)
  await assertVacant(directory, plan.filename)
  const next = await directory.getFileHandle(plan.filename, { create: true }) as LocalFileHandle
  const emptyHash = await markdownHash('')
  const initial: ArrayBuffer | string = self ? serializeLocalMarkdown(self.markdown, source.source) : source.bytes
  const nextHash = await markdownHash(initial)
  let created = false
  const completed: { file: WorkspaceFile; hash: string }[] = []
  try {
    created = await writeLocalMarkdown(next, initial, emptyHash)
    if (!created) throw new Error('目标文件已发生变化。')
    for (const { file, markdown } of updated) {
      const content = serializeLocalMarkdown(markdown, file.source!.source)
      const hash = await markdownHash(content)
      if (!await writeLocalMarkdown(file.handle, content, file.source!.diskHash)) throw new Error('引用文件已发生变化。')
      completed.push({ file, hash })
    }
    if (!await localFileMatches(original, source.diskHash)) throw new Error('原文件已发生变化。')
    await directory.removeEntry(original.name)
  } catch (error) {
    const originalAvailable = await directory.getFileHandle(original.name).then(
      (file) => file.isSameEntry(original),
    ).catch(() => false)
    if (!originalAvailable) throw new Error('原文件在操作中无法访问，已保留新文件。请检查文件及引用。')
    let restored = true
    for (const { file, hash } of completed.reverse()) {
      const succeeded = await writeLocalMarkdown(file.handle, file.source!.bytes, hash).catch(() => false)
      if (!succeeded) restored = false
    }
    if (restored && await localFileMatches(next, created ? nextHash : emptyHash).catch(() => false)) {
      await directory.removeEntry(plan.filename).catch(() => { restored = false })
    } else restored = false
    if (!restored) throw new Error('重命名未完成。部分文件在操作中发生变化，请保留两个文件并检查引用。')
    throw error
  }
  return next
}
