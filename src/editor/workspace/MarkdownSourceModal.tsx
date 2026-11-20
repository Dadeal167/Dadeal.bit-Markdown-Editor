import { useEffect, useRef, useState } from 'react'
import { diffLines } from 'diff'
import { useEscapeClose } from '../useEscapeClose'
import type { reviewSource } from './sourceReview'

interface Props {
  initial: string
  onPreview(value: string): Promise<string>
  onReview(value: string): ReturnType<typeof reviewSource>
  onApply(value: string): string | undefined
  onSave(): void
  onClose(): void
}

export default function MarkdownSourceModal({ initial, onPreview, onReview, onApply, onSave, onClose }: Props) {
  const [source, setSource] = useState(initial)
  const [error, setError] = useState('')
  const [preview, setPreview] = useState('')
  const [previewError, setPreviewError] = useState(false)
  const [review, setReview] = useState<{ source: string; result: Awaited<ReturnType<typeof reviewSource>> }>()
  const [checking, setChecking] = useState(false)
  const [pane, setPane] = useState<'preview' | 'checks'>('preview')
  const [showDiff, setShowDiff] = useState(false)
  const textarea = useRef<HTMLTextAreaElement>(null)
  const pendingReview = useRef(0)
  const changed = source !== initial
  const report = review?.source === source ? review.result : undefined
  const close = () => {
    if (!changed || window.confirm('放弃尚未应用的源码更改？')) onClose()
  }
  useEscapeClose(true, close)

  useEffect(() => {
    if (pane !== 'preview') return
    let current = true
    const timer = window.setTimeout(() => {
      void onPreview(source).then((html) => {
        if (current) { setPreview(html); setPreviewError(false) }
      }).catch(() => { if (current) setPreviewError(true) })
    }, 160)
    return () => { current = false; window.clearTimeout(timer) }
  }, [onPreview, pane, source])

  const check = async () => {
    const run = ++pendingReview.current
    setPane('checks')
    setShowDiff(false)
    setChecking(true)
    setError('')
    try {
      const result = await onReview(source)
      if (pendingReview.current === run) setReview({ source, result })
    } catch {
      if (pendingReview.current === run) setError('无法完成格式检查。')
    } finally {
      if (pendingReview.current === run) setChecking(false)
    }
  }

  const goToLine = (line: number) => {
    const lines = source.split('\n')
    const start = lines.slice(0, line - 1).reduce((offset, text) => offset + text.length + 1, 0)
    const field = textarea.current
    if (!field) return
    field.focus()
    field.setSelectionRange(start, start + (lines[line - 1]?.length ?? 0))
    const lineHeight = Number.parseFloat(getComputedStyle(field).lineHeight)
    field.scrollTop = Math.max(0, (line - 3) * lineHeight)
  }

  const apply = (save = false) => {
    const failure = changed ? onApply(source) : undefined
    if (failure) setError(failure)
    else {
      onClose()
      if (save) onSave()
    }
  }

  return (
    <div className="zh-modal-mask">
      <div className="zh-modal zh-modal--source" role="dialog" aria-modal="true" aria-label="Markdown 源码">
        <div className="zh-modal__head">
          Markdown 源码
          <button type="button" className="zh-modal__close" onClick={close} aria-label="关闭源码">✕</button>
        </div>
        <div className="zh-modal__body zh-source__body">
          <div className="zh-source__columns">
          <div className="zh-source__column">
          <div className="zh-source__tabs"><strong>源码</strong></div>
          <textarea ref={textarea} autoFocus aria-label="编辑 Markdown 源码" value={source} spellCheck={false} wrap="off"
            onChange={(event) => {
              pendingReview.current++
              setChecking(false)
              setShowDiff(false)
              setSource(event.target.value)
              if (error) setError('')
            }}
            onKeyDown={(event) => {
              if ((event.key === 'Enter' || event.key.toLowerCase() === 's') &&
                  (event.ctrlKey || event.metaKey) && !event.nativeEvent.isComposing) {
                event.preventDefault()
                apply(event.key.toLowerCase() === 's')
              }
            }} />
          </div>
          <div className="zh-source__column">
            <div className="zh-source__tabs">
              <button type="button" className="zh-btn-plain" aria-pressed={pane === 'preview'} onClick={() => setPane('preview')}>排版预览</button>
              <button type="button" className="zh-btn-plain" aria-pressed={pane === 'checks'} onClick={() => void check()}>检查格式</button>
            </div>
            {pane === 'preview' ? (previewError ? <p role="alert">无法生成预览。</p>
              : <iframe title="Markdown 排版预览" sandbox="" srcDoc={preview} />)
              : <div className="zh-source__review">
                {checking ? <p role="status">正在检查格式与本地链接…</p> : report ? <>
                  {report.issues.length ? <ul className="zh-source__issues">
                    {report.issues.map((issue, index) => <li key={index}>
                      <button type="button" className="zh-btn-plain" onClick={() => goToLine(issue.line)}>第 {issue.line} 行 · {issue.text}</button>
                    </li>)}
                  </ul> : <p role="status">标题、表格与可核对的本地链接通过检查。</p>}
                  {report.formatted !== source && <>
                    {!showDiff ? <button type="button" className="zh-btn-plain" onClick={() => setShowDiff(true)}>预览格式修复</button> : <>
                      <p>− 删除行　+ 新增行</p>
                      <pre aria-label="格式修复差异">{diffLines(source, report.formatted).filter((part) => part.added || part.removed)
                        .map((part, index) => <span key={index} data-change={part.added ? 'added' : 'removed'}>
                          {part.value.replace(/\n$/, '').split('\n').map((line) => (part.added ? '+ ' : '− ') + line).join('\n') + '\n'}
                        </span>)}</pre>
                      <button type="button" className="zh-btn-solid" onClick={() => {
                        setSource(report.formatted); setShowDiff(false); setPane('preview')
                      }}>将修复应用到源码</button>
                    </>}
                  </>}
                </> : <p>选择「检查格式」以检查当前源码。</p>}
              </div>}
          </div>
          </div>
          {error && <p role="alert">{error}</p>}
        </div>
        <div className="zh-modal__footer">
          <button type="button" className="zh-btn-plain" onClick={close}>取消</button>
          <button type="button" className="zh-btn-solid" onClick={() => apply()}>应用更改</button>
        </div>
      </div>
    </div>
  )
}
