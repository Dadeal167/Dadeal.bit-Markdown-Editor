import { Fragment, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { EditorApi } from './types'
import {
  IconClearFormat,
  IconCode,
  IconFormula,
  IconHr,
  IconImage,
  IconLink,
  IconMore,
  IconOpen,
  IconOutline,
  IconQuote,
  IconRedo,
  IconTable,
  IconTheme,
  IconUL,
  IconUndo,
  IconVideo,
} from './icons'

export interface ToolbarHandlers {
  openFormula(): void
  openTable(): void
  openLink(): void
  openVideo(): void
  openHelp(): void
  openShortcuts(): void
  /** 打开「存到知乎草稿箱」面板 */
  openZhihu(): void
  pickImage(): void
  /** 体检当前文档：图片打不开 / 公式渲染不出来 */
  checkDocument(): void
}

interface ToolbarItem {
  key: string
  label: string
  icon?: ReactNode
  /** 鼠标提示，缺省用 label */
  title?: string
  /** 自定义节点（表格里放下拉面板用），给了就直接渲染它 */
  render?: ReactNode
  onClick?: () => void
  menu?: ToolbarItem[]
  active?: boolean
}

interface Props {
  api: EditorApi
  handlers: ToolbarHandlers
  /** 插在最前面的自定义按钮（文档列表） */
  extraLeading?: ReactNode
  /** 排版（字号/字体/颜色）下拉，放在排版按钮那一组里 */
  typographyMenu?: ReactNode
  /** 「保存」按钮：点开选格式（Markdown / 知乎 / 通用版 / 网页 / PDF） */
  saveMenu?: ReactNode
}

function ToolbarButton({ item, afterClick }: { item: ToolbarItem; afterClick: () => void }) {
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
        className={`zh-btn${item.active ? ' zh-btn--active' : ''}`}
        title={item.title ?? item.label}
        // 阻止 mousedown 默认行为：保持编辑器焦点与选区不被抢走
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          if (item.menu) {
            setOpen((o) => !o)
          } else {
            item.onClick?.()
            setOpen(false)
            afterClick()
          }
        }}
      >
        {item.icon}
        <span className="zh-btn__label">{item.label}</span>
      </button>
      {item.menu && open && (
        <div className="zh-menu">
          {item.menu.map((m) => (
            <button
              key={m.key}
              type="button"
              className={`zh-menu__item${m.active ? ' zh-menu__item--on' : ''}`}
              data-key={m.key}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                m.onClick?.()
                setOpen(false)
                afterClick()
              }}
            >
              <span>{m.label}</span>
              {m.active && <span className="zh-menu__check">✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export default function Toolbar({ api, handlers, extraLeading, typographyMenu, saveMenu }: Props) {
  const groups: ToolbarItem[][] = [
    [
      { key: 'open', label: '打开', icon: <IconOpen />, onClick: () => api.openMarkdownFile() },
      // 「保存」保持原样，只是点下去先问格式（原来单独的「导出」按钮并进这里了）
      { key: 'save', label: '保存', render: saveMenu },
    ],
    [
      { key: 'undo', label: '撤销', icon: <IconUndo />, onClick: () => api.undo() },
      { key: 'redo', label: '重做', icon: <IconRedo />, onClick: () => api.redo() },
      { key: 'clear', label: '清除格式', icon: <IconClearFormat />, onClick: () => api.clearFormat() },
    ],
    [
      {
        key: 'h',
        label: '标题',
        icon: <span className="zh-glyph">H</span>,
        menu: [
          { key: 'h1', label: '一级标题', onClick: () => api.setHeading(1) },
          { key: 'h2', label: '二级标题', onClick: () => api.setHeading(2) },
          { key: 'h3', label: '三级标题', onClick: () => api.setHeading(3) },
          { key: 'p', label: '正文', onClick: () => api.setParagraph() },
        ],
      },
      { key: 'bold', label: '加粗', icon: <span className="zh-glyph zh-glyph--b">B</span>, onClick: () => api.toggleBold() },
      { key: 'italic', label: '斜体', icon: <span className="zh-glyph zh-glyph--i">I</span>, onClick: () => api.toggleItalic() },
      typographyMenu ? { key: 'typography', label: '字体', render: typographyMenu } : null,
    ].filter(Boolean) as ToolbarItem[],
    [
      {
        key: 'list',
        label: '列表',
        icon: <IconUL />,
        menu: [
          { key: 'ul', label: '无序列表', onClick: () => api.toggleList() },
          { key: 'ol', label: '有序列表', onClick: () => api.toggleOrderedList() },
        ],
      },
      { key: 'quote', label: '引用', icon: <IconQuote />, onClick: () => api.toggleQuote() },
      { key: 'hr', label: '分割线', icon: <IconHr />, onClick: () => api.insertHr() },
      { key: 'code', label: '代码块', icon: <IconCode />, onClick: () => api.toggleCodeBlock() },
    ],
    [
      { key: 'image', label: '图片', icon: <IconImage />, onClick: () => handlers.pickImage() },
      { key: 'video', label: '视频', icon: <IconVideo />, onClick: () => handlers.openVideo() },
      { key: 'link', label: '链接', icon: <IconLink />, onClick: () => handlers.openLink() },
      { key: 'math', label: '公式', icon: <IconFormula />, onClick: () => handlers.openFormula() },
      { key: 'table', label: '表格', icon: <IconTable />, onClick: () => handlers.openTable() },
    ],
    [
      { key: 'outline', label: '大纲', icon: <IconOutline />, onClick: () => api.toggleOutline() },
      {
        key: 'theme',
        label: '主题',
        icon: <IconTheme />,
        menu: [
          { key: 'light', label: '浅色', onClick: () => api.setTheme('light'), active: api.theme === 'light' },
          { key: 'dark', label: '深色', onClick: () => api.setTheme('dark'), active: api.theme === 'dark' },
          { key: 'system', label: '跟随系统', onClick: () => api.setTheme('system'), active: api.theme === 'system' },
        ],
      },
      {
        key: 'zhihu',
        label: '知乎',
        icon: <span className="zh-glyph">知</span>,
        onClick: () => handlers.openZhihu(),
      },
      {
        key: 'more',
        label: '更多',
        icon: <IconMore />,
        menu: [
          // 这里原来有「存一份自己看的 .md」和「Markdown 输入开 / 关」：
          // 前者收进了「保存」菜单；后者底部状态栏本来就有开关（点一下就行），所以也撤了
          { key: 'check-doc', label: '检查图片与公式（打不开就修）', onClick: () => handlers.checkDocument() },
          { key: 'fullscreen', label: '全屏', onClick: () => api.toggleFullscreen() },
          { key: 'help', label: '快捷键帮助', onClick: () => handlers.openHelp() },
          { key: 'shortcuts', label: '自定义快捷键', onClick: () => handlers.openShortcuts() },
          { key: 'reset-doc', label: '重置当前文档为示例内容', onClick: () => api.resetCurrentDoc() },
        ],
      },
    ],
  ]

  return (
    <div className="zh-toolbar">
      <div className="zh-toolbar__inner">
        {groups.map((group, gi) => (
          <div className="zh-toolbar__group" key={gi}>
            {gi === 0 && extraLeading}
            {group.map((item) =>
              item.render ? (
                <Fragment key={item.key}>{item.render}</Fragment>
              ) : (
                <ToolbarButton key={item.key} item={item} afterClick={() => api.focus()} />
              ),
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
