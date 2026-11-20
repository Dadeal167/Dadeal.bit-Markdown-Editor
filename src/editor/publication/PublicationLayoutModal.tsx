import { useState } from 'react'
import { publicationPresets, type PublicationLayout } from './publicationLayout'
import { useEscapeClose } from '../useEscapeClose'

interface Props {
  initial: PublicationLayout
  onApply(layout: PublicationLayout): void
  onClose(): void
}

export default function PublicationLayoutModal({ initial, onApply, onClose }: Props) {
  const [layout, setLayout] = useState(initial)
  useEscapeClose(true, onClose)
  const custom = (values: Partial<PublicationLayout>) => setLayout((current) => ({ ...current, ...values, preset: 'custom' }))
  return <div className="zh-modal-mask">
    <form className="zh-modal" role="dialog" aria-modal="true" aria-label="Word 与 PDF 排版"
      onSubmit={(event) => { event.preventDefault(); onApply(layout) }}>
      <div className="zh-modal__head">Word 与 PDF 排版
        <button type="button" className="zh-modal__close" onClick={onClose} aria-label="关闭排版设置">✕</button>
      </div>
      <div className="zh-modal__body zh-publication">
        <label>排版模板
          <select autoFocus value={layout.preset} onChange={(event) => {
            const value = event.target.value as PublicationLayout['preset']
            if (value === 'custom') custom({})
            else setLayout(publicationPresets[value])
          }}>
            <option value="default">默认</option>
            <option value="handout">讲义</option>
            <option value="solutions">试题解析</option>
            <option value="custom">自定义</option>
          </select>
        </label>
        {layout.preset === 'default' ? <p>沿用 Word 和浏览器各自的默认纸张和边距。选择模板或自定义以统一排版。</p> : <>
          <label>纸张 <select value={layout.paper} onChange={(event) => custom({ paper: event.target.value as PublicationLayout['paper'] })}>
            <option value="A4">A4</option><option value="Letter">Letter</option>
          </select></label>
          <div className="zh-publication__margins">
            {([['top', '上'], ['right', '右'], ['bottom', '下'], ['left', '左']] as const).map(([key, label]) =>
              <label key={key}>{label}边距（mm）<input type="number" min="8" max="50" step="0.1" required
                value={Number.isFinite(layout[key]) ? layout[key] : ''}
                onChange={(event) => custom({ [key]: event.target.valueAsNumber })} /></label>)}
          </div>
          <label>页眉 <input maxLength={100} value={layout.header} onChange={(event) => custom({ header: event.target.value })} /></label>
          <label>页脚 <input maxLength={100} value={layout.footer} onChange={(event) => custom({ footer: event.target.value })} /></label>
          <p>页眉或页脚可以用 <code>{'{title}'}</code> 插入文档标题。PDF 打印时可关闭浏览器的「页眉和页脚」选项，以免重复。</p>
          <label><input type="checkbox" checked={layout.numbers} onChange={(event) => custom({ numbers: event.target.checked })} />显示页码</label>
          <label><input type="checkbox" checked={layout.chapterBreaks} onChange={(event) => custom({ chapterBreaks: event.target.checked })} />
            一级、二级章节标题前分页（从第二个章节起）</label>
        </>}
      </div>
      <div className="zh-modal__footer">
        <button type="button" className="zh-btn-plain" onClick={onClose}>取消</button>
        <button type="submit" className="zh-btn-solid">应用排版</button>
      </div>
    </form>
  </div>
}
