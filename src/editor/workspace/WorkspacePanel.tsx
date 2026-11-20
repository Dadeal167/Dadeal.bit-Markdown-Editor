import { useDeferredValue, useMemo, useState } from 'react'
import type { Editor } from '@tiptap/core'
import type { Doc } from '../documents'
import { searchWorkspace, WORKSPACE_SEARCH_LIMIT, type WorkspaceSearchResult } from './workspaceSearch'
import { previewWorkspaceRename, type WorkspaceFile, type WorkspaceRename } from './documentWorkspace'
import { useEscapeClose } from '../useEscapeClose'

interface FileTree {
  folders: Map<string, FileTree>
  files: WorkspaceFile[]
}
const branch = (): FileTree => ({ folders: new Map(), files: [] })

function fileTree(files: WorkspaceFile[]) {
  const tree = branch()
  for (const file of files) {
    let current = tree
    for (const name of file.path.split('/').slice(0, -1)) {
      let folder = current.folders.get(name)
      if (!folder) { folder = branch(); current.folders.set(name, folder) }
      current = folder
    }
    current.files.push(file)
  }
  return tree
}

function DirectoryBranch({ tree, active, onOpen }: { tree: FileTree; active?: string; onOpen(file: WorkspaceFile): void }) {
  return <ul className="zh-workspace__tree">
    {[...tree.folders].map(([name, folder]) => <li key={name}>
      <details open={true}><summary>{name}</summary><DirectoryBranch tree={folder} active={active} onOpen={onOpen} /></details>
    </li>)}
    {tree.files.map((file) => <li key={file.path}>
      <button type="button" className="zh-btn-plain" aria-current={file.path === active ? 'page' : undefined}
        disabled={!file.source} title={file.path} onClick={() => onOpen(file)}>{file.handle.name}</button>
    </li>)}
  </ul>
}

interface Props {
  name: string
  files: WorkspaceFile[]
  active?: WorkspaceFile
  status: 'ready' | 'loading' | 'permission' | 'error'
  backlinks: { file: WorkspaceFile; count: number }[]
  editor: Editor | null
  drafts: ReadonlyMap<string, Doc>
  onOpenResult(result: WorkspaceSearchResult): void
  onOpen(file: WorkspaceFile): void
  onChoose(): void
  onReconnect(): void
  onRefresh(): void
  onClose(): void
  onRename(file: WorkspaceFile): void
  autoAssets: boolean
  onAutoAssets(enabled: boolean): void
}

export default function WorkspacePanel({ name, files, active, status, backlinks, editor, drafts, onOpenResult, onOpen, onChoose, onReconnect,
  onRefresh, onClose, onRename, autoAssets, onAutoAssets }: Props) {
  const tree = useMemo(() => fileTree(files), [files])
  const [query, setQuery] = useState('')
  const term = useDeferredValue(query.trim())
  const search = useMemo(() => status === 'ready' && editor && term ? searchWorkspace(editor, files, drafts, term) : undefined,
    [status, editor, files, drafts, term])
  return <aside className="zh-workspace" aria-label="本地工作区">
    <div className="zh-workspace__heading"><strong title={name}>{name}</strong>
      <button type="button" className="zh-btn-plain" aria-label="隐藏工作区" onClick={onClose}>✕</button></div>
    <div className="zh-workspace__actions">
      <button type="button" className="zh-btn-plain" onClick={onChoose}>选择文件夹</button>
      {status === 'permission' ? <button type="button" className="zh-btn-plain" onClick={onReconnect}>重新连接</button>
        : <button type="button" className="zh-btn-plain" onClick={onRefresh} disabled={status === 'loading'}>刷新</button>}
    </div>
    {status === 'ready' && !!files.length && <input type="search" className="zh-workspace__search"
      aria-label="搜索工作区" placeholder="搜索标题、正文或公式" value={query} onChange={(event) => setQuery(event.target.value)} />}
    {status === 'permission' ? <p>需要重新授权以访问此文件夹。</p> : status === 'error' ? <p role="alert">无法读取工作区。</p>
      : status === 'loading' ? <p role="status">正在读取文档…</p> : query.trim() ? <>
        <p role="status">{query.trim() !== term ? '正在检索…' : search?.truncated ? `显示前 ${WORKSPACE_SEARCH_LIMIT} 条结果`
          : search?.results.length ? `${search.results.length} 条结果` : '没有匹配的文档。'}</p>
        {query.trim() === term && search && <ul className="zh-workspace__tree" aria-label="工作区搜索结果">
          {search.results.map((result) => <li key={result.file.path + ':' + result.index}>
            <button className="zh-btn-plain zh-workspace__match" type="button" onClick={() => onOpenResult(result)}>
              <strong>{result.file.path}</strong>
              <small>{result.index === null ? '文件名 · ' : result.formula ? '公式 · ' : ''}{result.snippet}</small>
            </button>
          </li>)}
        </ul>}
      </> : files.length
        ? <nav aria-label="工作区文件"><DirectoryBranch tree={tree} active={active?.path} onOpen={onOpen} /></nav>
        : <p>此文件夹中没有 Markdown 文档。</p>}
    {status === 'ready' && active && <>
      <hr />
      <div className="zh-workspace__actions">
        <button type="button" className="zh-btn-plain" onClick={() => onRename(active)}>重命名当前文件</button>
      </div>
      <h3>反向链接</h3>
      {backlinks.length ? <ul className="zh-workspace__tree">{backlinks.map(({ file, count }) =>
        <li key={file.path}><button type="button" className="zh-btn-plain" title={file.path} onClick={() => onOpen(file)}>
          {file.path} <small>（{count}）</small>
        </button></li>)}</ul> : <p>暂无反向链接。</p>}
    </>}
    <label className="zh-workspace__option"><input type="checkbox" checked={autoAssets}
      onChange={(event) => onAutoAssets(event.target.checked)} />粘贴图片时保存到 assets</label>
  </aside>
}

export function WorkspaceRenameModal({ files, file, onClose, onCommit }: {
  files: WorkspaceFile[]
  file: WorkspaceFile
  onClose(): void
  onCommit(plan: WorkspaceRename): Promise<void>
}) {
  const [name, setName] = useState(file.handle.name)
  const [plan, setPlan] = useState<WorkspaceRename>()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEscapeClose(!busy, onClose)
  const preview = () => {
    try { setPlan(previewWorkspaceRename(files, file, name)); setError('') }
    catch (error) { setError(error instanceof Error ? error.message : '无法生成重命名预览。') }
  }
  const commit = async () => {
    if (!plan || busy) return
    setBusy(true)
    setError('')
    try { await onCommit(plan) }
    catch (error) { setError(error instanceof Error ? error.message : '重命名失败。'); setBusy(false) }
  }
  return <div className="zh-modal-mask">
    <form className="zh-modal" role="dialog" aria-modal="true" aria-label="重命名工作区文档" onSubmit={(event) => {
      event.preventDefault()
      if (!plan) preview()
    }}>
      <div className="zh-modal__head">重命名工作区文档
        <button type="button" className="zh-modal__close" disabled={busy} onClick={onClose} aria-label="关闭重命名">✕</button>
      </div>
      <div className="zh-modal__body zh-publication">
        <p>{file.path}</p>
        <label>新文件名<input autoFocus value={name} disabled={busy} onChange={(event) => {
          setName(event.target.value); setPlan(undefined); setError('')
        }} /></label>
        {plan && <div className="zh-workspace__rename-preview">
          <p>新路径 <strong>{plan.path}</strong></p>
          <p>将更新 {plan.edits.length} 个文件中的 {plan.edits.reduce((sum, edit) => sum + edit.changes.length, 0)} 处文件引用。</p>
          {plan.edits.map(({ file, changes }) => <details key={file.path} open={true}>
            <summary>{file.path}（{changes.length}）</summary>
            {changes.map(({ at, raw, replacement }) => <pre key={at}><span data-change="removed">− {raw}</span>{'\n'}
              <span data-change="added">+ {replacement}</span></pre>)}
          </details>)}
        </div>}
        {error && <p role="alert">{error}</p>}
      </div>
      <div className="zh-modal__footer">
        <button type="button" className="zh-btn-plain" disabled={busy} onClick={onClose}>取消</button>
        {plan ? <button type="button" className="zh-btn-solid" disabled={busy} onClick={() => void commit()}>
          {busy ? '正在重命名…' : '确认重命名并更新引用'}
        </button> : <button type="submit" className="zh-btn-solid">预览重命名</button>}
      </div>
    </form>
  </div>
}
