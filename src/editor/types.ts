import type { Editor } from '@tiptap/core'

declare global {
  interface Window {
    /** 仅供调试与探针脚本使用 */
    __EDITOR__?: Editor
    /** 取应用真正会保存的那份 Markdown（含必要的转义），测试脚本用这个 */
    __MD__?: () => string
  }
}

export interface OutlineItem {
  level: number
  text: string
  pos: number
}

export interface EditorApi {
  editor: Editor | null
  /** 把焦点交还编辑器（取当前实例，避免重建后拿到旧实例） */
  focus(): void

  /* 排版 */
  undo(): void
  redo(): void
  clearFormat(): void
  toggleBold(): void
  toggleItalic(): void
  setHeading(level: 1 | 2 | 3): void
  setParagraph(): void

  /* 块级 */
  toggleList(): void
  toggleOrderedList(): void
  toggleQuote(): void
  insertHr(): void
  toggleCodeBlock(): void

  /* 插入 */
  pickImage(): void
  openVideo(): void
  insertVideo(url: string): boolean
  openLink(): void
  insertLink(text: string, url: string): void
  openMath(): void
  openTable(): void
  insertTable(rows: number, cols: number): void

  /* 文件 */
  openMarkdownFile(): void
  saveMarkdownFile(): void
  exportHtmlFile(): void
  exportPdf(): void

  /* 视图 */
  toggleMarkdownInput(): void
  toggleOutline(): void
  toggleFullscreen(): void
  /** 当前主题：浅色 / 深色 / 跟随系统 */
  theme: 'light' | 'dark' | 'system'
  setTheme(theme: 'light' | 'dark' | 'system'): void
  /** 把当前文档内容重置成示例内容 */
  resetCurrentDoc(): void

  /** 当前 Markdown 源码 */
  getMarkdown(): string
}
