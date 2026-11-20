import { exportTargetNames, type ExportReview, type ExportTarget } from './exportPreflight'
import { useEscapeClose } from '../useEscapeClose'

interface Props {
  review: ExportReview
  onTarget?(target: ExportTarget): void
  onContinue?(): void
  onLocate(pos: number): void
  onClose(): void
  backLabel?: string
}

const levels = { fix: '待修复', notice: '兼容性提示', block: '待修复' }

export default function ExportPreflightModal({ review, onTarget, onContinue, onLocate, onClose, backLabel = '返回编辑' }: Props) {
  useEscapeClose(true, onClose)
  const { target, issues } = review
  const blocked = issues.some((issue) => issue.level === 'block')
  return (
    <div className="zh-modal-mask">
      <section className="zh-modal zh-modal--equations" role="dialog" aria-modal="true" aria-labelledby="zh-preflight-heading">
        <div className="zh-modal__head">
          <span id="zh-preflight-heading">导出前检查</span>
          <button type="button" className="zh-modal__close" aria-label="关闭" onClick={onClose} autoFocus>✕</button>
        </div>
        <div className="zh-modal__body">
          {onTarget ? <label className="zh-equations__toggle">
            导出目标
            <select className="zh-input" value={target} onChange={(event) => onTarget(event.target.value as ExportTarget)}>
              {Object.entries(exportTargetNames).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            </select>
          </label> : <p className="zh-preflight__target">{exportTargetNames[target]}</p>}
          <p className="zh-equations__hint" role="status">
            {issues.length ? `发现 ${issues.length} 项需要核对的内容。` : '检查完成。未发现需要核对的内容。'}
          </p>
          <ul className="zh-equations__list">
            {issues.map((issue, index) => <li className="zh-equations__row zh-preflight__row" key={index}>
              <div>
                <strong>{issue.name}</strong>
                <span className={issue.level === 'notice' ? 'zh-preflight__level' : 'zh-preflight__level zh-preflight__warning'}>
                  {levels[issue.level]}
                </span>
                <p>{issue.detail}</p>
              </div>
              <button type="button" className="zh-btn-plain" onClick={() => onLocate(issue.pos)} aria-label={`定位${issue.name}`}>定位</button>
            </li>)}
          </ul>
        </div>
        <div className="zh-modal__footer">
          <button type="button" className="zh-btn-plain" onClick={onClose}>{onContinue ? backLabel : '关闭'}</button>
          {onContinue && <button type="button" className="zh-btn-solid" disabled={blocked} onClick={onContinue}>
            {target === 'zhihu-draft' ? '继续保存草稿' : '继续导出'}
          </button>}
        </div>
      </section>
    </div>
  )
}
