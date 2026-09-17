import { useEffect, useState } from 'react'
import { explainVideoInput } from './editorActions'
import { useEscapeClose } from './useEscapeClose'

interface Props {
  open: boolean
  onClose(): void
  onConfirm(url: string): void
}

export default function VideoModal({ open, onClose, onConfirm }: Props) {
  useEscapeClose(open, onClose)

  const [url, setUrl] = useState('')

  useEffect(() => {
    if (!open) return
    setUrl('')
    const timer = window.setTimeout(
      () => document.querySelector<HTMLInputElement>('.zh-modal--video input')?.focus(),
      30,
    )
    return () => window.clearTimeout(timer)
  }, [open])

  if (!open) return null

  const parsed = explainVideoInput(url)
  const valid = parsed.ok
  // 认不出时给"能照做"的提示（短链要联网才能跳转，所以只能教用户去复制完整链接）
  const hint = !url
    ? '例如：https://www.bilibili.com/video/BV1xx411c7mD'
    : parsed.ok
      ? ''
      : parsed.hint

  return (
    <div className="zh-modal-mask" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="zh-modal zh-modal--video" role="dialog" aria-modal="true" aria-label="插入视频">
        <div className="zh-modal__head">
          <span>插入视频</span>
          <button type="button" className="zh-modal__close" onClick={onClose} aria-label="关闭">
            ✕
          </button>
        </div>
        <div className="zh-modal__body">
          <div className="zh-link-form">
            <input
              type="url"
              value={url}
              placeholder="粘贴 B 站或 YouTube 视频链接"
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && valid) {
                  onConfirm(url.trim())
                  onClose()
                }
              }}
            />
          </div>
          <div className="zh-link-form__hint">{hint}</div>
        </div>
        <div className="zh-modal__footer">
          <button type="button" className="zh-btn-plain" onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className="zh-btn-solid"
            disabled={!valid}
            onClick={() => {
              onConfirm(url.trim())
              onClose()
            }}
          >
            插入
          </button>
        </div>
      </div>
    </div>
  )
}
