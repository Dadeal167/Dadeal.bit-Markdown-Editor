import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { IconSearch } from '../icons'
import { displayKey, shortcuts } from '../shortcuts'
import { useAnchoredMenu } from '../useAnchoredMenu'
import type { ToolbarItem } from './toolbarItems'

export default function ToolbarButton({ item, open, onOpenChange, afterClick }: {
  item: ToolbarItem; open: boolean; onOpenChange(open: boolean): void; afterClick(): void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const search = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [current, setCurrent] = useState(0)
  const queryWords = query.normalize('NFKC').trim().toLowerCase().split(/\s+/).filter(Boolean)
  const matching = (open ? item.menu ?? [] : []).filter((entry) => {
    const text = `${entry.label} ${entry.section ?? ''} ${entry.keywords ?? ''}`.normalize('NFKC').toLowerCase()
    return queryWords.every((word) => text.includes(word))
  })
  const sections = [...new Set(matching.map((entry) => entry.section ?? ''))].map((label) => ({
    label, items: matching.filter((entry) => (entry.section ?? '') === label),
  }))
  const selected = matching[Math.min(current, matching.length - 1)]
  useAnchoredMenu(open, ref, menu)

  useLayoutEffect(() => {
    if (!open) { setQuery(''); setCurrent(0) }
    else if (item.searchable) search.current?.focus({ preventScroll: true })
  }, [open, item.searchable])

  useEffect(() => {
    if (!open) return
    const close = (event: PointerEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) onOpenChange(false)
    }
    const esc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.isComposing) return
      if (item.searchable && ref.current?.contains(document.activeElement)) afterClick()
      onOpenChange(false)
    }
    document.addEventListener('pointerdown', close)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('pointerdown', close)
      document.removeEventListener('keydown', esc)
    }
  }, [afterClick, item.searchable, onOpenChange, open])

  const run = (command: ToolbarItem) => {
    onOpenChange(false)
    command.onClick?.()
    afterClick()
  }

  return (
    <div className="zh-tb-wrap" ref={ref}>
      <button
        type="button"
        className={`zh-btn${item.active ? ' zh-btn--active' : ''}`}
        title={item.title ?? item.label}
        aria-expanded={item.menu ? open : undefined}
        // 阻止 mousedown 默认行为：保持编辑器焦点与选区不被抢走
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          if (item.menu) {
            onOpenChange(!open)
          } else {
            run(item)
          }
        }}
      >
        {item.icon}
        <span className="zh-btn__label">{item.label}</span>
      </button>
      {item.menu && open && (
        <div ref={menu} className={`zh-menu${item.menu.some((entry) => entry.section) ? ' zh-menu--organized' : ''}`}>
          {item.searchable && <div className="zh-command-search">
            <IconSearch />
            <input ref={search} type="search" aria-label="搜索功能" aria-description="方向键选择，Enter 执行，Esc 关闭"
              placeholder="搜索功能，例如公式、分版、Word" value={query}
              onChange={(event) => { setQuery(event.target.value); setCurrent(0) }}
              onKeyDown={(event) => {
                if (event.nativeEvent.isComposing || !selected) return
                if (event.key === 'Enter') { event.preventDefault(); run(selected); return }
                if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
                event.preventDefault()
                const next = (matching.indexOf(selected) + (event.key === 'ArrowUp' ? -1 : 1) + matching.length) % matching.length
                setCurrent(next)
                menu.current?.querySelector(`[data-key="${matching[next].key}"]`)?.scrollIntoView({ block: 'nearest' })
              }} />
            {shortcuts.bindings().tools && <kbd>{displayKey(shortcuts.bindings().tools)}</kbd>}
          </div>}
          {item.searchable && !matching.length && <p className="zh-command-empty" role="status">没有匹配的功能。</p>}
          <div className={item.searchable ? 'zh-command-groups' : undefined}>
          {sections.map((section) => <div className="zh-menu__group" key={section.label} role="group"
            aria-label={section.label || undefined}>
            {section.label && <div className="zh-menu__section">{section.label}</div>}
            {section.items.map((m) => (
            <button
              key={m.key}
              type="button"
              className={`zh-menu__item${m.active ? ' zh-menu__item--on' : ''}`}
              data-key={m.key}
              data-current={item.searchable && m === selected || undefined}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => run(m)}
            >
              {m.swatch && <span className="zh-menu__swatch" style={{ background: `rgb(${m.swatch})` }} />}
              <span>{m.label}</span>
              {__BUILD_MODE__ === 'effect' && m.shortcut && shortcuts.bindings()[m.shortcut] &&
                <kbd aria-hidden="true">{displayKey(shortcuts.bindings()[m.shortcut])}</kbd>}
              {m.active && <span className="zh-menu__check">✓</span>}
            </button>
          ))}
          </div>)}
          </div>
        </div>
      )}
    </div>
  )
}
