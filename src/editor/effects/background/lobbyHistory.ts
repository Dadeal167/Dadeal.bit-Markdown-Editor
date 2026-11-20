import { openLobbyDatabase, readLobbyFiles, readLobbyMedia, type LobbyMediaSource } from './lobbyDatabase'
import { BUILT_IN_WALLPAPER_ID, BUILT_IN_WALLPAPER_NAME } from './lobbySettings'
import { lobbyMediaKind } from './media/mediaAssets'
import type { WallpaperSource } from './wallpaper/wallpaperScene'

export type LobbyHistorySource =
  | WallpaperSource
  | { kind: 'spine'; files: File[] | null; name: string }
  | (LobbyMediaSource & { kind: 'media'; name: string })
  | { kind: 'window'; name: string; nativeProjectId?: string }

export interface LobbyHistoryEntry {
  id: string
  name: string
  kind: 'spine' | 'image' | 'video' | 'window' | 'scene' | 'web'
  note: string
  bytes: number
  lastUsed: number
  nativeProjectId?: string
}

const metaPrefix = 'history:meta:'
const dataPrefix = 'history:source:'
const currentKey = 'history:current'
const migratedKey = 'history:migrated'

async function transaction<T>(mode: IDBTransactionMode,
  run: (store: IDBObjectStore, done: (value: T) => void, fail: (reason: unknown) => void) => void) {
  const db = await openLobbyDatabase()
  try {
    return await new Promise<T>((resolve, reject) => {
      let value: T
      const tx = db.transaction('files', mode)
      tx.oncomplete = () => resolve(value)
      tx.onabort = () => reject(tx.error ?? new Error('背景记录操作已中止。'))
      tx.onerror = () => reject(tx.error)
      const fail = (error: unknown) => { tx.abort(); reject(error) }
      try { run(tx.objectStore('files'), (next) => { value = next }, fail) }
      catch (error) { fail(error) }
    })
  } finally { db.close() }
}

const hash = async (buffer: ArrayBuffer) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', buffer))]
  .map((byte) => byte.toString(16).padStart(2, '0')).join('')

function displayName(id: string, name: string) {
  return id === BUILT_IN_WALLPAPER_ID ? BUILT_IN_WALLPAPER_NAME : name
}

async function sourceId(source: LobbyHistorySource) {
  if (source.kind === 'spine' && !source.files) return BUILT_IN_WALLPAPER_ID
  const encoder = new TextEncoder()
  if (source.kind === 'window') return source.nativeProjectId ? 'window:native:' + source.nativeProjectId
    : 'window:' + await hash(encoder.encode(source.name).buffer)
  const files = source.kind === 'scene' || source.kind === 'web' ? source.files
    : (source.kind === 'media' ? source.timeConfig ? [source.file, source.timeConfig] : [source.file] : source.files!)
      .map((file) => ({ path: file.name, file }))
  const identities: string[] = []
  // 分块读取大视频，只在内存中保留当前块和各块的摘要。
  for (const { path, file } of files) {
    const chunks: string[] = []
    const size = 4 * 1024 * 1024
    for (let offset = 0; offset < file.size; offset += size) chunks.push(await hash(await file.slice(offset, offset + size).arrayBuffer()))
    identities.push(JSON.stringify([path, file.size, chunks]))
  }
  return source.kind + ':' + await hash(encoder.encode(identities.sort().join('\n')).buffer)
}

export function listLobbyHistory(): Promise<LobbyHistoryEntry[]> {
  return transaction('readonly', (store, done) => {
    const request = store.getAll(IDBKeyRange.bound(metaPrefix, metaPrefix + '\uffff'))
    request.onsuccess = () => done((request.result as LobbyHistoryEntry[])
      .map((entry) => ({ ...entry, name: displayName(entry.id, entry.name) }))
      .sort((a, b) => b.lastUsed - a.lastUsed || a.name.localeCompare(b.name, 'zh')))
  })
}

export function readLobbyHistorySource(id: string): Promise<LobbyHistorySource> {
  return transaction<LobbyHistorySource | undefined>('readonly', (store, done) => {
    const source = store.get(dataPrefix + id)
    const entry = store.get(metaPrefix + id)
    entry.onsuccess = () => done(source.result
      ? { ...source.result, name: displayName(id, entry.result?.name ?? source.result.name) } : undefined)
  }).then((source) => {
    if (!source) throw new Error('该记录的背景资源已不可用。请重新导入。')
    return source
  })
}

export function readCurrentLobbyHistoryId(): Promise<string | undefined> {
  return transaction('readonly', (store, done) => {
    const request = store.get(currentKey)
    request.onsuccess = () => done(typeof request.result === 'string' ? request.result : undefined)
  })
}

function activate(store: IDBObjectStore, id: string, source: LobbyHistorySource) {
  if (source.kind === 'window') return
  if (source.kind === 'spine') {
    store.delete('media')
    if (source.files) store.put(source.files, 'active')
    else store.delete('active')
  } else if (source.kind === 'media') {
    const media: LobbyMediaSource = { file: source.file, name: source.name, timeConfig: source.timeConfig }
    store.put(media, 'media')
  }
  store.put(id, currentKey)
}

export async function rememberLobbyBackground(source: LobbyHistorySource, activateSource = true, knownId?: string) {
  const id = knownId ?? await sourceId(source)
  const files = source.kind === 'scene' || source.kind === 'web' ? source.files.map(({ file }) => file)
    : source.kind === 'media' ? source.timeConfig ? [source.file, source.timeConfig] : [source.file]
      : source.kind === 'spine' ? source.files ?? [] : []
  const kind = source.kind === 'media' ? lobbyMediaKind(source.file) : source.kind
  if (!kind) throw new Error('此背景文件的格式不受支持。')
  return transaction<LobbyHistoryEntry>('readwrite', (store, done, fail) => {
    const request = store.get(metaPrefix + id)
    request.onsuccess = () => {
      try {
        const previous = request.result as LobbyHistoryEntry | undefined
        const entry: LobbyHistoryEntry = {
          id, name: source.name, note: previous?.note ?? '', kind,
          bytes: files.reduce((total, file) => total + file.size, 0),
          lastUsed: Date.now(),
          ...(source.kind === 'window' && source.nativeProjectId ? { nativeProjectId: source.nativeProjectId } : {}),
        }
        store.put(entry, metaPrefix + id)
        if (!previous || !knownId) store.put(source, dataPrefix + id)
        if (activateSource) activate(store, id, source)
        done(entry)
      } catch (error) { fail(error) }
    }
  })
}

export function updateLobbyHistoryNote(id: string, note: string) {
  return transaction<boolean>('readwrite', (store, done, fail) => {
    const request = store.get(metaPrefix + id)
    request.onsuccess = () => {
      try {
        const entry = request.result as LobbyHistoryEntry | undefined
        if (entry) store.put({ ...entry, note: note.trim().slice(0, 1000) }, metaPrefix + id)
        done(Boolean(entry))
      } catch (error) { fail(error) }
    }
  })
}

export async function deleteLobbyHistory(id: string, activeId?: string) {
  await transaction('readwrite', (store, done, fail) => {
    const current = store.get(currentKey)
    current.onsuccess = () => {
      try {
        // 旧版的 active / media 是重复缓存；清除它们，避免记录被重新迁移。
        // 首次迁移尚无 current 时，保留另一条正在使用的背景作为恢复入口。
        if (current.result === id) store.delete(currentKey)
        else if (!current.result && activeId && activeId !== id) {
          const active = store.get(metaPrefix + activeId)
          active.onsuccess = () => {
            try {
              if (active.result && active.result.kind !== 'window') store.put(activeId, currentKey)
            } catch (error) { fail(error) }
          }
        }
        store.delete(metaPrefix + id)
        store.delete(dataPrefix + id)
        store.delete('active')
        store.delete('media')
        done(undefined)
      } catch (error) { fail(error) }
    }
  })
  try {
    localStorage.removeItem('md-editor-memory-lobby-layout-v1:history:' + id)
    localStorage.removeItem('md-editor-wallpaper-properties-v1:history:' + id)
    localStorage.removeItem('md-editor-wallpaper-time-v1:history:' + id)
  } catch { /* 缓存和记录已删除，外观设置不影响删除结果。 */ }
}

export async function migrateLobbyHistory() {
  const migrated = await transaction<boolean>('readonly', (store, done) => {
    const request = store.get(migratedKey)
    request.onsuccess = () => done(request.result === true)
  })
  if (migrated) return
  const [files, media] = await Promise.all([readLobbyFiles(), readLobbyMedia()])
  if (files?.length) await rememberLobbyBackground({ kind: 'spine', files, name: files.find((file) => /\.(skel|json)$/i.test(file.name))?.name ?? '已保存的 Spine 背景' }, false)
  if (media) await rememberLobbyBackground({ ...media, kind: 'media', name: media.name ?? media.file.name }, false)
  await transaction('readwrite', (store, done) => {
    store.put(true, migratedKey)
    done(undefined)
  })
}
