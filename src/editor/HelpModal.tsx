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
  ...(__BUILD_MODE__ === 'effect' ? [['toolbarOrb', '显示悬浮球'] as [string, string]] : []),
  ...(__BUILD_MODE__ === 'effect' ? [['readingMode', '切换阅读模式'] as [string, string]] : []),
  ...(__BUILD_MODE__ === 'effect' ? [['tools', '搜索功能'] as [string, string]] : []),
  ['shortcuts', '快捷键设置'],
]

const TIPS: [string, string][] = [
  ...(__BUILD_MODE__ === 'effect' ? [[
    '工具栏显示', '在「界面」中选择顶部工具栏或透明悬浮球。悬浮球空闲 3 秒后隐藏，使用「显示悬浮球」快捷键重新显示（可在快捷键设置中修改）。点击悬浮球展开工具栏，点击正文收起；支持拖动和重置位置。',
  ] as [string, string]] : []),
  ['公式', '在「公式」面板中选择符号或直接输入 TeX。'],
  ['编辑公式', '选择正文中的公式以打开编辑面板。'],
  ['图片', '通过「图片」导入文件，或使用 Ctrl+V 粘贴截图。'],
  ['视频', '在「视频」中输入哔哩哔哩或 YouTube 链接。'],
  ['表格', '进入单元格后，可在工具条中添加行列或删除表格。'],
  ['搜索', '按 Ctrl+F 搜索当前文档，或选择「全部文档」搜索标题、正文和公式。'],
  ['使用时长', '状态栏显示本次使用时长。'],
  ['Markdown 输入', '启用后，输入或粘贴的 Markdown 会转换为富文本。'],
  ['自动保存', '文档保存到当前浏览器。可在「文档」菜单中备份或恢复。'],
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
            <span className="zh-modal__sub">快捷键与使用说明</span>
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
          <div className="zh-help__section">使用说明</div>
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
            关闭
          </button>
        </div>
      </div>
    </div>
  )
}
