interface Props {
  wordCount: number
  markdownInput: boolean
  savedAt: number | null
  outlineOpen: boolean
  /** 存储写满 / 不可用：改动没能保存，常驻提醒 */
  saveFailed?: boolean
  onToggleMarkdownInput(): void
  /** 点「保存 .md」：这是打开"选格式"菜单的入口（按钮文字不变） */
  onExport(format: SaveFormat): void
}

import SaveMenu from './SaveMenu'
import type { SaveFormat } from './SaveMenu'

function relTime(at: number): string {
  const s = Math.max(1, Math.floor((Date.now() - at) / 1000))
  if (s < 60) return '刚刚'
  const m = Math.floor(s / 60)
  if (m < 60) return `${m} 分钟前`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} 小时前`
  return `${Math.floor(h / 24)} 天前`
}

export default function StatusBar(props: Props) {
  const { wordCount, markdownInput, savedAt, outlineOpen, saveFailed, onToggleMarkdownInput, onExport } = props
  return (
    <div className="zh-statusbar">
      <div className="zh-statusbar__inner">
        <span className="zh-statusbar__count">字数：{wordCount}</span>

        <button
          type="button"
          className={`zh-switch${markdownInput ? ' zh-switch--on' : ''}`}
          onClick={onToggleMarkdownInput}
          role="switch"
          aria-checked={markdownInput}
          title={
            markdownInput
              ? 'Markdown 输入已开启：输入 # 、- 、** 这类语法会自动变成标题/列表/加粗。点一下关闭'
              : 'Markdown 输入已关闭：所有符号原样输入（写乘法号 * 时不会误变斜体）。点一下开启'
          }
        >
          <span className="zh-switch__track">
            <span className="zh-switch__knob" />
          </span>
          Markdown 输入
          <span className="zh-switch__state">{markdownInput ? '开' : '关'}</span>
        </button>

        {saveFailed ? (
          <span className="zh-statusbar__draft zh-statusbar__draft--warn" title="浏览器存储写不进去了，请用「保存 .md」把内容存成文件">
            ⚠️ 改动没能保存（存储已满或不可用）
          </span>
        ) : (
          savedAt !== null && <span className="zh-statusbar__draft">{relTime(savedAt)} · 草稿</span>
        )}
        {outlineOpen && <span className="zh-statusbar__draft">大纲已展开</span>}
        <span className="zh-statusbar__spacer" />
        {/* 按钮文字保持「保存 .md」，点开可以选格式（Markdown / 知乎 / 通用版 / 网页 / PDF） */}
        <SaveMenu pill direction="up" label="保存 .md" onPick={onExport} />
      </div>
    </div>
  )
}
