import { NodeViewContent, NodeViewWrapper, type NodeViewProps } from '@tiptap/react'
import { useEffect, useRef, useState } from 'react'
import { AUTO_LABEL, CODE_LANGUAGES, languageLabel, resolveLanguage } from './codeLanguages'

/**
 * 代码块的语言选择器（挂在代码块自己头上，像 Notion / Typora 那样）。
 *
 * 为什么不用工具栏按钮：工具栏按钮有精确的数量断言（分享版 23 个 / 自用 24 个），
 * 而且语言是"这一块代码的属性"，长在块上最直观。
 *
 * 注意：这里渲染的东西（那行语言栏）**不属于文档内容** —— 导出 .md / .html 走的是
 * 文档序列化（renderHTML），所以导出结果里不会出现这行 UI。
 */
export default function CodeBlockView({ node, updateAttributes, editor }: NodeViewProps) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const language = (node.attrs.language as string | null) ?? null

  // 点外面 / 按 Esc 关掉
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const pick = (value: string | null) => {
    // 空值 = 不指定语言（Markdown 里就是没有语言标记的 ```），导出后由阅读器/知乎自己识别
    updateAttributes({ language: value })
    setOpen(false)
    editor.commands.focus()
  }

  const current = resolveLanguage(language)

  return (
    <NodeViewWrapper className="zh-codeblock" data-language={language ?? ''} ref={wrapRef}>
      <div className="zh-codeblock__bar" contentEditable={false}>
        <button
          type="button"
          className="zh-codeblock__lang"
          title="选代码语言（会按这门语言的语法上色）"
          aria-haspopup="menu"
          aria-expanded={open}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setOpen((v) => !v)}
        >
          {languageLabel(language)}
          <span className="zh-codeblock__caret" aria-hidden="true" />
        </button>
        {open && (
          <div className="zh-menu zh-codeblock__menu" role="menu">
            <button
              type="button"
              role="menuitemradio"
              aria-checked={current === null}
              className={`zh-menu__item zh-codeblock__item zh-codeblock__item--auto${current === null ? ' zh-codeblock__item--active' : ''}`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(null)}
            >
              {AUTO_LABEL}
            </button>
            <div className="zh-codeblock__sep" aria-hidden="true" />
            {CODE_LANGUAGES.map((l) => (
              <button
                key={l.value}
                type="button"
                role="menuitemradio"
                aria-checked={current === l.value}
                className={`zh-menu__item zh-codeblock__item${current === l.value ? ' zh-codeblock__item--active' : ''}`}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(l.value)}
              >
                {l.label}
              </button>
            ))}
          </div>
        )}
      </div>
      <pre>
        {/* 运行时支持任意标签；@tiptap/react 的类型这里只写了 'div'，所以转一下。
            用 <code> 是为了让 highlight.js 的 .hljs-* 样式和 .zh-prose code 的排版都照旧生效。 */}
        <NodeViewContent as={'code' as 'div'} />
      </pre>
    </NodeViewWrapper>
  )
}
