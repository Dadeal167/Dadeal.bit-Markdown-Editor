import { useState } from 'react'
import type { LobbyHistoryEntry } from './lobbyHistory'
import { formatSize } from '../../customFonts'

interface Props {
  entries: LobbyHistoryEntry[]
  activeId?: string
  busy: boolean
  error: string
  onUse(entry: LobbyHistoryEntry): void
  onNote(id: string, note: string): Promise<void>
  onDelete(id: string): Promise<void>
}

const names = { spine: 'Spine', image: '图片', video: '视频', window: '窗口共享', scene: '场景壁纸', web: 'Live2D 网页' }

export default function LobbyHistoryList({ entries, activeId, busy, error, onUse, onNote, onDelete }: Props) {
  const [filter, setFilter] = useState('')
  const [editing, setEditing] = useState<string>()
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState<string>()
  const [removing, setRemoving] = useState(false)
  const [failure, setFailure] = useState('')
  const working = busy || saving || removing
  const matching = entries.filter((entry) => (entry.name + '\n' + entry.note).toLocaleLowerCase().includes(filter.trim().toLocaleLowerCase()))
  const save = async (id: string) => {
    setSaving(true)
    setFailure('')
    try { await onNote(id, note); setEditing(undefined) }
    catch { setFailure('备注保存失败，请重试。') }
    finally { setSaving(false) }
  }
  const remove = async (id: string) => {
    setRemoving(true)
    setFailure('')
    try { await onDelete(id); setDeleting(undefined); setEditing(undefined) }
    catch { setFailure('记录删除失败，请重试。') }
    finally { setRemoving(false) }
  }
  return <details className="zh-lobby-history" open>
    <summary>使用记录 <span>{entries.length}</span></summary>
    <div className="zh-fx__hint">记录保存在当前浏览器，可直接点击切换背景。</div>
    {entries.length > 0 && <input type="search" className="zh-lobby-history__search" aria-label="搜索背景记录"
      placeholder="搜索名称或备注" value={filter} onChange={(event) => setFilter(event.target.value)} />}
    {(error || failure) && <p className="zh-fx__hint" role="alert">{failure || error}</p>}
    <ul className="zh-lobby-history__list" aria-label="背景使用记录">
      {matching.map((entry) => <li key={entry.id} className="zh-lobby-history__item">
        <div className="zh-lobby-history__row">
          <button type="button" className="zh-lobby-history__use" aria-label={'使用「' + entry.name + '」'}
            aria-pressed={entry.id === activeId} disabled={working} onClick={() => onUse(entry)}>
            <strong>{entry.name}</strong>
            <span>{entry.nativeProjectId ? 'Wallpaper Engine 原生播放' : names[entry.kind]}{entry.bytes > 0 ? ' · ' + formatSize(entry.bytes) : ''}{entry.id === activeId ? ' · 当前背景' : ''}</span>
            {entry.note && <span className="zh-lobby-history__note">{entry.note}</span>}
          </button>
          <div className="zh-lobby-history__actions">
            <button type="button" className="zh-fx__pick" disabled={working} aria-label={'编辑「' + entry.name + '」的备注'}
              onClick={() => { setDeleting(undefined); setEditing(entry.id); setNote(entry.note); setFailure('') }}>备注</button>
            <button type="button" className="zh-fx__pick" disabled={working} aria-label={'删除「' + entry.name + '」的记录'}
              onClick={() => { setEditing(undefined); setDeleting(entry.id); setFailure('') }}>删除</button>
          </div>
        </div>
        {entry.kind === 'window' && !entry.nativeProjectId && <div className="zh-fx__hint">使用时需重新选择共享窗口。</div>}
        {deleting === entry.id && <div className="zh-lobby-history__confirm" role="group" aria-label="删除背景记录">
          <p className="zh-fx__hint">删除此记录及其浏览器缓存？本机原文件不受影响。
            {entry.id === activeId && '当前背景仅在本次会话中保留。'}</p>
          <div className="zh-fx__lobby-actions">
            <button type="button" className="zh-fx__pick" disabled={working} onClick={() => void remove(entry.id)}>
              {removing ? '正在删除…' : '确认删除'}</button>
            <button type="button" className="zh-fx__pick" disabled={working} onClick={() => { setDeleting(undefined); setFailure('') }}>取消</button>
          </div>
        </div>}
        {editing === entry.id && <form className="zh-lobby-history__edit" onSubmit={(event) => {
          event.preventDefault()
          if (!working) void save(entry.id)
        }}>
          <textarea autoFocus maxLength={1000} aria-label="背景备注" rows={3} value={note} disabled={working}
            onChange={(event) => setNote(event.target.value)} />
          <div className="zh-fx__lobby-actions">
            <button type="submit" className="zh-fx__pick" disabled={working}>{saving ? '正在保存…' : '保存备注'}</button>
            <button type="button" className="zh-fx__pick" disabled={working} onClick={() => { setEditing(undefined); setFailure('') }}>取消</button>
          </div>
        </form>}
      </li>)}
    </ul>
    {!matching.length && <p className="zh-fx__hint">{entries.length ? '没有匹配的记录。' : '成功使用背景后，会自动加入记录。'}</p>}
  </details>
}
