import { useEffect, useMemo, useRef, useState } from 'react'
import type { Editor } from '@tiptap/core'
import { findMatches, scrollToMatch, setSearch, snippetOf } from './search'

interface Props {
  editor: Editor | null
  open: boolean
  onClose(): void
}

/** 结果列表最多列几条（再多就靠回车/箭头跳，列表只用来"看一眼是哪几处"） */
const MAX_LISTED = 50

/**
 * 搜索框（右上角浮出）：输入即搜、回车下一条、Shift+回车上一条、Esc 关掉。
 *
 * 为什么不用浏览器自带的 Ctrl+F：它找不到"编辑器内部"的块（公式/代码块会跳过），
 * 也没法把命中滚到视野中间。这里用编辑器自己的文档模型搜，全都能找。
 *
 * 下面还挂一个**结果列表**：每条把命中那段原文连同前后文完整显示出来，
 * 点一下就跳过去。只给「3/17」这种序号是看不出哪一处在哪儿的。
 */
export default function SearchBox({ editor, open, onClose }: Props) {
  const [query, setQuery] = useState('')
  const [current, setCurrent] = useState(0)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)

  const matches = useMemo(() => (editor && open ? findMatches(editor.state.doc, query) : []), [editor, open, query])
  const total = matches.length
  const safe = total ? Math.min(current, total - 1) : 0

  // 打开时清空并聚焦（每次打开都是新的一次搜索）
  useEffect(() => {
    if (!open) return
    setQuery('')
    setCurrent(0)
    editor && setSearch(editor, { query: '', current: 0 })
    const t = window.setTimeout(() => inputRef.current?.focus(), 30)
    return () => window.clearTimeout(t)
  }, [open, editor])

  // 关键词或当前项变了：同步给插件（重画高亮）并把当前命中滚进视野
  useEffect(() => {
    if (!editor || !open) return
    setSearch(editor, { query, current: safe })
    scrollToMatch(editor, matches[safe])
  }, [editor, open, query, safe, matches])

  /* 当前那条在列表里跟着滚 —— 用回车翻的时候，列表得自己跟上，
     否则翻到第 20 条时列表还停在开头，看不出跳到哪了 */
  useEffect(() => {
    if (!open || !total) return
    const box = listRef.current
    const item = box?.querySelector<HTMLElement>(`[data-idx="${safe}"]`)
    item?.scrollIntoView({ block: 'nearest' })
  }, [open, safe, total])

  // 关掉时清掉高亮，别让黄色底色留在正文里
  useEffect(() => {
    if (!editor) return
    if (!open) setSearch(editor, { query: '', current: 0 })
  }, [editor, open])

  if (!open) return null

  const go = (delta: number) => {
    if (!total) return
    setCurrent((c) => (c + delta + total) % total)
  }

  return (
    <div className="zh-search" role="search">
      <div className="zh-search__row">
        <input
          ref={inputRef}
          className="zh-search__input"
          type="text"
          value={query}
          placeholder="搜文档里的字…（回车下一条）"
          aria-label="搜索文档内容"
          onChange={(e) => {
            setQuery(e.target.value)
            setCurrent(0)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              go(e.shiftKey ? -1 : 1)
            } else if (e.key === 'Escape') {
              e.preventDefault()
              onClose()
            }
          }}
        />
        <span className="zh-search__count" aria-live="polite">
          {query.trim() ? (total ? `${safe + 1}/${total}` : '没找到') : ''}
        </span>
        {/* 这三个按钮都要 preventDefault 掉 mousedown：不然点一下焦点就跑到按钮上，
            接着想改关键词还得再点回输入框。preventDefault 不影响 onClick。 */}
        <button
          type="button"
          className="zh-search__btn"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => go(-1)}
          disabled={!total}
          title="上一条（Shift+回车）"
        >
          ↑
        </button>
        <button
          type="button"
          className="zh-search__btn"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => go(1)}
          disabled={!total}
          title="下一条（回车）"
        >
          ↓
        </button>
        <button type="button" className="zh-search__btn" onClick={onClose} title="关闭（Esc）" aria-label="关闭搜索">
          ✕
        </button>
      </div>

      {/* 结果列表：每条显示命中处的原文，点一下跳过去 */}
      {query.trim() && total > 0 && (
        <div className="zh-search__list" ref={listRef} role="listbox" aria-label="搜索结果">
          {matches.slice(0, MAX_LISTED).map((m, i) => (
            <button
              key={`${m.from}-${i}`}
              type="button"
              data-idx={i}
              role="option"
              aria-selected={i === safe}
              className={`zh-search__item${i === safe ? ' zh-search__item--current' : ''}`}
              /* 用 mousedown 而不是 click：click 会先把焦点从搜索框拿走，
                 再点就没法继续在输入框里改关键词了 */
              onMouseDown={(e) => {
                e.preventDefault()
                setCurrent(i)
              }}
              title={snippetOf(m, query)}
            >
              <span className="zh-search__idx">{i + 1}</span>
              <span className="zh-search__text">
                {m.before}
                <mark className="zh-search__hit">{query.trim()}</mark>
                {m.after}
              </span>
            </button>
          ))}
          {total > MAX_LISTED && (
            <div className="zh-search__more">还有 {total - MAX_LISTED} 处，用回车继续往下跳</div>
          )}
        </div>
      )}
    </div>
  )
}
