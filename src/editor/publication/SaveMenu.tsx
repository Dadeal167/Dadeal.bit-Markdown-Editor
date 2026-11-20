import { useEffect, useRef, useState } from 'react'
import { IconExport, IconSave } from '../icons'
import { useAnchoredMenu } from '../useAnchoredMenu'

import { saveFormatSections, type SaveFormat } from './saveOptions'

interface Props {
  onPick(format: SaveFormat): void
  /** 菜单弹出方向：状态栏那个在底部，要往上弹 */
  direction?: 'down' | 'up'
  disabled?: boolean
  /** 显示成状态栏那种蓝色主按钮 */
  pill?: boolean
  /** 按钮文字（默认「保存」，状态栏那边保持原来的「保存 .md」） */
  label?: string
  localFileName?: string
}

export default function SaveMenu({ onPick, direction = 'down', disabled, pill, label = '保存', localFileName }: Props) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  useAnchoredMenu(open, ref, menu, direction)
  const sections = saveFormatSections(Boolean(localFileName))

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
    <div className={`zh-tb-wrap${pill ? ' zh-statusbar__save' : ''}`} ref={ref}>
      <button
        type="button"
        className={pill ? 'zh-pill zh-pill--primary zh-save-pill' : 'zh-btn'}
        // 鼠标提示保持和按钮文字一致（有脚本按 title 定位按钮，别乱改）
        title={label}
        // 小三角是 CSS 伪元素，会被算进"无障碍名称"，所以这里显式声明成纯文字
        aria-label={label}
        aria-expanded={open}
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
        <div ref={menu} className={`zh-menu zh-menu--save${direction === 'up' ? ' zh-menu--up' : ''}`}>
          <div className="zh-menu__title">
            <IconExport />
            <span>保存与导出</span>
          </div>
          {sections.map((section) => <div key={section.label} role="group" aria-label={section.label || undefined}>
            {section.label && <div className="zh-menu__section">{section.label}</div>}
            {section.items.map((f) => (
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
          </div>)}
        </div>
      )}
    </div>
  )
}
