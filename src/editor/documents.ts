/**
 * 多文档存储层。
 *
 * 两个后端，**IndexedDB 优先**：
 *   · IndexedDB（`docStore.ts`，库 `md-editor-docs`）：正经存放处。一篇文章一条记录，
 *     保存时只写变化的那几篇；额度是"磁盘可用空间的一个比例"，图片多的文档也不会撞上限
 *   · localStorage（`md-editor-docs-v1`）：老位置。现在只当**迁移来源 + 冷备份**：
 *     启动时如果 IndexedDB 是空的，就把这里的数据搬过去（搬完**不删**，留着当双保险）；
 *     之后每次保存，只要整库小于 2MB 就顺手再写一份（图个安心），大了就不写
 *   · 早期只有一个草稿槽的版本（md-editor-draft-v1）也在这里迁移成第一篇文档
 *
 * 键名一律不许改：改了用户已有的文档就全丢了（这条从第一版就写在这儿了）。
 */
import { idbLoadAll, idbMigrateIfEmpty, idbSaveChanged } from './docStore'

export interface Doc {
  id: string
  title: string
  md: string
  at: number
  trashedAt?: number
  versions?: DocVersion[]
  numberEquations?: boolean
  exportContents?: boolean
}

export interface DocVersion {
  title: string
  md: string
  at: number
}

export const MAX_DOC_VERSIONS = 12

export function captureDocVersion(doc: Doc, at = Date.now()): Doc {
  const last = doc.versions?.[0]
  if (last?.md === doc.md && last.title === doc.title) return doc
  const version = { title: doc.title, md: doc.md, at }
  return { ...doc, versions: [version, ...(doc.versions ?? [])].slice(0, MAX_DOC_VERSIONS) }
}

export interface DocStore {
  docs: Doc[]
  currentId: string
}

export const DOCS_KEY = 'md-editor-docs-v1'
export const LEGACY_DRAFT_KEY = 'md-editor-draft-v1'

/** 内存里的权威副本：渲染时同步读它（首帧之前由 initDocStore() 填好） */
let cache: DocStore | null = null
let backend: 'indexeddb' | 'localstorage' = 'localstorage'
let idbOk = false
/** 上一次 IndexedDB 写入失败了吗（失败过一次就用 localStorage 兜一下，并让界面报"保存失败"） */
let lastWriteFailed = false
/** localStorage 冷备份的大小上限：超过就不写（免得又去撞那个 5MB 上限） */
const BACKUP_MAX_BYTES = 2 * 1024 * 1024

/**
 * ⚠️ 写失败过的文档 id：下次保存**必须重试**（这是防丢内容的关键）。
 *
 * 为什么需要它：`changed` 是拿"内存里的新库"和"内存里的旧库"比出来的，
 * 而写失败只影响 IndexedDB、不影响内存 —— 于是失败那篇在下一次比较时"看起来没变化"，
 * 永远不会再写进 IndexedDB。用户接着改**另一篇**、这次写成功了，界面还会把"保存失败"的红字清掉，
 * 看起来一切正常；直到刷新才发现那一篇退回了旧版本（真实踩点：IDB 配额满一次就中招）。
 */
let dirtyIds = new Set<string>()
/** 上一次没删成功的 id：同理，下次一起删 */
let pendingRemoved = new Set<string>()
/** 启动超时后显示的备份，用于区分备份中的旧数据和用户刚做的改动。 */
let fallbackBase: DocStore | null = null
const confirmedDocs = new Map<string, Doc>()
let saveQueue: Promise<void> = Promise.resolve()
let onConflict: ((copies: Doc[]) => void) | null = null
export function onStoreConflict(callback: typeof onConflict): void {
  onConflict = callback
}

let onReloaded: ((store: DocStore, live?: Doc) => void) | null = null
let readLiveDoc: (() => Doc | undefined) | undefined
export function onStoreReloaded(cb: typeof onReloaded, snapshot?: typeof readLiveDoc): void {
  onReloaded = cb
  readLiveDoc = snapshot
}

/* 异步后端意味着"写失败"是稍后才知道的，没法靠 saveStore 的返回值同步告诉界面。
   所以这里给界面留一个订阅口：写坏了喊一声，写好了再喊一声（状态栏据此常驻/消失）。 */
let onError: (() => void) | null = null
let onOk: (() => void) | null = null
export function onStoreWriteFailed(cb: (() => void) | null): void {
  onError = cb
}
export function onStoreWriteOk(cb: (() => void) | null): void {
  onOk = cb
}

/** 给自动化测试看的内部状态（就像 window.__MD__ 那样） */
function expose(): void {
  try {
    ;(window as unknown as { __DOCSTORE__?: unknown }).__DOCSTORE__ = {
      backend,
      docs: cache?.docs.length ?? 0,
      bytes: cache ? storeBytes(cache) : 0,
      lastError: lastWriteFailed,
    }
  } catch {
    /* 没有 window 就算了 */
  }
}

/** 首次打开时的示例文档（只在完全没有文档时用） */
export const DEMO_MD = `# 欢迎使用

这是一篇用起来像 Word、存下来是 Markdown 的文档。**加粗**、*斜体* 直接点上面的按钮就行，不用记任何语法。

## 数学公式

点顶栏的「公式」，左边都是图形按钮，拼出来就行，比如 $x=\\frac{-b\\pm\\sqrt{b^2-4ac}}{2a}$。

$$
\\sum_{i=1}^{n} i=\\frac{n(n+1)}{2}
$$

## 列表与引用

- 无序列表：点「列表」
- 也可以切换成有序列表

> 引用：写重点句子的时候用

| 列 A | 列 B |
| --- | --- |
| 内容 1 | 内容 2 |

---
`

export function newId(): string {
  return `d${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`
}

export function createDoc(title = '', md = ''): Doc {
  return { id: newId(), title, md, at: Date.now() }
}

/** 文档在列表里的显示名 */
export function docLabel(doc: Doc): string {
  const t = doc.title.trim()
  if (t) return t
  const firstLine = doc.md
    .split('\n')
    .map((l) => l.replace(/^#+\s*/, '').trim())
    .find((l) => l.length > 0)
  return firstLine ? firstLine.slice(0, 24) : '未命名文档'
}

function readLegacy(): Doc | null {
  try {
    const raw = localStorage.getItem(LEGACY_DRAFT_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { title?: string; md?: string; at?: number }
    if (typeof parsed?.md !== 'string') return null
    // 空草稿不算：老版本第一次打开时也会写入示例内容，但用户没动过就不必迁移
    return {
      id: newId(),
      title: parsed.title ?? '',
      md: parsed.md,
      at: parsed.at ?? Date.now(),
    }
  } catch {
    return null
  }
}

/** 从 localStorage 读（老路，也是迁移来源）。含坏数据备份 + 旧版单草稿迁移 + 首次的示例文档 */
export function loadLocalStore(): DocStore {
  let initial: DocStore | null = null
  let broken = false

  try {
    const raw = localStorage.getItem(DOCS_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as DocStore
      const docs = Array.isArray(parsed?.docs) ? parsed.docs.filter((d) => d && typeof d.md === 'string') : []
      if (docs.length > 0) {
        const currentId = docs.some((d) => d.id === parsed.currentId && !d.trashedAt)
          ? parsed.currentId : (docs.find((d) => !d.trashedAt) ?? docs[0]).id
        initial = { docs, currentId }
      } else {
        broken = true
      }
    }
  } catch {
    broken = true
  }

  if (broken) {
    // 数据坏了也先留一份备份再重建，别直接覆盖——用户可能还能人工抢救
    try {
      const raw = localStorage.getItem(DOCS_KEY)
      if (raw) localStorage.setItem(`${DOCS_KEY}-broken-${Date.now()}`, raw)
    } catch {
      /* 备份失败就算了 */
    }
  }

  if (!initial) {
    // 迁移旧版单草稿
    const legacy = readLegacy()
    if (legacy && legacy.md.trim()) {
      initial = { docs: [legacy], currentId: legacy.id }
    } else {
      const first = createDoc('', DEMO_MD)
      initial = { docs: [first], currentId: first.id }
    }
  }

  // 立刻落盘：迁移或首次创建的结果不能只留在内存里（否则刷新一次就白迁移了）
  try {
    localStorage.setItem(DOCS_KEY, JSON.stringify(initial))
  } catch {
    /* 写不进去不影响本次使用 */
  }
  return initial
}

/**
 * 启动时调用一次（在渲染之前）：决定用哪个后端、必要时把老数据迁到 IndexedDB。
 * 放在渲染之前是为了让 `loadStore()` 能同步返回最终数据 —— 界面里到处都在同步读它。
 */
export async function initDocStore(): Promise<DocStore> {
  let fromIdb: DocStore
  try {
    fromIdb = (await idbLoadAll()) ?? (await idbMigrateIfEmpty(cache ?? loadLocalStore()))
  } catch {
    // 读库或迁移失败时，继续使用已经显示的本地备份。
    cache ??= loadLocalStore()
    fallbackBase = null
    expose()
    return cache
  }

  const base = fallbackBase
  const local = cache
  const live = base ? readLiveDoc?.() : undefined
  const merged = base && local ? mergeStartupChanges(fromIdb, base, local, live) : fromIdb
  fallbackBase = null
  cache = fromIdb
  for (const doc of fromIdb.docs) confirmedDocs.set(doc.id, doc)
  idbOk = true
  backend = 'indexeddb'
  if (merged !== fromIdb) saveStore(merged)
  expose()
  if (base) onReloaded?.(merged, live)
  return merged
}

function sameContent(a: Doc, b: Doc | undefined): boolean {
  return !!b && a.title === b.title && a.md === b.md && a.trashedAt === b.trashedAt &&
    Boolean(a.numberEquations) === Boolean(b.numberEquations) &&
    Boolean(a.exportContents) === Boolean(b.exportContents) &&
    a.versions?.length === b.versions?.length &&
    (a.versions ?? []).every((version, i) => {
      const other = b.versions?.[i]
      return version.at === other?.at && version.title === other.title && version.md === other.md
    })
}

function recoverOtherDraft(stored: Doc | undefined, base?: Doc, next?: Doc): Doc | undefined {
  if (!stored || sameContent(stored, next) || sameContent(stored, base)) return undefined
  return { ...stored, id: newId(), title: `${docLabel(stored)}（冲突副本）`, trashedAt: undefined, at: Date.now() }
}

/** 将启动等待期间的改动应用到数据库版本，备份中的旧内容不参与覆盖。 */
function mergeStartupChanges(db: DocStore, base: DocStore, local: DocStore, live: Doc | undefined): DocStore {
  const baseById = new Map(base.docs.map((doc) => [doc.id, doc]))
  const merged = new Map(db.docs.map((doc) => [doc.id, doc]))
  const localIds = new Set(local.docs.map((doc) => doc.id))
  let changed = local.currentId !== base.currentId

  for (const original of local.docs) {
    const doc = live?.id === original.id ? live : original
    const before = baseById.get(doc.id)
    if (sameContent(doc, before)) continue
    changed = true
    const stored = merged.get(doc.id)
    if (stored && !sameContent(stored, doc) && !sameContent(stored, before)) {
      const copy = createDoc(`${docLabel(stored)}（恢复副本）`, stored.md)
      merged.set(copy.id, copy)
    }
    merged.set(doc.id, doc)
  }

  for (const before of base.docs) {
    const stored = merged.get(before.id)
    if (!localIds.has(before.id) && stored && sameContent(stored, before) && merged.size > 1) {
      merged.delete(before.id)
      changed = true
    }
  }

  if (!changed) return db
  const docs = [...merged.values()]
  const currentId = merged.get(local.currentId) && !merged.get(local.currentId)?.trashedAt ? local.currentId
    : merged.get(db.currentId) && !merged.get(db.currentId)?.trashedAt ? db.currentId : (docs.find((d) => !d.trashedAt) ?? docs[0]).id
  return { docs, currentId }
}

/** 同步取文档库（渲染时用）。没走过 initDocStore 就退回 localStorage 老路 */
export function loadStore(): DocStore {
  if (!cache) {
    cache = loadLocalStore()
    fallbackBase = cache
  }
  return cache
}

export function isDocStoreLoading(): boolean {
  return fallbackBase !== null
}

/**
 * 写文档库；返回 false 表示"这次真的没存住"（界面据此提示保存失败）。
 * IndexedDB 可用时：只把变化的那几篇写进去（异步排队），并顺手留一份小的 localStorage 冷备份。
 */
export function saveStore(store: DocStore, onSaved?: (ok: boolean) => void): boolean {
  if (idbOk) {
    const prev = cache
    cache = store
    expose()

    const prevById = new Map((prev?.docs ?? []).map((d) => [d.id, d]))
    const changedIds = new Set(store.docs.filter((d) => {
      const p = prevById.get(d.id)
      return p !== d && (!sameContent(d, p) || p?.at !== d.at)
    }).map((d) => d.id))
    const nextIds = new Set(store.docs.map((d) => d.id))
    const removedIds = (prev?.docs ?? []).filter((d) => !nextIds.has(d.id)).map((d) => d.id)
    saveQueue = saveQueue.then(async () => {
      // 轮到这次保存时，上一笔事务的提交结果与待重试项目都已确定。
      const changed = store.docs.filter((d) => changedIds.has(d.id) || dirtyIds.has(d.id))
      const removed = [...new Set([...removedIds, ...[...pendingRemoved].filter((id) => !nextIds.has(id))])]
      let copies: Doc[]
      try {
        copies = await idbSaveChanged(changed, removed, store.currentId,
          __BUILD_MODE__ === 'effect' ? (id, stored, next) => recoverOtherDraft(stored, confirmedDocs.get(id), next) : undefined)
      } catch {
        failWrite(cache ?? store, changed.map((d) => d.id), removed)
        onSaved?.(false)
        return
      }
      for (const d of changed) {
        dirtyIds.delete(d.id)
        pendingRemoved.delete(d.id)
        confirmedDocs.set(d.id, d)
      }
      for (const id of removed) {
        pendingRemoved.delete(id)
        dirtyIds.delete(id)
        confirmedDocs.delete(id)
      }
      if (copies.length && cache) {
        cache = { ...cache, docs: [...copies, ...cache.docs] }
        for (const copy of copies) confirmedDocs.set(copy.id, copy)
        backupToLocal(cache)
        onConflict?.(copies)
      }
      if (lastWriteFailed && !dirtyIds.size && !pendingRemoved.size) {
        lastWriteFailed = false
        onOk?.()
      }
      expose()
      onSaved?.(true)
    })
    // 冷备份：整库还小就再写一份到 localStorage（图个安心）；大了跳过，免得又撞上限
    backupToLocal(store)
    /* 返回值只说"这次调用有没有同步地失败"。
       ⚠️ 这里**故意不因为"上一次异步写失败过"就返回 false**：那样用户会被卡住 ——
       切文档 / 新建 / 打开 全被拒（调用方看到 false 就弹"存不下"并中止），
       而唯一能清掉失败状态的办法偏偏是"继续在当前这篇打字"。写坏了这件事由
       onError / onOk 异步告诉界面（状态栏红字 + 弹一次），不靠这个返回值。 */
    return true
  }

  // 没有 IndexedDB（或还没就绪）：完全走老路
  try {
    const result = __BUILD_MODE__ === 'effect' && cache && !fallbackBase ? mergeLocalDrafts(store, cache) : { store, copies: [] }
    localStorage.setItem(DOCS_KEY, JSON.stringify(result.store))
    cache = result.copies.length ? { ...store, docs: [...result.copies, ...store.docs] } : store
    if (result.copies.length) queueMicrotask(() => onConflict?.(result.copies))
    expose()
  } catch {
    onSaved?.(false)
    return false
  }
  onSaved?.(true)
  return true
}

function mergeLocalDrafts(desired: DocStore, base: DocStore) {
  const raw = localStorage.getItem(DOCS_KEY)
  let latest: DocStore | undefined
  try { if (raw) latest = JSON.parse(raw) as DocStore }
  catch { /* 继续使用本标签页已载入的数据。 */ }
  if (!Array.isArray(latest?.docs)) return { store: desired, copies: [] }
  const stored = new Map(latest.docs.map((doc) => [doc.id, doc]))
  const before = new Map(base.docs.map((doc) => [doc.id, doc]))
  const next = new Map(desired.docs.map((doc) => [doc.id, doc]))
  const copies: Doc[] = []
  for (const id of new Set([...before.keys(), ...next.keys()])) {
    const old = before.get(id)
    const incoming = next.get(id)
    if (incoming && sameContent(incoming, old)) continue
    const copy = recoverOtherDraft(stored.get(id), old, incoming)
    if (copy) copies.push(copy)
    if (incoming) stored.set(id, incoming)
    else stored.delete(id)
  }
  return { store: { ...desired, docs: [...copies, ...stored.values()] }, copies }
}

/** 写失败：记下"哪几篇没写成功"（下次重试），用 localStorage 兜一份，并让界面提示 */
function failWrite(store: DocStore, changedIds: string[], removedIds: string[]): void {
  const firstFailure = !lastWriteFailed
  lastWriteFailed = true
  for (const id of changedIds) dirtyIds.add(id)
  for (const id of removedIds) pendingRemoved.add(id)
  try {
    localStorage.setItem(DOCS_KEY, JSON.stringify(store))
  } catch {
    /* localStorage 也写不下：数据只能留在内存里，界面会提示先导出 .md */
  }
  expose()
  if (firstFailure) onError?.()
}

/** 整库还小就顺手留一份 localStorage 冷备份（大了跳过，免得撞 5MB 上限） */
function backupToLocal(store: DocStore): void {
  if (storeBytes(store) > BACKUP_MAX_BYTES) return
  try {
    localStorage.setItem(DOCS_KEY, JSON.stringify(store))
  } catch {
    /* 备份写不下就算了，IndexedDB 那份才是权威 */
  }
}

/**
 * 只是估个占用，用于界面提示与"要不要写冷备份"的判断。
 *
 * ⚠️ 这里**故意不做 JSON.stringify**：自动保存每 1.2 秒一次，而库里的图是 base64 内嵌、
 * 动辄几十 MB —— 之前每次保存都要把这几十 MB 拼成字符串（还要拼三遍），打字会卡。
 * 正文与标题本来就占了几乎全部体积，按字符数估足够了。
 */
export function storeBytes(store: DocStore): number {
  try {
    let n = 64
    for (const d of store.docs) {
      n += d.md.length + d.title.length + 80
      for (const version of d.versions ?? []) n += version.md.length + version.title.length + 60
    }
    return n
  } catch {
    return 0
  }
}
