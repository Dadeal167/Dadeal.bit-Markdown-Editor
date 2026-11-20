import { useMemo } from 'react'
import type { DocVersion } from '../documents'
import { useEscapeClose } from '../useEscapeClose'
import { versionChanges, type VersionChange } from './versionChanges'

export interface VersionComparison { id: string; version: DocVersion; title: string; md: string }

function preview(text: string): string {
  const compact = text.replace(/data:[^;\s]+;base64,[A-Za-z0-9+/=]+/g, '〔内嵌资源〕')
  if (compact.length > 16000) return compact.slice(0, 8000) + '\n…\n' + compact.slice(-8000)
  return compact || '（无内容）'
}

export default function VersionCompareModal({ comparison, feedback, onRestore, onClose }: {
  comparison: VersionComparison; feedback: string; onRestore(change: VersionChange | 'title'): void; onClose(): void
}) {
  useEscapeClose(true, onClose)
  const { version, md, title } = comparison
  const changes = useMemo(() => versionChanges(version.md, md), [version.md, md])
  const differentTitle = version.title !== title
  return <div className="zh-modal-mask">
    <section className="zh-modal zh-modal--source" role="dialog" aria-modal="true" aria-label="版本对比">
      <div className="zh-modal__head">版本对比<button type="button" className="zh-modal__close" aria-label="关闭" onClick={onClose}>✕</button></div>
      <div className="zh-modal__body">
        <div className="zh-version-columns"><strong>历史版本 · {new Date(version.at).toLocaleString()}</strong><strong>当前文档</strong></div>
        {differentTitle && <div className="zh-version-change">
          <div className="zh-version-columns"><pre>{preview(version.title)}</pre><pre>{preview(title)}</pre></div>
          <button type="button" className="zh-btn-plain" onClick={() => onRestore('title')}>恢复标题</button>
        </div>}
        {changes === null && <p role="status">本次差异较多。可从版本历史查看或恢复完整版本。</p>}
        {changes?.length === 0 && !differentTitle && <p>当前文档与选定版本相同。</p>}
        {changes?.map((change) => <div className="zh-version-change" key={`${change.start}-${change.end}`}>
          <div className="zh-version-columns">
            <pre aria-label="历史内容">{preview(change.oldText)}</pre>
            <pre aria-label="当前内容">{preview(change.currentText)}</pre>
          </div>
          <button type="button" className="zh-btn-plain" onClick={() => onRestore(change)}>恢复此处</button>
        </div>)}
        {feedback && <p role="status">{feedback}</p>}
      </div>
    </section>
  </div>
}
