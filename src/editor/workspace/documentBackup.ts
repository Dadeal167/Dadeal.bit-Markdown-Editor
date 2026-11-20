import { MAX_DOC_VERSIONS, type Doc, type DocVersion } from '../documents'

const FORMAT = 'dadealbit-document-backup'
const VERSION = 1

function validTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 8.64e15
}

function validVersion(value: unknown): value is DocVersion {
  const version = value as Partial<DocVersion> | null
  return !!version && typeof version.title === 'string' && typeof version.md === 'string' &&
    validTimestamp(version.at)
}

export function serializeDocumentBackup(docs: readonly Doc[]): string {
  return JSON.stringify({ format: FORMAT, version: VERSION, docs })
}

export function parseDocumentBackup(text: string): Doc[] {
  let data: { format?: unknown; version?: unknown; docs?: unknown } | null
  try {
    data = JSON.parse(text.replace(/^\uFEFF/, ''))
  } catch {
    throw new Error('无法读取备份，文件不是有效的 JSON。')
  }
  if (data?.format !== FORMAT || !Array.isArray(data.docs)) {
    throw new Error('请选择通过「备份全部文档」导出的文件。')
  }
  if (data.version !== VERSION) throw new Error('暂不支持这个版本的备份文件。')

  const ids = new Set<string>()
  return data.docs.map((value: unknown, index: number) => {
    const doc = value as Partial<Doc> | null
    if (!doc || typeof doc !== 'object' || typeof doc.id !== 'string' || !doc.id.trim() || ids.has(doc.id) ||
        typeof doc.title !== 'string' || typeof doc.md !== 'string' || !validTimestamp(doc.at) ||
        (doc.numberEquations !== undefined && typeof doc.numberEquations !== 'boolean') ||
        (doc.exportContents !== undefined && typeof doc.exportContents !== 'boolean') ||
        (doc.trashedAt !== undefined && (!validTimestamp(doc.trashedAt) || doc.trashedAt === 0)) ||
        (doc.versions !== undefined && (!Array.isArray(doc.versions) || !doc.versions.every(validVersion)))) {
      throw new Error('备份中的第 ' + (index + 1) + ' 篇文档格式有误。')
    }
    const { id, title, md, at, trashedAt, versions, numberEquations, exportContents } = doc
    ids.add(id)
    return { id, title, md, at, trashedAt, versions: versions?.slice(0, MAX_DOC_VERSIONS), numberEquations, exportContents }
  })
}

export function mergeDocumentBackup(existing: readonly Doc[], incoming: readonly Doc[]) {
  const byId = new Map(existing.map((doc) => [doc.id, doc]))
  const reserved = new Set(incoming.map((doc) => doc.id))
  const added: Doc[] = []
  const updated = new Map<string, Doc>()
  let skipped = 0
  for (const doc of incoming) {
    // 用稳定的副本 ID 在重试时找到已经恢复的版本。
    let id = doc.id
    let stored = byId.get(id)
    let copy = 0
    while (stored && (stored.title !== doc.title || stored.md !== doc.md || !!stored.trashedAt !== !!doc.trashedAt ||
        !!stored.numberEquations !== !!doc.numberEquations || !!stored.exportContents !== !!doc.exportContents)) {
      do { id = doc.id + '-restored-' + ++copy } while (reserved.has(id))
      stored = byId.get(id)
    }
    if (stored) {
      const versions = [...(stored.versions ?? [])]
      for (const version of doc.versions ?? []) {
        if (!versions.some((saved) => saved.title === version.title && saved.md === version.md && saved.at === version.at)) {
          versions.push(version)
        }
      }
      if (versions.length > (stored.versions?.length ?? 0)) {
        versions.sort((a, b) => b.at - a.at)
        const recent = versions.slice(0, MAX_DOC_VERSIONS)
        if (!recent.every((version, i) => version === stored.versions?.[i])) {
          const merged = { ...stored, versions: recent }
          byId.set(id, merged)
          updated.set(id, merged)
          continue
        }
      }
      skipped++
      continue
    }
    const restored = { ...doc, id }
    added.push(restored)
    byId.set(id, restored)
  }
  return { added, updated, skipped }
}
