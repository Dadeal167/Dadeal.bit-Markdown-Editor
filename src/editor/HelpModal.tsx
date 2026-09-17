import { displayKey, shortcuts } from './shortcuts'
import { useEscapeClose } from './useEscapeClose'

interface Props {
  open: boolean
  onClose(): void
  onOpenShortcuts(): void
}

/** 显示的动作清单；键位实时取自用户设置 */
const KEY_ROWS: [string, string][] = [
  ['bold', '加粗'],
  ['italic', '斜体'],
  ['clearFormat', '清除格式'],
  ['undo', '撤销'],
  ['redo', '重做'],
  ['h1', '一级标题'],
  ['h2', '二级标题'],
  ['bulletList', '无序列表'],
  ['orderedList', '有序列表'],
  ['quote', '引用'],
  ['codeBlock', '代码块'],
  ['formula', '插入公式'],
  ['table', '插入表格'],
  ['link', '插入链接'],
  ['image', '插入图片'],
  ['save', '保存 .md'],
  ['open', '打开 .md'],
  ['exportPdf', '存为 PDF'],
  ['newDoc', '新建文档'],
  ['docs', '我的文档'],
  ['markdownInput', '切换 Markdown 输入'],
  ['outline', '大纲'],
  ['fullscreen', '全屏'],
  ['shortcuts', '快捷键设置'],
]

const TIPS: [string, string][] = [
  ['公式', '点顶栏「公式」，左边全是图形按钮，点一下就填进去；也可以自己敲 TeX'],
  ['再改公式', '正文里点一下公式，就能重新打开编辑'],
  ['图片', '点「图片」选文件，或者直接 Ctrl+V 粘贴截图（大于 400KB 会自动压缩）'],
  ['视频', '点「视频」粘贴 B 站 / YouTube 链接'],
  ['表格', '光标点进单元格，表格上方会浮出加行 / 加列 / 删除等操作'],
  ['Markdown 输入', '底部开关：开着时输入 # - ** 会自动变格式，粘贴的 Markdown 也会转换'],
  ['自动保存', '写的内容会自动存到浏览器里，工具栏最左「文档」可以新建 / 切换多篇'],
]

export default function HelpModal({ open, onClose, onOpenShortcuts }: Props) {
  useEscapeClose(open, onClose)

  if (!open) return null
  const bindings = shortcuts.bindings()
  return (
    <div className="zh-modal-mask" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="zh-modal zh-modal--help" role="dialog" aria-modal="true" aria-label="快捷键与使用提示">
        <div className="zh-modal__head">
          <span>
            Dadealbit Markdown 编辑器
            <span className="zh-modal__sub">快捷键 &amp; 使用提示</span>
          </span>
          <button type="button" className="zh-modal__close" onClick={onClose} aria-label="关闭">
            ✕
          </button>
        </div>
        <div className="zh-modal__body">
          <div className="zh-help__section">
            快捷键
            <button type="button" className="zh-help__edit" onClick={onOpenShortcuts}>
              自定义…
            </button>
          </div>
          <div className="zh-help__grid">
            {KEY_ROWS.map(([id, label]) => (
              <div className="zh-help__row" key={id}>
                <code className={bindings[id] ? '' : 'zh-help__code--empty'}>{displayKey(bindings[id])}</code>
                <span>{label}</span>
              </div>
            ))}
            <div className="zh-help__row">
              <code>Tab / Shift+Tab</code>
              <span>列表缩进 / 反缩进</span>
            </div>
          </div>
          <div className="zh-help__section">小提示</div>
          <div className="zh-help__grid">
            {TIPS.map(([k, v]) => (
              <div className="zh-help__row" key={k}>
                <code>{k}</code>
                <span>{v}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="zh-modal__footer">
          <button type="button" className="zh-btn-plain" onClick={onOpenShortcuts}>
            自定义快捷键
          </button>
          <button type="button" className="zh-btn-solid" onClick={onClose}>
            知道了
          </button>
        </div>
      </div>
    </div>
  )
}
