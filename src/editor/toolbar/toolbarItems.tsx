import type { ReactNode } from 'react'
import type { EditorApi } from '../types'
import type { ScholarTab } from '../ScholarTools'
import { displayKey, shortcuts } from '../shortcuts'
import { saveFormatSections, type SaveFormat } from '../publication/saveOptions'
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
  IconSearch,
  IconSpark,
  IconTable,
  IconTheme,
  IconUL,
  IconUndo,
  IconVideo,
} from '../icons'

export interface ToolbarHandlers {
  openFormula(): void
  openTable(): void
  openLink(): void
  openVideo(): void
  openHelp(): void
  openShortcuts(): void
  /** 「更多 → 使用反馈」：打开反馈弹窗（里面能一键发邮件给作者） */
  openFeedback(): void
  /** 打开搜索框（工具栏「搜索」与 Ctrl+F 都走它） */
  openSearch(): void
  /** 打开「存到知乎草稿箱」面板 */
  openZhihu(): void
  pickImage(): void
  /** 体检当前文档：图片打不开 / 公式渲染不出来 */
  checkDocument(): void
  openDocumentFolder?: () => void
  openWorkspace?: () => void
  openMarkdownSource?: () => void
  toggleWritingFocus?: () => void
  toggleReadingMode?: () => void
  markEditionBlock?: () => void
  openEquationTools?: () => void
  openObjectTools?: () => void
  openAssetManager?: () => void
  openExportPreflight?: () => void
  openMacroDefinitions?: () => void
  insertMermaidDiagram?: () => void
  openScholarTools?: (tab: ScholarTab) => void
  writingFocus?: boolean
  /** 公式不对时导出诊断包（每个公式存着的写法 + 操作历史），发给作者定位 */
  exportMathDiag(): void
}

export interface ToolbarItem {
  key: string
  label: string
  icon?: ReactNode
  /** 鼠标提示，缺省用 label */
  title?: string
  /** 自定义节点（表格里放下拉面板用），给了就直接渲染它 */
  render?: ReactNode
  /** 菜单项前面显示一个颜色小圆点（特效配色用），值是 "r,g,b" */
  swatch?: string
  onClick?: () => void
  menu?: ToolbarItem[]
  active?: boolean
  section?: string
  keywords?: string
  shortcut?: string
  searchable?: boolean
}


export type ToolbarMode = 'bar' | 'orb'

interface Options {
  api: EditorApi
  handlers: ToolbarHandlers
  mode: ToolbarMode
  changeMode(mode: ToolbarMode): void
  revealOrb(): void
  resetPosition(): void
  typographyMenu?: ReactNode
  saveMenu?: ReactNode
  effectPanel?: ReactNode
  onOpenEffects?: () => void
  onSaveAction(format: SaveFormat): void
  hasLocalFile: boolean
}

export function toolbarGroups({ api, handlers, mode, changeMode, revealOrb, resetPosition, typographyMenu,
  saveMenu, effectPanel, onOpenEffects, onSaveAction, hasLocalFile }: Options): ToolbarItem[][] {
  const section = (name: string, items: ToolbarItem[]): ToolbarItem[] => items.map((item) => ({
    ...item, ...(__BUILD_MODE__ === 'effect' ? { section: name } : {}),
  }))
  const headings: ToolbarItem[] = [
    { key: 'h1', label: '一级标题', shortcut: 'h1', onClick: () => api.setHeading(1) },
    { key: 'h2', label: '二级标题', shortcut: 'h2', onClick: () => api.setHeading(2) },
    { key: 'h3', label: '三级标题', shortcut: 'h3', onClick: () => api.setHeading(3) },
    { key: 'p', label: '正文', shortcut: 'paragraph', onClick: () => api.setParagraph() },
  ]
  const lists: ToolbarItem[] = [
    { key: 'ul', label: '无序列表', shortcut: 'bulletList', onClick: () => api.toggleList() },
    { key: 'ol', label: '有序列表', shortcut: 'orderedList', onClick: () => api.toggleOrderedList() },
  ]
  const blockFormats: ToolbarItem[] = [
    { key: 'quote', label: '引用', shortcut: 'quote', keywords: '引用块 blockquote', icon: <IconQuote />, onClick: () => api.toggleQuote() },
    { key: 'code', label: '代码块', shortcut: 'codeBlock', icon: <IconCode />, onClick: () => api.toggleCodeBlock() },
    { key: 'clear', label: '清除格式', shortcut: 'clearFormat', icon: <IconClearFormat />, onClick: () => api.clearFormat() },
  ]
  const insert: ToolbarItem[] = [
    { key: 'image', label: '图片', shortcut: 'image', keywords: '插入图片 照片', icon: <IconImage />, onClick: handlers.pickImage },
    { key: 'math', label: '公式', shortcut: 'formula', keywords: '插入公式 LaTeX 数学', icon: <IconFormula />, onClick: handlers.openFormula },
    { key: 'table', label: '表格', shortcut: 'table', keywords: '插入表格', icon: <IconTable />, onClick: handlers.openTable },
    { key: 'link', label: '链接', shortcut: 'link', keywords: '插入链接 超链接', icon: <IconLink />, onClick: handlers.openLink },
    { key: 'video', label: '视频', keywords: '插入视频 bilibili YouTube', icon: <IconVideo />, onClick: handlers.openVideo },
    { key: 'hr', label: '分割线', icon: <IconHr />, onClick: () => api.insertHr() },
  ]
  const theme: ToolbarItem[] = [
    { key: 'light', label: '浅色', onClick: () => api.setTheme('light'), active: api.theme === 'light' },
    { key: 'dark', label: '深色', onClick: () => api.setTheme('dark'), active: api.theme === 'dark' },
    { key: 'system', label: '跟随系统', onClick: () => api.setTheme('system'), active: api.theme === 'system' },
  ]
  const outline: ToolbarItem = { key: 'outline', label: '大纲', shortcut: 'outline', icon: <IconOutline />, onClick: () => api.toggleOutline() }
  const searchDocument: ToolbarItem = { key: 'search', label: '搜索', icon: <IconSearch />, keywords: '查找 查找替换 搜索正文', onClick: handlers.openSearch }
  const zhihu: ToolbarItem = { key: 'zhihu', label: '知乎', icon: <span className="zh-glyph">知</span>, onClick: handlers.openZhihu }
  const readingMode = handlers.toggleReadingMode
    ? [{ key: 'reading-mode', label: '阅读模式', shortcut: 'readingMode', keywords: '只读 沉浸', onClick: handlers.toggleReadingMode }] : []
  const openMarkdown: ToolbarItem = { key: 'open', label: '打开', icon: <IconOpen />, onClick: () => api.openMarkdownFile() }
  const fileActions: ToolbarItem[] = [
    openMarkdown,
    { key: 'save', label: '保存', render: saveMenu },
  ]
  const undoActions: ToolbarItem[] = [
    { key: 'undo', label: '撤销', icon: <IconUndo />, onClick: () => api.undo() },
    { key: 'redo', label: '重做', icon: <IconRedo />, onClick: () => api.redo() },
  ]
  const inlineFormats: ToolbarItem[] = [
    { key: 'bold', label: '加粗', keywords: '粗体 bold', icon: <span className="zh-glyph zh-glyph--b">B</span>, onClick: () => api.toggleBold() },
    { key: 'italic', label: '斜体', keywords: '倾斜 italic', icon: <span className="zh-glyph zh-glyph--i">I</span>, onClick: () => api.toggleItalic() },
  ]
  const typography: ToolbarItem[] = typographyMenu ? [{ key: 'typography', label: '字体', render: typographyMenu }] : []
  const appearance: ToolbarItem = { key: 'theme', label: '主题', icon: <IconTheme />, menu: theme }
  const toolbarModeItems: ToolbarItem[] = [
      { key: 'toolbar-bar', label: '顶部工具栏', active: mode === 'bar', onClick: () => changeMode('bar') },
      { key: 'toolbar-orb', label: '透明悬浮球', active: mode === 'orb', onClick: () => changeMode('orb') },
      ...(mode === 'orb' ? [
        { key: 'toolbar-orb-show', label: `显示悬浮球（${displayKey(shortcuts.bindings().toolbarOrb)}）`, onClick: revealOrb },
        { key: 'toolbar-orb-reset', label: '重置悬浮球位置', onClick: () => { resetPosition(); revealOrb() } },
      ] : []),
  ]
  const interfaceMenu: ToolbarItem = {
    key: 'interface', label: '界面', icon: <span className="zh-glyph">◉</span>,
    menu: [...toolbarModeItems.slice(0, 2), ...readingMode, ...toolbarModeItems.slice(2)],
  }
  const more: ToolbarItem = {
    key: 'more', label: __BUILD_MODE__ === 'effect' ? '工具' : '更多', title: '更多', icon: <IconMore />,
    searchable: __BUILD_MODE__ === 'effect',
    menu: [
      ...section('文档与工作区', [
        ...(__BUILD_MODE__ === 'effect' ? [{ key: 'new-doc', label: '新建文档', shortcut: 'newDoc', onClick: () => shortcuts.run('newDoc') }] : []),
        ...(__BUILD_MODE__ === 'effect' ? [{ ...openMarkdown, label: '打开 Markdown 文件', keywords: '导入 本地文档' }] : []),
        ...(handlers.openDocumentFolder ? [{ key: 'open-folder', label: '打开文档文件夹', onClick: handlers.openDocumentFolder }] : []),
        ...(handlers.openWorkspace ? [{ key: 'open-workspace', label: '本地工作区', keywords: '反向链接 文件树', onClick: handlers.openWorkspace }] : []),
        ...(handlers.openMarkdownSource ? [{ key: 'markdown-source', label: '编辑 Markdown 源码', keywords: '原文 校对 source', onClick: handlers.openMarkdownSource }] : []),
      ]),
      ...section('写作与学术', [
        ...(handlers.markEditionBlock ? [{ key: 'edition-block', label: '标记提示、答案或解析', keywords: '分版 学生版 试题', onClick: handlers.markEditionBlock }] : []),
        ...(handlers.openEquationTools ? [{ key: 'equation-tools', label: '公式编号与引用', keywords: '交叉引用 编号 标签', onClick: handlers.openEquationTools }] : []),
        ...(handlers.openMacroDefinitions ? [{ key: 'latex-macros', label: 'LaTeX 宏定义', onClick: handlers.openMacroDefinitions }] : []),
        ...(handlers.insertMermaidDiagram ? [{ key: 'mermaid-diagram', label: '插入 Mermaid 图表', keywords: '流程图', onClick: handlers.insertMermaidDiagram }] : []),
        ...(handlers.openScholarTools ? [
          { key: 'footnotes', label: '脚注', onClick: () => handlers.openScholarTools?.('footnotes') },
          { key: 'citations', label: '参考文献', keywords: '引用 BibTeX 论文', onClick: () => handlers.openScholarTools?.('citations') },
          { key: 'statements', label: '数学结构块', keywords: '定理 证明 例题', onClick: () => handlers.openScholarTools?.('statements') },
        ] : []),
        ...(handlers.openObjectTools ? [{ key: 'object-tools', label: '图表题注与引用', onClick: handlers.openObjectTools }] : []),
      ]),
      ...(__BUILD_MODE__ === 'effect' ? section('保存与发布', [
        { ...zhihu, label: '知乎发布', keywords: '知乎 草稿' },
        ...saveFormatSections(hasLocalFile).flatMap(({ items }) => items).map((format) => ({
          key: 'save-' + format.key, label: format.label, keywords: format.hint, onClick: () => onSaveAction(format.key),
        })),
      ]) : []),
      ...section('检查与诊断', [
        ...(handlers.openAssetManager ? [{ key: 'asset-manager', label: '素材管理与断链修复', keywords: '本地图片 GIF 视频 重连', onClick: handlers.openAssetManager }] : []),
        ...(handlers.openExportPreflight ? [{ key: 'export-preflight', label: '导出前检查', keywords: '预检 审校', onClick: handlers.openExportPreflight }] : []),
        { key: 'check-doc', label: '检查图片与公式（自动修复公式）', keywords: '公式修复 文档体检', onClick: handlers.checkDocument },
        { key: 'math-diag', label: '导出公式诊断', onClick: handlers.exportMathDiag },
      ]),
      ...section('视图与快捷键', [
        ...readingMode,
        ...(__BUILD_MODE__ === 'effect' ? [outline, { ...searchDocument, label: '搜索正文' }] : []),
        ...(__BUILD_MODE__ === 'effect' ? [
          ...(effectPanel && onOpenEffects ? [{ key: 'effects', label: '动态壁纸与鼠标特效', keywords: '背景 Wallpaper Engine 材质', onClick: onOpenEffects }] : []),
          ...theme.map((item) => ({ ...item, label: item.label + '主题' })),
          ...toolbarModeItems,
        ] : []),
        ...(handlers.toggleWritingFocus ? [{ key: 'writing-focus', label: handlers.writingFocus ? '退出专注模式' : '专注模式', onClick: handlers.toggleWritingFocus }] : []),
        { key: 'fullscreen', label: '全屏', shortcut: 'fullscreen', onClick: () => api.toggleFullscreen() },
        { key: 'help', label: '快捷键帮助', onClick: handlers.openHelp },
        { key: 'shortcuts', label: '自定义快捷键', shortcut: 'shortcuts', onClick: handlers.openShortcuts },
      ]),
      ...(__BUILD_MODE__ === 'effect' ? section('格式与插入', [...headings, ...inlineFormats, ...lists, ...blockFormats, ...insert]) : []),
      ...section('帮助与维护', [
        { key: 'feedback', label: '使用反馈（发邮件给作者）', onClick: handlers.openFeedback },
        { key: 'reset-doc', label: '重置当前文档为示例内容', onClick: () => api.resetCurrentDoc() },
      ]),
    ],
  }
  const effects: ToolbarItem[] = __NO_MOUSE_EFFECT__ || !effectPanel ? []
    : [{ key: 'effect', label: '特效', icon: <IconSpark />, render: effectPanel }]
  const compactGroups: ToolbarItem[][] = [
    fileActions,
    [...undoActions, ...inlineFormats,
      { key: 'format', label: '格式', icon: <span className="zh-glyph">¶</span>, menu: [...headings, ...lists, ...blockFormats] },
      ...typography],
    [...insert.slice(0, 2), { key: 'insert', label: '插入', icon: <span className="zh-glyph">＋</span>, menu: insert.slice(2) }],
    [outline, searchDocument, zhihu],
    [appearance, ...effects, interfaceMenu, more],
  ]
  const pureGroups: ToolbarItem[][] = [
    fileActions,
    [...undoActions, blockFormats[2]],
    [{ key: 'h', label: '标题', icon: <span className="zh-glyph">H</span>, menu: headings }, ...inlineFormats, ...typography],
    [{ key: 'list', label: '列表', icon: <IconUL />, menu: lists }, blockFormats[0], insert[5], blockFormats[1]],
    [insert[0], insert[4], insert[3], insert[1], insert[2]],
    [outline, searchDocument, appearance, ...effects, zhihu, more],
  ]
  return __BUILD_MODE__ === 'effect' ? compactGroups : pureGroups
}
