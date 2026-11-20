import { useState } from 'react'
import type { WritingPreset } from './writingPresets'

interface Props {
  presets: WritingPreset[]
  bound?: string
  canBind: boolean
  canSave: boolean
  busy: boolean
  message: string
  onSave(name: string): void
  onApply(preset: WritingPreset): void
  onBind(id: string): void
  onDelete(id: string): void
}

export default function WritingPresetPanel({ presets, bound, canBind, canSave, busy, message,
  onSave, onApply, onBind, onDelete }: Props) {
  const [name, setName] = useState('')
  const [confirmDelete, setConfirmDelete] = useState<string>()
  const current = presets.find((preset) => preset.id === bound)
  return <details className="zh-lobby-history">
    <summary>写作场景预设{current && <span>本文档 · {current.name}</span>}</summary>
    {message && <p className="zh-fx__hint" role="status">{message}</p>}
    <form className="zh-lobby-preset__form" onSubmit={(event) => {
      event.preventDefault()
      if (!canSave || busy || !name.trim()) return
      onSave(name.trim())
      setName('')
    }}>
      <input aria-label="预设名称" placeholder="例如夜间阅读" maxLength={48} value={name} onChange={(event) => setName(event.target.value)} />
      <button className="zh-fx__pick" type="submit" disabled={busy || !canSave || !name.trim()}>保存当前场景</button>
    </form>
    {!canSave && <p className="zh-fx__hint">可重开的背景加载完成后即可保存。临时共享窗口需重新选择。</p>}
    <ul className="zh-lobby-history__list" aria-label="写作场景">
      {presets.map((preset) => <li className="zh-lobby-history__item" key={preset.id}>
        <strong>{preset.name}</strong>
        <div className="zh-fx__lobby-actions">
          <button className="zh-fx__pick" type="button" disabled={busy} onClick={() => onApply(preset)}
            aria-label={`应用「${preset.name}」`}>应用</button>
          {canBind && <button className="zh-fx__pick" type="button" disabled={busy} onClick={() => onBind(preset.id)}
            aria-label={`${bound === preset.id ? '解除「' : '绑定「'}${preset.name}」${bound === preset.id ? '与本文档的关联' : '到本文档'}`}>
            {bound === preset.id ? '解除绑定' : '绑定本文档'}
          </button>}
          {confirmDelete === preset.id ? <>
            <button className="zh-fx__pick" type="button" onClick={() => { onDelete(preset.id); setConfirmDelete(undefined) }}>确认删除预设</button>
            <button className="zh-fx__pick" type="button" onClick={() => setConfirmDelete(undefined)}>取消</button>
          </> : <button className="zh-fx__pick" type="button" disabled={busy} onClick={() => setConfirmDelete(preset.id)}
            aria-label={`删除预设「${preset.name}」`}>删除</button>}
        </div>
      </li>)}
    </ul>
  </details>
}
