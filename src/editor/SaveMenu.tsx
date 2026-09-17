import { useEffect, useRef, useState } from 'react'
import { IconExport, IconSave } from './icons'

/**
 * 「保存」下拉：一个按钮，点开选格式。
 *
 * 为什么把「导出」并进来：以前工具栏上是「保存」和「导出」两个按钮，
 * 而「保存 .md」存出来的是**给自己看的存档**（公式是 `$…$`、图片内嵌在文件里），
 * 直接拿去知乎导入会丢图 —— 用户连着踩了两次（导出的文件里图全是 base64）。
 * 所以菜单前几项全是"图片一定能正常显示"的格式：
 *   · 导出知乎用 .md —— 公式换成知乎认的写法，图片自动上传换成公开网址（发知乎就用它）
 *   · 导出网页 .html —— 图片内嵌在网页里，离线打开就看得见
 *   · 另存为 PDF —— 打印出来看
 * 最后一项「存一份自己看的 .md」也收进来（以前藏在「更多」里，用户根本找不着），
 * hint 里明说"别拿去知乎导入"，免得又选错。
 * 拿不出公开网址时（助手没开、也没填图床令牌）**直接拦住并告诉你怎么做**，
 * 不会再默默给一个"图片进不了知乎"的文件。
 */
export type SaveFormat = 'zhihu' | 'html' | 'pdf' | 'plain'

export interface SaveFormatItem {
  key: SaveFormat
  label: string
  hint: string
}

export const SAVE_FORMATS: SaveFormatItem[] = [
  { key: 'zhihu', label: '导出知乎用 .md', hint: '给知乎导入 / 给别的平台或同学用：公式换成知乎认的写法，本机图片自动传图床换公开网址' },
  { key: 'html', label: '导出网页（.html）', hint: '单个网页文件，图片也在里面，离线打开就能看' },
  { key: 'pdf', label: '另存为 PDF', hint: '打开打印对话框，目标选「另存为 PDF」' },
  {
    key: 'plain',
    label: '存一份自己看的 .md（备份 / 阅读）',
    hint: '纯 Markdown 存档，图片内嵌在文件里；别拿去知乎导入（知乎读不了内嵌图片）',
  },
]

interface Props {
  onPick(format: SaveFormat): void
  /** 菜单弹出方向：状态栏那个在底部，要往上弹 */
  direction?: 'down' | 'up'
  disabled?: boolean
  /** 显示成状态栏那种蓝色主按钮 */
  pill?: boolean
  /** 按钮文字（默认「保存」，状态栏那边保持原来的「保存 .md」） */
  label?: string
}

export default function SaveMenu({ onPick, direction = 'down', disabled, pill, label = '保存' }: Props) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', esc)
    }
  }, [open])

  return (
    <div className="zh-tb-wrap" ref={ref}>
      <button
        type="button"
        className={pill ? 'zh-pill zh-pill--primary zh-save-pill' : 'zh-btn'}
        // 鼠标提示保持和按钮文字一致（有脚本按 title 定位按钮，别乱改）
        title={label}
        // 小三角是 CSS 伪元素，会被算进"无障碍名称"，所以这里显式声明成纯文字
        aria-label={label}
        aria-haspopup="menu"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setOpen((o) => !o)}
        disabled={disabled}
      >
        {!pill && <IconSave />}
        {/* 文字和小三角必须在同一个行内盒子里：工具栏按钮是 flex-column（图标一行、文字一行），
            把小三角单独放会变成"第三行"，按钮就被撑高了（实测工具栏从 46px 变 53px）。
            小三角用 CSS 伪元素画，**不进 textContent** —— 有脚本按按钮文字定位，文字必须还是「保存」。 */}
        <span className={pill ? 'zh-save-pill__label' : 'zh-btn__label zh-btn__label--caret'}>{label}</span>
      </button>
      {open && (
        <div className={`zh-menu zh-menu--save${direction === 'up' ? ' zh-menu--up' : ''}`}>
          <div className="zh-menu__title">
            <IconExport />
            <span>选格式保存 / 导出</span>
          </div>
          {SAVE_FORMATS.map((f) => (
            <button
              key={f.key}
              type="button"
              className="zh-menu__item zh-menu__item--tall"
              data-format={f.key}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                setOpen(false)
                onPick(f.key)
              }}
            >
              <span className="zh-menu__row">{f.label}</span>
              <span className="zh-menu__hint">{f.hint}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
