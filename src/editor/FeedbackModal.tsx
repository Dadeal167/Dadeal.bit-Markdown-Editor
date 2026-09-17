import { useState } from 'react'
import { useEscapeClose } from './useEscapeClose'
import {
  FEEDBACK_MAIL,
  FEEDBACK_SUBJECT,
  WEBMAIL_LINKS,
  feedbackBody,
  feedbackMailto,
} from './usageTime'

interface Props {
  open: boolean
  onClose(): void
  /** 当前文档字数（状态栏那个数） */
  wordCount: number
  /** 本次使用时长（毫秒） */
  sessionMs: number
  /** 累计使用时长（毫秒） */
  totalMs: number
}

type CopyState = 'idle' | 'done' | 'fail'

/**
 * 「更多 → 使用反馈」：把统计信息填好，复制走就能发邮件。
 *
 * **为什么把"复制"当主按钮，而不是"用邮件发送"**：
 * 那个按钮是个 `mailto:` 链接，实测有三个坑，全都表现为"点了没反应"：
 *   1. 电脑没装 / 没配默认邮件客户端 → 浏览器什么都不做（最常见）
 *   2. 用 Gmail / QQ 邮箱网页版的人，mailto 拉起的是系统邮件程序，不是他平时写信的地方
 *   3. Windows 对 mailto 长度有限制（约 2048 字符），超了会静默失败
 * 所以主路径改成：**一键复制收件人 + 标题 + 正文**，然后下面给几个常用邮箱的网页版入口，
 * 粘进去就能发。`mailto` 留成次选，并写明"没反应就用上面那个"。
 */
export default function FeedbackModal({ open, onClose, wordCount, sessionMs, totalMs }: Props) {
  const [copied, setCopied] = useState<CopyState>('idle')
  const [mailCopied, setMailCopied] = useState(false)
  useEscapeClose(open, onClose)
  if (!open) return null

  const stats = { wordCount, sessionMs, totalMs }
  const body = feedbackBody(stats)
  const mailto = feedbackMailto(stats)

  const copyText = async (text: string, onDone: (ok: boolean) => void) => {
    try {
      await navigator.clipboard.writeText(text)
      onDone(true)
    } catch {
      /* 没有剪贴板权限（http 打开、或用户禁止）→ 退回选中文本让用户自己按 Ctrl+C */
      try {
        const ta = document.createElement('textarea')
        ta.value = text
        ta.style.position = 'fixed'
        ta.style.opacity = '0'
        document.body.appendChild(ta)
        ta.select()
        const ok = document.execCommand('copy')
        document.body.removeChild(ta)
        onDone(ok)
      } catch {
        onDone(false)
      }
    }
  }

  const copyAll = () =>
    copyText(body, (ok) => {
      setCopied(ok ? 'done' : 'fail')
      window.setTimeout(() => setCopied('idle'), 3000)
    })

  const copyMail = () =>
    copyText(FEEDBACK_MAIL, (ok) => {
      setMailCopied(ok)
      window.setTimeout(() => setMailCopied(false), 2500)
    })

  return (
    <div className="zh-modal-mask" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="zh-modal zh-modal--feedback" role="dialog" aria-modal="true" aria-label="使用反馈">
        <div className="zh-modal__head">
          <span>
            使用反馈
            <span className="zh-modal__sub">发到 {FEEDBACK_MAIL}</span>
          </span>
          <button type="button" className="zh-modal__close" onClick={onClose} aria-label="关闭">
            ✕
          </button>
        </div>
        <div className="zh-modal__body">
          <div className="zh-zhihu__msg">
            遇到问题、或者想要什么功能，都欢迎告诉我。
            <br />
            下面这段是<b>反馈的正文</b>（已经带上字数和使用时长），点第 1 步那个按钮复制走，
            粘到你平时用的邮箱里发出去就行。
            <br />
            <b>不会带上你的文档内容</b>，只有字数和使用时长这几个数字。
          </div>

          <div className="zh-feedback__todo">
            <div className="zh-feedback__step">
              <span className="zh-feedback__num">1</span>
              <span>
                复制正文 →
                <button type="button" className="zh-btn-solid zh-feedback__copyall" onClick={copyAll}>
                  {copied === 'done' ? '已复制 ✅ 去邮箱粘贴' : copied === 'fail' ? '复制失败，请手动全选' : '复制反馈内容'}
                </button>
              </span>
            </div>
            <div className="zh-feedback__step">
              <span className="zh-feedback__num">2</span>
              <span>
                打开你常用的邮箱写信：
                {WEBMAIL_LINKS.map((l) => (
                  <a key={l.label} className="zh-feedback__maillink" href={l.url} target="_blank" rel="noreferrer">
                    {l.label}
                  </a>
                ))}
              </span>
            </div>
            <div className="zh-feedback__step">
              <span className="zh-feedback__num">3</span>
              <span>
                收件人填{' '}
                <button type="button" className="zh-feedback__addr" onClick={copyMail} title="点一下复制邮箱地址">
                  {FEEDBACK_MAIL}
                  <span className="zh-feedback__addrcopy">{mailCopied ? '已复制' : '复制'}</span>
                </button>
                ，标题填「{FEEDBACK_SUBJECT}」
              </span>
            </div>
          </div>

          <textarea className="zh-feedback__body" readOnly rows={9} value={body} aria-label="反馈邮件内容" />

          <div className="zh-feedback__alt">
            装过邮件客户端的话，也可以直接
            <a className="zh-feedback__mailto" href={mailto} onClick={onClose}>
              用系统邮件发送
            </a>
            （点了没反应就是没配邮件客户端，用上面那三步即可）
          </div>
        </div>
        <div className="zh-modal__footer">
          <button type="button" className="zh-btn-plain" onClick={onClose}>
            关闭
          </button>
          <button type="button" className="zh-btn-solid" onClick={copyAll}>
            {copied === 'done' ? '已复制 ✅' : copied === 'fail' ? '复制失败，请手动全选' : '复制反馈内容'}
          </button>
        </div>
      </div>
    </div>
  )
}
