const dbName = 'md-editor-memory-lobby'

/** 保存用户导入的原文件。内置壁纸不占浏览器存储。 */
export function openLobbyDatabase(): Promise<IDBDatabase> {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(dbName, 1)
    request.onupgradeneeded = () => request.result.createObjectStore('files')
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function readLegacyBackground(key: 'active' | 'media') {
  const db = await openLobbyDatabase()
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('files', 'readonly')
      const request = tx.objectStore('files').get(key)
      tx.oncomplete = () => resolve(request.result)
      tx.onabort = () => reject(tx.error)
      tx.onerror = () => reject(tx.error)
    })
  } finally {
    db.close()
  }
}

export const readLobbyFiles = (): Promise<File[] | null> =>
  readLegacyBackground('active').then((files) => Array.isArray(files) ? files : null)

export interface LobbyMediaSource {
  file: File
  name?: string
  timeConfig?: File
}

export const readLobbyMedia = (): Promise<LobbyMediaSource | null> =>
  readLegacyBackground('media').then((value) => {
    if (value instanceof File) return { file: value }
    if (!value || typeof value !== 'object') return null
    const { file, name, timeConfig } = value as Partial<LobbyMediaSource>
    if (file instanceof File) return { file, name: typeof name === 'string' ? name : undefined,
      timeConfig: timeConfig instanceof File ? timeConfig : undefined }
    return null
  })
