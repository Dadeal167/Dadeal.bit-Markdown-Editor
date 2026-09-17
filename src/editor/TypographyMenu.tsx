import { useEffect, useRef, useState } from 'react'
import {
  FONT_FAMILIES,
  FONT_SIZES,
  TEXT_COLORS,
  type Typography,
} from './typography'
import { addCustomFont, formatSize, removeCustomFont, type CustomFont } from './customFonts'

interface Props {
  open: boolean
  onOpenChange(open: boolean): void
  typography: Typography
  onChange(next: Typography): void
  /** 给选中文字上色；返回 false 表示当前没有选中文字 */
  onColor(color: string): boolean
  onClearColor(): boolean
  hasSelection: boolean
  /** 用户自己装的字体（存在 IndexedDB 里） */
  customFonts: CustomFont[]
  onCustomFontsChange(next: CustomFont[]): void
}

/** 工具栏「字体」：正文字号 / 正文字体（整篇）＋ 文字颜色（选中内容）＋ 自己装字体 */
export default function TypographyMenu({
  open,
  onOpenChange,
  typography,
  onChange,
  onColor,
  onClearColor,
  hasSelection,
  customFonts,
  onCustomFontsChange,
}: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const [fontMsg, setFontMsg] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onOpenChange(false)
    }
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onOpenChange(false)
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', esc)
    }
  }, [open, onOpenChange])

  return (
    <div className="zh-tb-wrap" ref={ref}>
      <button
        type="button"
        className={`zh-btn${open ? ' zh-btn--active' : ''}`}
        title="正文字号 / 字体 / 文字颜色"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => onOpenChange(!open)}
      >
        <span className="zh-glyph">A</span>
        <span className="zh-btn__label">字体</span>
      </button>

      {open && (
        <div className="zh-typomenu">
          <div className="zh-typomenu__section">正文字号（作用于整篇）</div>
          <div className="zh-typomenu__row">
            {FONT_SIZES.map((s) => (
              <button
                key={s.value}
                type="button"
                className={`zh-typomenu__chip${typography.size === s.value ? ' zh-typomenu__chip--on' : ''}`}
                onClick={() => onChange({ ...typography, size: s.value })}
              >
                {s.label}
                <span className="zh-typomenu__chipnum">{s.value}</span>
              </button>
            ))}
          </div>

          <div className="zh-typomenu__section">正文字体（作用于整篇）</div>
          <div className="zh-typomenu__list">
            {FONT_FAMILIES.map((f) => (
              <button
                key={f.label}
                type="button"
                className={`zh-typomenu__item${typography.family === f.value ? ' zh-typomenu__item--on' : ''}`}
                style={f.value ? { fontFamily: f.value } : undefined}
                onClick={() => onChange({ ...typography, family: f.value })}
              >
                {f.sample}
                <span className="zh-typomenu__label">{f.label}</span>
              </button>
            ))}
          </div>

          <div className="zh-typomenu__section">
            文字颜色（作用于选中的文字）
            <span className={`zh-typomenu__hint${hasSelection ? '' : ' zh-typomenu__hint--warn'}`}>
              {hasSelection ? '已选中，点颜色即可' : '先在正文里选中文字'}
            </span>
          </div>
          <div className="zh-typomenu__colors">
            {TEXT_COLORS.map((c) => (
              <button
                key={c.value}
                type="button"
                className="zh-typomenu__swatch"
                style={{ background: c.value }}
                title={c.label}
                onClick={() => {
                  if (onColor(c.value)) onOpenChange(false)
                }}
              />
            ))}
            <label className="zh-typomenu__custom" title="自定义颜色">
              <input
                type="color"
                defaultValue="#d93025"
                onChange={(e) => {
                  if (onColor(e.target.value)) onOpenChange(false)
                }}
              />
            </label>
            <button
              type="button"
              className="zh-typomenu__clear"
              onClick={() => {
                if (onClearColor()) onOpenChange(false)
              }}
            >
              清除颜色
            </button>
          </div>

          <div className="zh-typomenu__section">
            我的字体
            <button type="button" className="zh-typomenu__install" onClick={() => fileRef.current?.click()}>
              ＋ 安装字体
            </button>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept=".ttf,.otf,.woff,.woff2,font/*"
            style={{ display: 'none' }}
            onChange={async (e) => {
              const file = e.target.files?.[0]
              e.target.value = ''
              if (!file) return
              try {
                setFontMsg('正在安装…')
                const font = await addCustomFont(file)
                onCustomFontsChange([font, ...customFonts])
                onChange({ ...typography, family: `"${font.family}", ${FONT_FAMILIES[0].value || 'sans-serif'}` })
                setFontMsg(`已安装「${font.name}」并设为正文字体`)
              } catch (err) {
                setFontMsg('安装失败：这个文件可能不是字体（支持 ttf / otf / woff / woff2）')
                console.error(err)
              }
            }}
          />
          {customFonts.length === 0 ? (
            <div className="zh-typomenu__empty">还没有安装字体。选一个 ttf / otf 文件即可，装好后一直有效。</div>
          ) : (
            <div className="zh-typomenu__list">
              {customFonts.map((f) => (
                <div key={f.id} className="zh-typecustom">
                  <button
                    type="button"
                    className={`zh-typomenu__item zh-typecustom__pick${typography.family.includes(f.family) ? ' zh-typomenu__item--on' : ''}`}
                    style={{ fontFamily: `"${f.family}"` }}
                    onClick={() => onChange({ ...typography, family: `"${f.family}", sans-serif` })}
                  >
                    数学笔记 Aa
                    <span className="zh-typomenu__label">
                      {f.name} · {formatSize(f.size)}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="zh-typecustom__del"
                    title="删除这个字体"
                    onClick={async () => {
                      await removeCustomFont(f.id)
                      onCustomFontsChange(customFonts.filter((x) => x.id !== f.id))
                      // 正在用它当正文字体就退回默认，否则刷新后会静默变成 sans-serif
                      if (typography.family.includes(f.family)) {
                        onChange({ ...typography, family: FONT_FAMILIES[0].value })
                        setFontMsg(`已删除「${f.name}」，正文字体已恢复默认`)
                      } else {
                        setFontMsg(`已删除「${f.name}」`)
                      }
                    }}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}
          {fontMsg && <div className="zh-typomenu__msg">{fontMsg}</div>}

          <div className="zh-typomenu__foot">
            字号与字体只改正文外观；公式的字体 / 字号 / 颜色仍由公式弹窗控制，互不影响。
          </div>
        </div>
      )}
    </div>
  )
}
