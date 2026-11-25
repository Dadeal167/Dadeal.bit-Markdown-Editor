import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Editor } from '@tiptap/core'
import { history } from '@tiptap/pm/history'
import { Selection } from '@tiptap/pm/state'
import type { Doc } from './documents'

const SESSION_KEY = 'dadealbit-document-tabs'
const historyKey = history().spec.key

function readTabs(): string[] {
  try {
    const stored: unknown = JSON.parse(sessionStorage.getItem(SESSION_KEY) ?? '[]')
    return Array.isArray(stored) ? [...new Set(stored.filter((id): id is string => typeof id === 'string'))] : []
  } catch { return [] }
}

interface DocumentView {
  top: number
  selection: ReturnType<Selection['toJSON']>
}

export function useDocumentTabs(enabled: boolean, docs: Doc[], currentId: string) {
  const [openIds, setOpenIds] = useState(() => enabled ? readTabs() : [])
  const views = useRef(new Map<string, DocumentView>())
  const ids = useMemo(() => {
    if (!enabled) return []
    const available = new Set(docs.filter((doc) => !doc.trashedAt).map((doc) => doc.id))
    const visible = openIds.filter((id) => available.has(id))
    return visible.includes(currentId) ? visible : [...visible, currentId]
  }, [currentId, docs, enabled, openIds])
  const sessionTabs = JSON.stringify(ids)

  useEffect(() => {
    if (!enabled) return
    setOpenIds((open) => open.includes(currentId) ? open : [...open, currentId])
  }, [currentId, enabled])
  useEffect(() => {
    if (!enabled) return
    try { sessionStorage.setItem(SESSION_KEY, sessionTabs) } catch { /* Tabs remain available in this page. */ }
  }, [enabled, sessionTabs])

  const capture = useCallback((id: string, editor: Editor | null) => {
    if (!enabled || !editor?.isInitialized || editor.isDestroyed) return
    views.current.set(id, { top: window.scrollY, selection: editor.state.selection.toJSON() })
  }, [enabled])

  const restore = useCallback((id: string, editor: Editor) => {
    if (!enabled || editor.isDestroyed) return
    const { state } = editor
    const undo = historyKey?.get(state)
    if (undo) {
      // Reset the history plugin at the document boundary so undo cannot restore another document.
      editor.view.updateState(state.reconfigure({ plugins: state.plugins.filter((plugin) => plugin !== undo) })
        .reconfigure({ plugins: state.plugins }))
    }
    const view = views.current.get(id)
    if (view && editor.isInitialized) {
      let selection: Selection
      try { selection = Selection.fromJSON(editor.state.doc, view.selection) }
      catch { selection = Selection.atStart(editor.state.doc) }
      editor.view.dispatch(editor.state.tr.setSelection(selection))
    }
    window.scrollTo({ top: view?.top ?? 0, behavior: 'instant' })
  }, [enabled])

  const close = useCallback((id: string) => {
    setOpenIds((open) => open.filter((item) => item !== id))
  }, [])

  return { ids, capture, restore, close }
}
