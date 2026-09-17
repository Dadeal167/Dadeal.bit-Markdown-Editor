import { useCallback, useEffect, useMemo, useState } from 'react'
import { useEscapeClose } from './useEscapeClose'
import {
  SHORTCUT_ACTIONS,
  SHORTCUT_GROUPS,
  displayKey,
  normalizeEvent,
  saveBindings,
  shortcuts,
  type Bindings,
} from './shortcuts'

interface Props {
  open: boolean
  onClose(): void
}

export default function ShortcutModal({ open, onClose }: Props) {
  const [bindings, setBindings] = useState<Bindings>(() => shortcuts.bindings())
  const [recording, setRecording] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)

  // 每次打开都同步一次（可能被别处改过）
  useEffect(() => {
    if (open) {
      setBindings(shortcuts.bindings())
      setRecording(null)
      setNote(null)
    }
  }, [open])

  const commit = useCallback((next: Bindings) => {
    setBindings(next)
    shortcuts.applyBindings(next)
  }, [])

  // 录制中 Esc 由录制逻辑处理（取消录制），其余时候 Esc 关闭面板
  useEscapeClose(open && !recording, onClose)

  /** 录制中：在捕获阶段吃掉键盘事件，别让它触发别的快捷键或输入 */
  useEffect(() => {
    if (!open || !recording) return
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (e.key === 'Escape') {
        setRecording(null)
        setNote('已取消')
        return
      }
      const key = normalizeEvent(e)
      if (!key) {
        setNote('这个键不能单独用作快捷键，请加上 Ctrl 或 Alt（F1–F12 可以直接用）')
        return
      }
      const next = { ...bindings }
      // 冲突处理：同一个键不能绑两个动作，后设的赢
      const conflict = SHORTCUT_ACTIONS.find((a) => a.id !== recording && next[a.id] === key)
      if (conflict) {
        next[conflict.id] = null
        setNote(`「${key}」原本绑在「${conflict.label}」上，已把它改为未绑定`)
      } else {
        setNote(null)
      }
      next[recording] = key
      commit(next)
      setRecording(null)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open, recording, bindings, commit])

  const groups = useMemo(
    () => SHORTCUT_GROUPS.map((g) => ({ group: g, actions: SHORTCUT_ACTIONS.filter((a) => a.group === g) })),
    [],
  )

  if (!open) return null

  return (
    <div className="zh-modal-mask" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="zh-modal zh-modal--shortcuts" role="dialog" aria-modal="true" aria-label="快捷键设置">
        <div className="zh-modal__head">
          <span className="zh-modal__title">快捷键设置</span>
          <button type="button" className="zh-mathclose" onClick={onClose} aria-label="关闭">
            ✕
          </button>
        </div>

        <div className="zh-scbody">
          <p className="zh-schint">
            点右边的按键按钮，然后直接按下想用的组合键即可改键。至少要带 <b>Ctrl</b> 或 <b>Alt</b>
            （F1–F12 可单独用），<b>Esc</b> 取消录制。
          </p>

          {groups.map(({ group, actions }) => (
            <div className="zh-scgroup" key={group}>
              <div className="zh-scgroup__title">{group}</div>
              {actions.map((a) => {
                const key = bindings[a.id]
                const isRecording = recording === a.id
                return (
                  <div className="zh-scrow" key={a.id}>
                    <span className="zh-scrow__label">{a.label}</span>
                    <button
                      type="button"
                      className={`zh-sckey${isRecording ? ' zh-sckey--recording' : ''}${key ? '' : ' zh-sckey--empty'}`}
                      onClick={() => {
                        setRecording(isRecording ? null : a.id)
                        setNote(null)
                      }}
                    >
                      {isRecording ? '按下新键…' : displayKey(key)}
                    </button>
                    <button
                      type="button"
                      className="zh-scrow__clear"
                      title="清除这个快捷键"
                      onClick={() => {
                        const next = { ...bindings, [a.id]: null }
                        commit(next)
                        setRecording(null)
                      }}
                    >
                      清除
                    </button>
                    <button
                      type="button"
                      className="zh-scrow__reset"
                      title="恢复这一项的默认键"
                      onClick={() => {
                        const next = { ...bindings, [a.id]: a.def }
                        commit(next)
                        setRecording(null)
                      }}
                    >
                      默认
                    </button>
                  </div>
                )
              })}
            </div>
          ))}
        </div>

        <div className="zh-scfoot">
          <span className={`zh-scnote${note ? ' zh-scnote--on' : ''}`}>{note ?? ''}</span>
          <button
            type="button"
            className="zh-btn-plain"
            onClick={() => {
              shortcuts.reset()
              setBindings(shortcuts.bindings())
              setRecording(null)
              setNote('已全部恢复默认')
            }}
          >
            全部恢复默认
          </button>
          <button type="button" className="zh-btn-solid zh-btn-confirm" onClick={onClose}>
            完成
          </button>
        </div>
      </div>
    </div>
  )
}

export { saveBindings }
