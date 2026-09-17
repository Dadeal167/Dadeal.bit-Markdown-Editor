/**
 * 用户自己安装的字体。
 *
 * 存哪儿：字体文件（几 MB）放 **IndexedDB**（localStorage 只有 5MB，装不下）；
 * 打开应用时把里面的字体重新注册成 FontFace，所以关掉再打开依然能用。
 * 已实测 file:// 双击版也支持 IndexedDB + FontFace。
 */

export interface CustomFont {
  id: string
  /** 显示名（默认取文件名） */
  name: string
  /** 注册到 CSS 时用的 family 名（带前缀，避免和系统字体重名） */
  family: string
  /** 字节数，界面上显示占用 */
  size: number
  at: number
}

interface StoredFont extends CustomFont {
  data: ArrayBuffer
}

const DB_NAME = 'md-editor-fonts'
const STORE = 'fonts'

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: 'id' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
    // 另一个标签页占着旧版本时不能一直挂着，否则界面会卡在"正在安装…"
    req.onblocked = () => reject(new Error('另一个标签页正在使用字体库，请关掉它再试'))
  })
}

function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        let result: T
        const t = db.transaction(STORE, mode)
        const req = run(t.objectStore(STORE))
        req.onsuccess = () => {
          result = req.result
        }
        // 以事务完成（而不是请求成功）为准：写入这时才真正落盘
        t.oncomplete = () => resolve(result)
        t.onerror = () => reject(t.error)
        t.onabort = () => reject(t.error ?? new Error('事务被中止'))
      }),
  )
}

/** 文件名 → 字体名（去掉扩展名，清理不合适字符） */
export function fontNameFromFile(fileName: string): string {
  return fileName.replace(/\.(ttf|otf|woff2?|TTF|OTF|WOFF2?)$/, '').trim().slice(0, 40) || '我的字体'
}

/** 注册进 document.fonts，这样 CSS 里就能用这个 family */
async function register(family: string, data: ArrayBuffer): Promise<void> {
  const face = new FontFace(family, data)
  await face.load()
  document.fonts.add(face)
}

const PREFIX = 'userfont-'

export async function loadCustomFonts(): Promise<CustomFont[]> {
  const all = await tx<StoredFont[]>('readonly', (s) => s.getAll() as IDBRequest<StoredFont[]>)
  const list: CustomFont[] = []
  for (const f of all) {
    try {
      await register(f.family, f.data)
    } catch {
      /* 某个字体坏了不影响其它 */
    }
    list.push({ id: f.id, name: f.name, family: f.family, size: f.size, at: f.at })
  }
  return list.sort((a, b) => b.at - a.at)
}

export async function addCustomFont(file: File): Promise<CustomFont> {
  const data = await file.arrayBuffer()
  const name = fontNameFromFile(file.name)
  const id = `f${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
  // 同一个名字重复安装时换一个 family，避免旧的缓存混进来
  const family = `${PREFIX}${id}`
  await register(family, data)
  const stored: StoredFont = { id, name, family, size: data.byteLength, at: Date.now(), data }
  await tx('readwrite', (s) => s.put(stored) as IDBRequest<IDBValidKey>)
  return { id, name, family, size: stored.size, at: stored.at }
}

export async function removeCustomFont(id: string): Promise<void> {
  await tx('readwrite', (s) => s.delete(id) as IDBRequest<undefined>)
  // 把注册过的 FontFace 也摘掉，否则它（连同整个字体二进制）会一直留在内存里
  for (const face of [...document.fonts]) {
    if (face.family.startsWith(PREFIX) && !(await stillExists(face.family))) {
      document.fonts.delete(face)
    }
  }
}

/** 这个 family 在库里还有对应的字体吗（删除单个字体时用） */
async function stillExists(family: string): Promise<boolean> {
  try {
    const all = await tx<StoredFont[]>('readonly', (s) => s.getAll() as IDBRequest<StoredFont[]>)
    return all.some((f) => f.family === family)
  } catch {
    return true // 查不到就别乱删
  }
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
