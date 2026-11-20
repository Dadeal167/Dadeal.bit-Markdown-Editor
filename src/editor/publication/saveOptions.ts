export type SaveFormat = 'zhihu' | 'html' | 'pdf' | 'docx' | 'plain' | 'local' | 'copy' | 'zip' | 'publication' | 'editions'

export interface SaveFormatItem {
  key: SaveFormat
  label: string
  hint: string
}

const SAVE_FORMATS: SaveFormatItem[] = [
  { key: 'zhihu', label: '导出知乎用 Markdown（.md）', hint: '转换公式格式，并为内嵌图片生成可供知乎读取的链接。' },
  { key: 'html', label: '导出网页（.html）', hint: '导出包含内嵌图片的离线网页。' },
  { key: 'pdf', label: '另存为 PDF', hint: '在打印对话框中选择「另存为 PDF」。' },
  ...(__BUILD_MODE__ === 'effect' ? [
    { key: 'docx' as const, label: '导出 Word（.docx）', hint: '导出可在 Word 中继续编辑的文档。' },
    { key: 'publication' as const, label: 'Word 与 PDF 排版', hint: '选择讲义、试题解析模板或自定义页面。' },
    { key: 'editions' as const, label: '一稿多版', hint: '预览并导出学生版、教师版或知乎版。' },
    { key: 'zip' as const, label: '导出 Markdown 与图片（.zip）', hint: '将 Markdown 文档与本地图片打包，保留动图。' },
  ] : []),
  {
    key: 'plain',
    label: '导出 Markdown 存档（.md）',
    hint: 'Markdown 文件内嵌本地图片，适用于本地阅读和备份。',
  },
]

const LOCAL_FORMATS: SaveFormatItem[] = [
  { key: 'local', label: '保存到原文件', hint: '将当前正文写回已打开的本地文件。' },
  { key: 'copy', label: '另存 Markdown 副本', hint: '如有相对图片路径，请将副本存放在原文档所在文件夹。' },
]

function availableSaveFormats(hasLocalFile: boolean): SaveFormatItem[] {
  return hasLocalFile ? [...LOCAL_FORMATS, ...SAVE_FORMATS] : SAVE_FORMATS
}

export function saveFormatSections(hasLocalFile: boolean) {
  const formats = availableSaveFormats(hasLocalFile)
  return __BUILD_MODE__ === 'effect' ? [
    { label: '本地文件与备份', keys: ['local', 'copy', 'plain', 'zip'] },
    { label: 'Word 与 PDF', keys: ['editions', 'publication', 'docx', 'pdf'] },
    { label: '网页与发布', keys: ['html', 'zhihu'] },
  ].map((section) => ({ label: section.label, items: section.keys.flatMap((key) => formats.filter((item) => item.key === key)) }))
    .filter((section) => section.items.length) : [{ label: '', items: formats }]
}
