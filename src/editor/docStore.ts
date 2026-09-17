/**
 * 文档的 IndexedDB 存储层。
 *
 * 为什么要把文档从 localStorage 搬过来：localStorage 每个源只有 **5MB**，
 * 而这里的文档是 Markdown + **内嵌 base64 图片**——写几篇带图的文章就撞上限，
 * 用户看到的是"保存失败：内容超出浏览器存储上限"（实测真的会撞）。
 * IndexedDB 的额度是"磁盘可用空间的一个比例"（通常几百 MB～几 GB），足够放图。
 *
 * 设计要点（都是为了让迁移**不丢数据**）：
 *   · 一篇文档一条记录（key = 文档 id）——保存时只写变化的那几篇，
 *     不再像 localStorage 那样每次把整个库（含所有图片）重写一遍
 *   · localStorage 那份**保留不删**：它是迁移来源，也是一份"以防万一"的冷备份
 *   · 任何一步失败（隐私模式、被禁用、配额）都不抛到界面上：调用方会退回 localStorage 老路
 *
 * 注意：库名/键名一旦发布就不能改，改了用户已有的文档就找不回来了。
 */
import type { Doc, DocStore } from './documents'

const DB_NAME = 'md-editor-docs'
const DB_VERSION = 1
const DOCS = 'docs'
const META = 'meta'

/**
 * 复用一个数据库连接。
 *
 * 以前每次 tx() 都 open 一个新连接、而且**从不 close**：自动保存每 1.2 秒一次，
 * 写一晚上能攒出上千个没关的连接（内存一直涨）。连接可以长期持有，
 * 只要处理"别的标签页要升级版本"（versionchange）时主动让开就行。
 */
let dbPromise: Promise<IDBDatabase> | null = null

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('这个浏览器/上下文不支持 IndexedDB'))
      return
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(DOCS)) db.createObjectStore(DOCS, { keyPath: 'id' })
      if (!db.objectStoreNames.contains(META)) db.createObjectStore(META, { keyPath: 'k' })
    }
    req.onsuccess = () => {
      const db = req.result
      // 别的标签页要升级/删库：让开连接，下次用时重开（否则对面会一直 blocked）
      db.onversionchange = () => {
        db.close()
        dbPromise = null
      }
      db.onclose = () => {
        dbPromise = null
      }
      resolve(db)
    }
    req.onerror = () => {
      dbPromise = null
      reject(req.error)
    }
    // 另一个标签页占着旧版本时别一直挂着（同 customFonts 的处理）
    req.onblocked = () => {
      dbPromise = null
      reject(new Error('另一个标签页正占着文档库'))
    }
  })
  // 失败别把"坏掉的 promise"缓存住，否则后面每次都会立刻失败
  dbPromise.catch(() => {
    dbPromise = null
  })
  return dbPromise
}

/** 跑一个事务；以**事务完成**为准（写入这时才真正落盘） */
function tx<T>(mode: IDBTransactionMode, run: (t: IDBTransaction) => Promise<T> | T): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        let result: T
        const t = db.transaction([DOCS, META], mode)
        // ⚠️ run() 异步 reject 时必须把外层 promise 一起 reject 掉：
        // 否则事务可能既不 complete 也不 error，这个 promise 永远不 settle（initDocStore 直接挂住）
        Promise.resolve(run(t)).then(
          (r) => {
            result = r
          },
          (e) => {
            try {
              t.abort()
            } catch {
              /* 事务可能已经结束了 */
            }
            reject(e)
          },
        )
        t.oncomplete = () => resolve(result)
        t.onerror = () => reject(t.error)
        t.onabort = () => reject(t.error ?? new Error('事务被中止'))
      }),
  )
}

const wrap = <T>(req: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })

/** 读出全部文档 + 当前文档 id；库里是空的就返回 null（调用方据此决定要不要迁移） */
export async function idbLoadAll(): Promise<DocStore | null> {
  return tx('readonly', async (t) => {
    const docs = (await wrap(t.objectStore(DOCS).getAll())) as Doc[]
    const cur = (await wrap(t.objectStore(META).get('currentId'))) as { k: string; v: string } | undefined
    if (!docs.length) return null
    const valid = docs.filter((d) => d && typeof d.md === 'string')
    if (!valid.length) return null
    const currentId = valid.some((d) => d.id === cur?.v) ? String(cur?.v) : valid[0].id
    return { docs: valid, currentId }
  })
}

/** 只写变化的那几篇 + 删掉被移除的 + 记住当前是第几篇 */
export async function idbSaveChanged(changed: Doc[], removed: string[], currentId: string): Promise<void> {
  if (!changed.length && !removed.length) {
    await tx('readwrite', (t) => {
      t.objectStore(META).put({ k: 'currentId', v: currentId })
    })
    return
  }
  await tx('readwrite', (t) => {
    const docs = t.objectStore(DOCS)
    for (const d of changed) docs.put(d)
    for (const id of removed) docs.delete(id)
    t.objectStore(META).put({ k: 'currentId', v: currentId })
    t.objectStore(META).put({ k: 'savedAt', v: Date.now() })
  })
}

/** 整库替换（只在"从 localStorage 迁移过来"时用一次） */
export async function idbReplaceAll(store: DocStore): Promise<void> {
  await tx('readwrite', (t) => {
    const docs = t.objectStore(DOCS)
    docs.clear()
    for (const d of store.docs) docs.put(d)
    t.objectStore(META).put({ k: 'currentId', v: store.currentId })
    t.objectStore(META).put({ k: 'migratedFromLocalStorage', v: Date.now() })
  })
}

/** IndexedDB 到底能不能用（迁移前问一句，免得白写一遍） */
export async function idbAvailable(): Promise<boolean> {
  try {
    await openDb()
    return true
  } catch {
    return false
  }
}
