import { useMemo, useState } from 'react'
import { SYMBOL_CATEGORIES, type SymbolItem } from './symbolData'

const RECENT_KEY = 'md-editor-recent-math-symbols-v1'
const RECENT_LIMIT = 12
const SYMBOLS = SYMBOL_CATEGORIES.flatMap((category) => category.sections.flatMap((section) => section.items))
const symbolKey = (item: SymbolItem) => `${item.latex}\n${item.label}`
const itemsByKey = new Map(SYMBOLS.map((item) => [symbolKey(item), item]))

function loadRecent(): SymbolItem[] {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]')
    if (Array.isArray(saved)) {
      return saved.slice(0, RECENT_LIMIT).flatMap((key) => {
        const item = itemsByKey.get(key)
        return item ? [item] : []
      })
    }
  } catch {
    // 私密浏览时仍可使用本次会话的最近记录。
  }
  return []
}

function searchSymbols(query: string): SymbolItem[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (!terms.length) return []
  return SYMBOLS.filter(({ label, latex }) => {
    const haystack = `${label} ${latex}`.toLowerCase()
    return terms.every((term) => haystack.includes(term))
  })
}

interface Props {
  category: string | null
  faces: ReadonlyMap<string, string>
  onClose(): void
  onPick(latex: string): void
}

export default function SymbolPicker({ category, faces, onClose, onPick }: Props) {
  const [query, setQuery] = useState('')
  const [recent, setRecent] = useState(loadRecent)
  const matches = useMemo(() => category === 'search' ? searchSymbols(query) : [], [category, query])

  if (!category) return null

  const pick = (item: SymbolItem) => {
    const key = symbolKey(item)
    const next = [item, ...recent.filter((entry) => symbolKey(entry) !== key)].slice(0, RECENT_LIMIT)
    setRecent(next)
    try {
      localStorage.setItem(RECENT_KEY, JSON.stringify(next.map(symbolKey)))
    } catch {
      // 最近记录仍可在本次会话使用。
    }
    setQuery('')
    onPick(item.latex)
    onClose()
  }

  const searching = category === 'search'
  const sections = searching
    ? [{ title: query.trim() ? `搜索结果（${matches.length}）` : '最近使用', items: query.trim() ? matches : recent }]
    : SYMBOL_CATEGORIES.find((entry) => entry.key === category)?.sections ?? []

  return (
    <div className="zh-mathpanel">
      <button type="button" className="zh-mathpanel__close" aria-label="关闭符号面板" onClick={onClose}>✕</button>
      {searching && (
        <input className="zh-math-symbol-search" type="search" autoFocus value={query}
          aria-label="搜索公式符号" placeholder="输入中文名或 TeX 命令"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return
            if (event.key === 'Escape') {
              event.stopPropagation()
              onClose()
            }
            if (event.key === 'Enter' && matches[0]) pick(matches[0])
          }} />
      )}
      {sections.map((section) => (
        <div className="zh-mathsec" key={section.title}>
          <div className="zh-mathsec__title">{section.title}</div>
          {section.items.length === 0 && (
            <p className="zh-math-symbol-empty">{query.trim() ? '未找到匹配符号。' : '暂无使用记录。'}</p>
          )}
          <div className="zh-mathsec__grid">
            {section.items.map((item) => (
              <button key={symbolKey(item)} type="button" className="zh-symbol"
                title={`${item.label}　${item.latex}`} aria-label={item.label} data-latex={item.latex}
                onClick={() => pick(item)}
                dangerouslySetInnerHTML={{ __html: faces.get(item.face) ?? item.label }} />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
