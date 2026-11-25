import { useEffect, useId, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { requestZhihuArticle, zhihuImportUrl, type ZhihuImportedArticle } from './zhihuImport'

interface Props {
  onImport(article: ZhihuImportedArticle): boolean
  onClose(): void
}

export default function ZhihuImportModal({ onImport, onClose }: Props) {
  const [address, setAddress] = useState('')
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const request = useRef<AbortController>(null)
  const inputId = useId()
  const helpId = useId()

  useEffect(() => () => request.current?.abort(), [])

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (request.current) return
    const url = zhihuImportUrl(address)
    if (!url) {
      setError('请输入知乎专栏文章或单篇回答的完整 HTTPS 网址。')
      return
    }
    const controller = new AbortController()
    request.current = controller
    setError('')
    setNotice('正在连接知乎提取器…')
    try {
      const article = await requestZhihuArticle(url, controller.signal, setNotice)
      if (!controller.signal.aborted && onImport(article)) onClose()
      else if (!controller.signal.aborted) setError('正文已提取，但浏览器未能保存草稿。请检查可用存储后重试。')
    } catch (failure) {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : '无法导入知乎内容。')
    } finally {
      if (!controller.signal.aborted) {
        request.current = null
        setNotice('')
      }
    }
  }

  return <div className="zh-modal-mask" onKeyDown={(event) => {
    if (event.key === 'Escape' && !event.nativeEvent.isComposing) { event.stopPropagation(); onClose() }
  }}>
    <form className="zh-modal" role="dialog" aria-modal="true" aria-label="从知乎链接导入" onSubmit={(event) => void submit(event)}>
      <div className="zh-modal__head">
        从知乎链接导入
        <button type="button" className="zh-modal__close" aria-label="关闭导入" onClick={onClose}>✕</button>
      </div>
      <div className="zh-modal__body">
        <label htmlFor={inputId}>知乎文章或回答网址</label>
        <input id={inputId} className="zh-input" type="text" inputMode="url" autoFocus autoComplete="off"
          aria-describedby={helpId} value={address} placeholder="https://zhuanlan.zhihu.com/p/…"
          readOnly={Boolean(notice)} onChange={(event) => { setAddress(event.target.value); setError('') }} />
        <p className="zh-modal__hint" id={helpId}>从桌面提取器或浏览器扩展读取正文，导入为新的浏览器草稿。</p>
        {notice && <p role="status">{notice}</p>}
        {error && <p role="alert">{error}</p>}
      </div>
      <div className="zh-modal__footer">
        <button type="button" className="zh-btn-plain" onClick={onClose}>取消</button>
        <button type="submit" className="zh-btn-solid" disabled={Boolean(notice)}>导入知乎内容</button>
      </div>
    </form>
  </div>
}
