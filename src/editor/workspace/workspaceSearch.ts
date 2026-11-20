import type { Editor } from '@tiptap/core'
import type { Doc } from '../documents'
import { findMatches, searchableDocument, snippetOf } from '../search'
import type { WorkspaceFile } from './documentWorkspace'

export const WORKSPACE_SEARCH_LIMIT = 100
const diskDocuments = new WeakMap<WorkspaceFile, Doc>()

export interface WorkspaceSearchResult {
  file: WorkspaceFile
  query: string
  index: number | null
  snippet: string
  formula?: boolean
}

function diskDocument(file: WorkspaceFile): Doc | undefined {
  if (!file.source) return
  let doc = diskDocuments.get(file)
  if (!doc) {
    doc = { id: file.path, title: file.handle.name, md: file.source.markdown, at: 0 }
    diskDocuments.set(file, doc)
  }
  return doc
}

export function searchWorkspace(editor: Editor, files: WorkspaceFile[], drafts: ReadonlyMap<string, Doc>, input: string) {
  const query = input.trim()
  const results: WorkspaceSearchResult[] = []
  if (!query) return { results, truncated: false }
  const term = query.normalize('NFKC').toLowerCase()
  for (const file of files) {
    const doc = drafts.get(file.path) ?? diskDocument(file)
    if (!doc) continue
    if ([file.path, doc.title].some((name) => name.normalize('NFKC').toLowerCase().includes(term))) {
      results.push({ file, query, index: null, snippet: doc.title })
    }
    const parsed = searchableDocument(editor, doc)
    const available = WORKSPACE_SEARCH_LIMIT + 1 - results.length
    if (parsed && available > 0) {
      for (const [index, match] of findMatches(parsed, query, available).entries()) {
        results.push({ file, query, index, snippet: snippetOf(match), formula: match.kind === 'formula' })
      }
    }
    if (results.length > WORKSPACE_SEARCH_LIMIT) return { results: results.slice(0, WORKSPACE_SEARCH_LIMIT), truncated: true }
  }
  return { results, truncated: false }
}
