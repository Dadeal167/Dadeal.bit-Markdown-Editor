import { useEffect, useState } from 'react'
import { useEscapeClose } from './useEscapeClose'

interface Props {
  open: boolean
  onClose(): void
  onConfirm(text: string, url: string): void
}

export default function LinkModal({ open, onClose, onConfirm }: Props) {
  useEscapeClose(open, onClose)

  const [text, setText] = useState('')
  const [url, setUrl] = useState('')

  useEffect(() => {
    if (!open) return
    setText('')
    setUrl('')
    const timer = window.setTimeout(
      () => document.querySelector<HTMLInputElement>('.zh-modal--link input')?.focus(),
      30,
    )
    return () => window.clearTimeout(timer)
  }, [open])

  if (!open) return null

  const valid = url.trim().length > 0

  const confirm = () => {
    onConfirm(text.trim() || '链接', url.trim())
    onClose()
  }

  return (
    <div className="zh-modal-mask" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="zh-modal zh-modal--link" role="dialog" aria-modal="true" aria-label="插入链接">
        <div className="zh-modal__head">
          <span>插入链接</span>
          <button type="button" className="zh-modal__close" onClick={onClose} aria-label="关闭">
            ✕
          </button>
        </div>
        <div className="zh-modal__body">
          <div className="zh-link-form">
            <input
              type="text"
              value={text}
              placeholder="输入链接文本"
              onChange={(e) => setText(e.target.value)}
            />
            <input
              type="url"
              value={url}
              placeholder="输入链接地址"
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && valid) confirm()
              }}
            />
          </div>
        </div>
        <div className="zh-modal__footer">
          <button type="button" className="zh-btn-plain" onClick={onClose}>
            取消
          </button>
          <button type="button" className="zh-btn-solid" disabled={!valid} onClick={confirm}>
            确认
          </button>
        </div>
      </div>
    </div>
  )
}
