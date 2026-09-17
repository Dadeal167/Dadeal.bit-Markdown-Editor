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
import { idbAvailable, idbLoadAll, idbReplaceAll, idbSaveChanged } from './docStore'

export interface Doc {
  id: string
  title: string
  md: string
  at: number
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
/** 界面已经先渲染了（3 秒超时那条路），后面 IndexedDB 才就绪：需要整库推一次 */
let needFullPush = false
/** 界面是不是已经先渲染过了（超时兜底那条路） */
let uiStarted = false
/** 界面先渲染出来的那份数据是不是被用户改过（改过就以内存为准，不拿 IndexedDB 覆盖） */
let editedBeforeIdbReady = false
/** IndexedDB 就绪得比界面渲染晚时，通知界面重新读一遍（_只有当窗口期内没有编辑时_） */
let onReloaded: ((store: DocStore) => void) | null = null
export function onStoreReloaded(cb: ((store: DocStore) => void) | null): void {
  onReloaded = cb
}

/** main.tsx 在"没等到 IndexedDB 就先把界面画出来"之后调用它 */
export function markUiStarted(): void {
  uiStarted = true
  if (!idbOk) needFullPush = true
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
        const currentId = docs.some((d) => d.id === parsed.currentId) ? parsed.currentId : docs[0].id
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
  idbOk = await idbAvailable()
  if (idbOk) {
    try {
      const fromIdb = await idbLoadAll()
      if (fromIdb) {
        // 界面已经先渲染过（3 秒超时那条路）：见下面的"迟到"处理
        if (adopt(fromIdb, 'indexeddb')) return cache as DocStore
        return fromIdb
      }
      // 库里是空的：把 localStorage 的老文档搬过去（搬完不删 localStorage，留着当双保险）
      const legacy = loadLocalStore()
      await idbReplaceAll(legacy)
      if (adopt(legacy, 'indexeddb')) return cache as DocStore
      cache = legacy
      backend = 'indexeddb'
      expose()
      return cache
    } catch {
      // 读/迁移出问题就退回老路，绝不让界面白屏
      idbOk = false
    }
  }
  cache = loadLocalStore()
  backend = 'localstorage'
  expose()
  return cache
}

/**
 * IndexedDB 迟到（界面已经先用 localStorage 那份画出来了）时怎么办：
 *   · 窗口期内**没有编辑** → 以 IndexedDB 为准，并喊界面重新读一遍（否则界面一直显示过期列表）
 *   · 窗口期内**编辑过** → 以内存为准（用户正打着的字不能被覆盖），标记"下次整库推一次"，
 *     免得 IndexedDB 里缺文档；返回 false 表示"别采纳 IndexedDB 这份"
 */
function adopt(fromIdb: DocStore, be: 'indexeddb' | 'localstorage'): boolean {
  if (editedBeforeIdbReady) {
    needFullPush = true
    idbOk = true
    backend = be
    expose()
    return false
  }
  cache = fromIdb
  backend = be
  idbOk = true
  expose()
  if (uiStarted) onReloaded?.(fromIdb)
  return true
}

/** 同步取文档库（渲染时用）。没走过 initDocStore 就退回 localStorage 老路 */
export function loadStore(): DocStore {
  if (!cache) cache = loadLocalStore()
  return cache
}

/**
 * 写文档库；返回 false 表示"这次真的没存住"（界面据此提示保存失败）。
 * IndexedDB 可用时：只把变化的那几篇写进去（异步排队），并顺手留一份小的 localStorage 冷备份。
 */
export function saveStore(store: DocStore): boolean {
  const prev = cache
  cache = store
  expose()

  if (idbOk) {
    // 界面先渲染过、IndexedDB 才就绪：库可能压根没有这些文档，整库推一次最稳
    if (needFullPush) {
      needFullPush = false
      void idbReplaceAll(store)
        .then(() => {
          dirtyIds.clear()
          pendingRemoved.clear()
          if (lastWriteFailed) {
            lastWriteFailed = false
            onOk?.()
          }
          expose()
        })
        .catch(() => {
          needFullPush = true // 没成功，下次接着整库推
          failWrite(store, store.docs.map((d) => d.id), [])
        })
      backupToLocal(store)
      return !lastWriteFailed
    }

    const prevById = new Map((prev?.docs ?? []).map((d) => [d.id, d]))
    const changed = store.docs.filter((d) => {
      // 上次没写成功的（或界面先渲染那段时间改过的）：无条件重写一遍
      if (dirtyIds.has(d.id)) return true
      const p = prevById.get(d.id)
      return !p || p.md !== d.md || p.title !== d.title || p.at !== d.at
    })
    const removed = [
      ...(prev?.docs ?? []).filter((d) => !store.docs.some((x) => x.id === d.id)).map((d) => d.id),
      ...pendingRemoved,
    ]
    void idbSaveChanged(changed, removed, store.currentId)
      .then(() => {
        // ⚠️ 只把"这次真的写进去的"从待重试队列里摘掉。
        // 不能整体 clear：这次可能只写了元数据（changed 为空），
        // 那样会把上一次没写成功的文档从队列里抹掉 —— 等于白修。
        for (const d of changed) dirtyIds.delete(d.id)
        for (const id of removed) pendingRemoved.delete(id)
        if (lastWriteFailed && !dirtyIds.size && !pendingRemoved.size) {
          lastWriteFailed = false
          onOk?.()
        }
        expose()
      })
      .catch(() => failWrite(store, changed.map((d) => d.id), removed))
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
  editedBeforeIdbReady = true
  try {
    localStorage.setItem(DOCS_KEY, JSON.stringify(store))
    return true
  } catch {
    return false
  }
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
    for (const d of store.docs) n += d.md.length + d.title.length + 80
    return n
  } catch {
    return 0
  }
}
