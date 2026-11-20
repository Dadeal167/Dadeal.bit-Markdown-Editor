import { useDeferredValue, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { Editor } from '@tiptap/core'
import { findMatches, replaceTextMatches, scrollToMatch, searchableDocument, setSearch, snippetOf } from './search'
import { docLabel, type Doc } from './documents'

interface Props {
  editor: Editor | null
  open: boolean
  docs: Doc[]
  currentId: string
  onSwitch(id: string): boolean
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
export default function SearchBox({ editor, open, docs, currentId, onSwitch, onClose }: Props) {
  const [query, setQuery] = useState('')
  const [current, setCurrent] = useState(0)
  const [replacing, setReplacing] = useState(false)
  const [replacement, setReplacement] = useState('')
  const [message, setMessage] = useState('')
  const [allDocs, setAllDocs] = useState(false)
  const deferredQuery = useDeferredValue(query)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)

  const subscribe = useMemo(() => (refresh: () => void) => {
    if (!editor || !open) return () => {}
    editor.on('transaction', refresh)
    return () => { editor.off('transaction', refresh) }
  }, [editor, open])
  const doc = useSyncExternalStore(subscribe, () => editor && open ? editor.state.doc : null)
  const matches = useMemo(() => doc && !allDocs ? findMatches(doc, query) : [], [doc, query, allDocs])
  const hasTextMatch = useMemo(() => replacing && doc !== null && findMatches(doc, query, 1, false).length > 0,
    [doc, query, replacing])
  const total = matches.length
  const safe = total ? Math.min(current, total - 1) : 0
  const documentResults = useMemo(() => {
    const keyword = deferredQuery.trim()
    if (!open || !allDocs || !editor || !keyword) return []
    const results = []
    for (const item of docs) {
      const label = docLabel(item)
      const titleMatch = label.toLocaleLowerCase().includes(keyword.toLocaleLowerCase())
      const body = item.id === currentId ? doc : searchableDocument(editor, item)
      const matches = body ? findMatches(body, keyword, 1) : []
      if (titleMatch || matches.length) results.push({ id: item.id, label, match: matches[0] })
    }
    return results
  }, [open, allDocs, editor, deferredQuery, docs, currentId, doc])

  // 打开时清空并聚焦（每次打开都是新的一次搜索）
  useEffect(() => {
    if (!open) return
    setQuery('')
    setCurrent(0)
    setReplacing(false)
    setReplacement('')
    setMessage('')
    setAllDocs(false)
    editor && setSearch(editor, { query: '', current: 0 })
    const t = window.setTimeout(() => inputRef.current?.focus(), 30)
    return () => window.clearTimeout(t)
  }, [open, editor])

  // 关键词或当前项变了：同步给插件（重画高亮）并把当前命中滚进视野
  useEffect(() => {
    if (!editor || !open) return
    setSearch(editor, { query: allDocs ? '' : query, current: safe })
    if (!allDocs) scrollToMatch(editor, matches[safe])
  }, [editor, open, query, safe, matches, allDocs])

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
    setCurrent((c) => (Math.min(c, total - 1) + delta + total) % total)
  }

  const replace = (all: boolean) => {
    if (!editor || editor.isDestroyed) return
    const targets = all ? findMatches(editor.state.doc, query, Infinity, false) : findMatches(editor.state.doc, query).slice(safe, safe + 1)
    const count = replaceTextMatches(editor, targets, replacement)
    setMessage(count ? `已替换 ${count} 处，可撤销。` : '无可替换的文字。')
  }

  const canReplace = matches[safe]?.kind === 'text' && matches[safe].text !== replacement
  const openResult = (result: typeof documentResults[number]) => {
    if (!onSwitch(result.id)) return
    if (result.match) {
      setAllDocs(false)
      setCurrent(0)
    } else onClose()
  }

  return (
    <div className="zh-search" role="search" onKeyDown={(event) => {
      if (event.key === 'Escape' && !event.nativeEvent.isComposing) {
        event.preventDefault()
        event.stopPropagation()
        onClose()
      }
    }}>
      <div className="zh-search__row">
        <input
          ref={inputRef}
          className="zh-search__input"
          type="text"
          value={query}
          placeholder={allDocs ? '搜索标题、正文或公式' : '搜索当前文档（Enter 跳至下一项）'}
          aria-label="搜索文档内容"
          onChange={(e) => {
            setQuery(e.target.value)
            setCurrent(0)
            setMessage('')
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
              e.preventDefault()
              if (allDocs && documentResults[0] && deferredQuery === query) openResult(documentResults[0])
              else if (!allDocs) go(e.shiftKey ? -1 : 1)
            }
          }}
        />
        <span className="zh-search__count" aria-live="polite">
          {query.trim() && (allDocs
            ? deferredQuery === query && `${documentResults.length} 篇`
            : total ? `${safe + 1}/${total}` : '无匹配结果')}
        </span>
        {/* 这三个按钮都要 preventDefault 掉 mousedown：不然点一下焦点就跑到按钮上，
            接着想改关键词还得再点回输入框。preventDefault 不影响 onClick。 */}
        {!allDocs && <><button
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
        </button></>}
        <button type="button" className="zh-search__btn" onClick={onClose} title="关闭（Esc）" aria-label="关闭搜索">
          ✕
        </button>
      </div>

      <div className="zh-search__replace">
        <div className="zh-search__row">
          <button type="button" className="zh-search__action" aria-pressed={allDocs} onClick={() => {
            setAllDocs(!allDocs)
            setReplacing(false)
            setCurrent(0)
            setMessage('')
            inputRef.current?.focus()
          }}>全部文档</button>
          {!allDocs && <button type="button" className="zh-search__action" aria-expanded={replacing}
            onClick={() => { setReplacing(!replacing); setMessage('') }}>替换文字</button>}
        </div>
        {replacing && (
          <>
            <div className="zh-search__row">
              <input className="zh-search__input zh-search__replacement" type="text" aria-label="替换为" placeholder="替换为（留空则删除）"
                value={replacement} onChange={(event) => { setReplacement(event.target.value); setMessage('') }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.nativeEvent.isComposing && canReplace) {
                    event.preventDefault()
                    replace(false)
                  }
                }} />
              <button type="button" className="zh-search__action" disabled={!canReplace} onClick={() => replace(false)}>替换当前</button>
              <button type="button" className="zh-search__action" disabled={!hasTextMatch} onClick={() => replace(true)}>全部替换文字</button>
            </div>
            {(message || matches[safe]?.kind === 'formula') && (
              <div className="zh-search__feedback" role="status">{message || '请在正文中编辑公式。'}</div>
            )}
          </>
        )}
      </div>

      {/* 结果列表：每条显示命中处的原文，点一下跳过去 */}
      {allDocs && query.trim() && deferredQuery === query && documentResults.length > 0 && (
        <div className="zh-search__list" role="group" aria-label="跨文档搜索结果">
          {documentResults.map((result) => (
            <button key={result.id} type="button" className="zh-search__item zh-search__doc"
              onClick={() => openResult(result)}>
              <strong>{result.label}</strong>
              {result.match && <span className="zh-search__text">
                {result.match.before}<mark className="zh-search__hit">{result.match.text}</mark>{result.match.after}
              </span>}
            </button>
          ))}
        </div>
      )}
      {!allDocs && query.trim() && total > 0 && (
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
              onClick={() => setCurrent(i)}
              title={snippetOf(m)}
            >
              <span className="zh-search__idx">{i + 1}</span>
              <span className="zh-search__text">
                {m.before}
                <mark className="zh-search__hit">{m.text}</mark>
                {m.after}
              </span>
            </button>
          ))}
          {total > MAX_LISTED && (
            <div className="zh-search__more">还有 {total - MAX_LISTED} 处。按 Enter 定位后续结果。</div>
          )}
        </div>
      )}
    </div>
  )
}
