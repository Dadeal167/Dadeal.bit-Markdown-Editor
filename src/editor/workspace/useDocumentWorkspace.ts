import { useCallback, useEffect, useRef, useState } from 'react'
import { loadWorkspace, storeWorkspace } from '../docStore'
import { scanWorkspace, type WorkspaceFile } from './documentWorkspace'
import { localFilePickers, type LocalDirectoryHandle } from '../localMarkdownFile'

export function useDocumentWorkspace(enabled: boolean, flash: (message: string) => void) {
  const [root, setRoot] = useState<LocalDirectoryHandle>()
  const [files, setFiles] = useState<WorkspaceFile[]>([])
  const [visible, setVisible] = useState(false)
  const [status, setStatus] = useState<'loading' | 'ready' | 'permission' | 'error'>('loading')
  const generation = useRef(0)
  const refresh = useCallback(async (directory: LocalDirectoryHandle) => {
    const token = ++generation.current
    setStatus('loading')
    try {
      const access = await directory.queryPermission?.({ mode: 'read' })
      if (token !== generation.current) return
      if (access && access !== 'granted') { setStatus('permission'); return }
      const entries = await scanWorkspace(directory)
      if (token === generation.current) { setFiles(entries); setStatus('ready') }
    } catch (error) {
      if (token !== generation.current) return
      setStatus(error instanceof DOMException && error.name === 'NotAllowedError' ? 'permission' : 'error')
    }
  }, [])
  useEffect(() => {
    if (!enabled) return
    const started = generation.current
    let active = true
    void loadWorkspace().then((directory) => {
      if (!active || !directory || started !== generation.current) return
      setRoot(directory)
      setVisible(true)
      void refresh(directory)
    }).catch(() => {})
    return () => { active = false; generation.current++ }
  }, [enabled, refresh])

  const choose = useCallback(() => {
    const picker = localFilePickers()
    void picker.showDirectoryPicker?.({ mode: 'readwrite' }).then((directory) => {
      setRoot(directory)
      setFiles([])
      setVisible(true)
      void refresh(directory)
      void storeWorkspace(directory).catch(() => flash('工作区关联仅保留在本次会话中。'))
    }).catch((error: unknown) => {
      if (!(error instanceof DOMException && error.name === 'AbortError')) flash('无法打开工作区。')
    })
  }, [flash, refresh])

  const reconnect = useCallback(() => {
    if (!root) return
    void (async () => {
      if (root.requestPermission && await root.requestPermission({ mode: 'read' }) !== 'granted') return
      await refresh(root)
    })().catch(() => flash('无法重新连接工作区。'))
  }, [flash, refresh, root])
  return { root, files, visible, setVisible, status, choose, reconnect, refresh }
}
