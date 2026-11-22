interface Props {
  wordCount: number
  markdownInput: boolean
  savedAt: number | null
  outlineOpen: boolean
  /** 存储写满 / 不可用：改动没能保存，常驻提醒 */
  saveFailed?: boolean
  localFileName?: string
  localFileStatus?: string
  onToggleMarkdownInput(): void
  /** 点「保存 .md」：这是打开"选格式"菜单的入口（按钮文字不变） */
  onExport(format: SaveFormat): void
}

import SaveMenu from './publication/SaveMenu'
import type { SaveFormat } from './publication/saveOptions'
import { useEffect, useState } from 'react'
import { formatDuration, sessionStartedAt } from './usageTime'

function relTime(at: number): string {
  const s = Math.max(1, Math.floor((Date.now() - at) / 1000))
  if (s < 60) return '刚刚'
  const m = Math.floor(s / 60)
  if (m < 60) return `${m} 分钟前`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} 小时前`
  return `${Math.floor(h / 24)} 天前`
}

const pad2 = (n: number): string => String(n).padStart(2, '0')

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

/** 现在的时刻，形如 `14:07:32`（本地时间） */
export function clockText(d: Date): string {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`
}

/**
 * 今天的日期，形如 `9月23日 周三`。
 *
 * 为什么不带年份：写东西的时候看年份基本没用，省下的宽度更值钱；
 * 想看完整日期，鼠标停上去有 title。
 */
export function dateText(d: Date): string {
  return `${d.getMonth() + 1}月${d.getDate()}日 ${WEEKDAYS[d.getDay()]}`
}

/** 完整日期，给 title 用 */
export function fullDateText(d: Date): string {
  return `${d.getFullYear()} 年 ${d.getMonth() + 1} 月 ${d.getDate()} 日 ${WEEKDAYS[d.getDay()]}`
}

function StatusClock() {
  const [clock, setClock] = useState(() => new Date())
  useEffect(() => {
    let next: number | undefined
    const sync = () => {
      window.clearTimeout(next)
      if (document.hidden) return
      const timestamp = Date.now()
      setClock(new Date(timestamp))
      next = window.setTimeout(sync, 1000 - (timestamp % 1000))
    }
    sync()
    document.addEventListener('visibilitychange', sync)
    window.addEventListener('focus', sync)
    return () => {
      window.clearTimeout(next)
      document.removeEventListener('visibilitychange', sync)
      window.removeEventListener('focus', sync)
    }
  }, [])

  return (
    <time className="zh-statusbar__clock" title={fullDateText(clock)} dateTime={clock.toISOString()}>
      {dateText(clock)} <span className="zh-statusbar__clock-digits">{clockText(clock)}</span>
    </time>
  )
}

export default function StatusBar(props: Props) {
  const { wordCount, markdownInput, savedAt, outlineOpen, saveFailed, localFileName, localFileStatus,
    onToggleMarkdownInput, onExport } = props
  /* 左下角「用时」：本次打开用了多久。15 秒刷一次就够（显示到分钟），
     不用每秒重渲染 —— 对这个数字没意义。 */
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 15000)
    return () => window.clearInterval(t)
  }, [])


  return (
    <div className="zh-statusbar">
      <div className="zh-statusbar__inner">
        <span className="zh-statusbar__count">字数：{wordCount}</span>
        <span className="zh-statusbar__count zh-statusbar__elapsed" title="当前会话时长">
          用时：{formatDuration(Math.max(0, now - sessionStartedAt()))}
        </span>
        <StatusClock />

        <button
          type="button"
          className={`zh-switch${markdownInput ? ' zh-switch--on' : ''}`}
          onClick={onToggleMarkdownInput}
          role="switch"
          aria-checked={markdownInput}
          title={
            markdownInput
              ? 'Markdown 输入已启用。标题、列表和加粗语法会自动转换。'
              : 'Markdown 输入已停用。输入内容保留为原始文本。'
          }
        >
          <span className="zh-switch__track">
            <span className="zh-switch__knob" />
          </span>
          Markdown 输入
          <span className="zh-switch__state">{markdownInput ? '开' : '关'}</span>
        </button>

        {saveFailed ? (
          <span className="zh-statusbar__draft zh-statusbar__draft--warn" title="浏览器存储不可用。请将文档导出到本地。">
            保存失败：浏览器存储已满或不可用
          </span>
        ) : (
          savedAt !== null && <span className="zh-statusbar__draft" title={relTime(savedAt)}>草稿已自动保存</span>
        )}
        {localFileName && <span className="zh-statusbar__draft zh-statusbar__file" title={localFileName} role="status">{localFileStatus}</span>}
        {outlineOpen && <span className="zh-statusbar__draft">大纲已展开</span>}
        <span className="zh-statusbar__spacer" />
        {/* 按钮文字保持「保存 .md」，点开可以选格式（Markdown / 知乎 / 通用版 / 网页 / PDF） */}
        <SaveMenu pill direction="up" label="保存 .md" localFileName={localFileName} onPick={onExport} />
      </div>
    </div>
  )
}
