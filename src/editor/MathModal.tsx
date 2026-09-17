import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { friendlyMathHint } from './editorActions'
import { renderKatex } from './tiptap/MathNode'
import { SYMBOL_CATEGORIES } from './math/symbolData'
import { commandStart, suggestFor, type LatexSuggestion } from './math/latexSuggest'
import { useEscapeClose } from './useEscapeClose'

/* ============ 功能行的数据（颜色 / 字体 / 字号 / 环境） ============ */

const COLORS: { label: string; latex: string; css: string }[] = [
  { label: '蓝色 Blue', latex: 'blue', css: '#1a73e8' },
  { label: '棕色 Brown', latex: 'brown', css: '#8b4513' },
  { label: '灰色 Gray', latex: 'gray', css: '#808080' },
  { label: '绿色 Green', latex: 'green', css: '#188038' },
  { label: '橙色 Orange', latex: 'orange', css: '#e8710a' },
  { label: '桃色 Peach', latex: '#ffcc99', css: '#ffcc99' },
  { label: '紫色 Purple', latex: 'purple', css: '#9334e6' },
  { label: '红色 Red', latex: 'red', css: '#d93025' },
  { label: '黄褐色 Tan', latex: 'tan', css: '#d2b48c' },
  { label: '紫罗兰 Violet', latex: 'violet', css: '#7b1fa2' },
  { label: '黄色 Yellow', latex: 'yellow', css: '#f9ab00' },
]

/** 字体：都映射到 KaTeX 支持的命令（已实测） */
const FONTS: { label: string; sample: string; open: string }[] = [
  { label: '常规 Roman', sample: '\\mathrm{ABC}', open: '\\mathrm{' },
  { label: '加粗 Boldface', sample: '\\mathbf{ABC}', open: '\\mathbf{' },
  { label: '斜体 Italics', sample: '\\mathit{ABC}', open: '\\mathit{' },
  { label: '下划线 Underline', sample: '\\underline{ABC}', open: '\\underline{' },
  { label: '无衬线体 Sansserif', sample: '\\mathsf{ABC}', open: '\\mathsf{' },
  { label: '黑板报体 Blackboard', sample: '\\mathbb{ABC}', open: '\\mathbb{' },
  { label: '手写体 Calligraphy', sample: '\\mathcal{ABC}', open: '\\mathcal{' },
  { label: '德文尖角体 Fraktur', sample: '\\mathfrak{ABC}', open: '\\mathfrak{' },
]

const SIZES: { label: string; open: string }[] = [
  { label: '微小 tiny', open: '\\tiny{' },
  { label: '超小 scriptsize', open: '\\scriptsize{' },
  { label: '小 small', open: '\\small{' },
  { label: '正常 normal', open: '\\normalsize{' },
  { label: '大 large', open: '\\large{' },
  { label: '超大 Large', open: '\\Large{' },
  { label: '特大 LARGE', open: '\\LARGE{' },
  { label: '巨大 huge', open: '\\huge{' },
  { label: '巨无霸 Huge', open: '\\Huge{' },
]

/** 环境：eqnarray / align / split 这些 KaTeX 不支持，统一映射到 aligned（已实测） */
const ENVIRONMENTS: { label: string; env: string | null; note?: string }[] = [
  { label: '无环境 none', env: null },
  { label: '对齐 aligned', env: 'aligned' },
  { label: '居中多行 gathered', env: 'gathered' },
  { label: '分段 cases', env: 'cases' },
  { label: '数组 array', env: 'array' },
  { label: '矩阵 matrix', env: 'matrix' },
  { label: '圆括号矩阵 pmatrix', env: 'pmatrix' },
  { label: '方括号矩阵 bmatrix', env: 'bmatrix' },
  { label: '行列式 vmatrix', env: 'vmatrix' },
  { label: '花括号矩阵 Bmatrix', env: 'Bmatrix' },
  { label: '小矩阵 smallmatrix', env: 'smallmatrix' },
  { label: 'align 环境（用 aligned 代替）', env: 'aligned', note: 'KaTeX 不支持 align，已用 aligned 代替' },
  { label: 'eqnarray 环境（用 aligned 代替）', env: 'aligned', note: 'KaTeX 不支持 eqnarray，已用 aligned 代替' },
  { label: 'split 环境（用 aligned 代替）', env: 'aligned', note: 'KaTeX 不支持 split，已用 aligned 代替' },
]

type Dropdown = 'color' | 'font' | 'size' | 'env' | null

interface Props {
  open: boolean
  initialLatex: string
  initialDisplay: boolean
  onClose(): void
  onConfirm(latex: string, display: boolean): void
}

export default function MathModal({ open, initialLatex, initialDisplay, onClose, onConfirm }: Props) {
  useEscapeClose(open, onClose)

  const [display, setDisplay] = useState(initialDisplay)
  const [tex, setTex] = useState(initialLatex)
  const [hint, setHint] = useState<string | null>(friendlyMathHint(initialLatex))
  const [openCat, setOpenCat] = useState<string | null>(null)
  const [dropdown, setDropdown] = useState<Dropdown>(null)
  const [inputFontSize, setInputFontSize] = useState(16)
  const [lastColor, setLastColor] = useState('#d93025')
  const [fullscreen, setFullscreen] = useState(false)
  const taRef = useRef<HTMLTextAreaElement>(null)

  /* ---------- TeX 命令自动补全 ---------- */
  const [caret, setCaret] = useState(0)
  const [acIndex, setAcIndex] = useState(0)
  const [acDismissed, setAcDismissed] = useState(false)
  const suggestions = useMemo(
    () => (acDismissed ? [] : suggestFor(tex, caret)),
    [tex, caret, acDismissed],
  )

  const acceptSuggestion = useCallback(
    (s: LatexSuggestion) => {
      const start = commandStart(tex, caret)
      if (start < 0) return
      const next = tex.slice(0, start) + s.latex + tex.slice(caret)
      // 有空的 {} 就把光标放进去，没有就停在末尾
      const brace = s.latex.indexOf('{}')
      const pos = brace >= 0 ? start + brace + 1 : start + s.latex.length
      setTex(next)
      setHint(friendlyMathHint(next))
      setAcDismissed(true)
      setAcIndex(0)
      setCaret(pos)
      requestAnimationFrame(() => {
        const ta = taRef.current
        ta?.focus()
        ta?.setSelectionRange(pos, pos)
      })
    },
    [tex, caret],
  )

  /** 所有符号按钮的图形一次性渲染好 */
  const faces = useMemo(() => {
    const map = new Map<string, string>()
    for (const cat of SYMBOL_CATEGORIES) {
      for (const sec of cat.sections) {
        for (const item of sec.items) {
          if (!map.has(item.face)) map.set(item.face, renderKatex(item.face, false))
        }
      }
    }
    return map
  }, [])

  /** 功能行下拉里的小示例图形 */
  const optionFaces = useMemo(() => {
    const map = new Map<string, string>()
    for (const f of FONTS) map.set(f.sample, renderKatex(f.sample, false))
    for (const s of SIZES) map.set(s.open, renderKatex(`${s.open}abc}`, false))
    for (const e of ENVIRONMENTS) {
      if (!e.env) continue
      map.set(
        e.env,
        renderKatex(
          e.env === 'cases'
            ? '\\begin{cases}x,&a>0\\end{cases}'
            : e.env === 'array'
              ? '\\begin{array}{cc}a&b\\end{array}'
              : e.env.includes('matrix')
                ? `\\begin{${e.env}}a&b\\\\c&d\\end{${e.env}}`
                : `\\begin{${e.env}}a=b\\end{${e.env}}`,
          false,
        ),
      )
    }
    return map
  }, [])

  /* ---------- 每次打开重置状态并聚焦输入框 ---------- */
  useEffect(() => {
    if (!open) return
    setTex(initialLatex)
    setHint(friendlyMathHint(initialLatex))
    setDisplay(initialDisplay)
    setOpenCat(null)
    setDropdown(null)
    setFullscreen(false)
    const timer = window.setTimeout(() => {
      const ta = taRef.current
      if (!ta) return
      ta.focus()
      ta.setSelectionRange(ta.value.length, ta.value.length)
    }, 60)
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const update = useCallback((next: string) => {
    setTex(next)
    setHint(friendlyMathHint(next))
  }, [])

  /** 在光标处插入（textarea 的选区会被替换） */
  const insertLatex = useCallback(
    (latex: string) => {
      const ta = taRef.current
      const start = ta?.selectionStart ?? tex.length
      const end = ta?.selectionEnd ?? tex.length
      const next = tex.slice(0, start) + latex + tex.slice(end)
      update(next)
      requestAnimationFrame(() => {
        ta?.focus()
        const pos = start + latex.length
        ta?.setSelectionRange(pos, pos)
      })
    },
    [tex, update],
  )

  /** 用 open…close 包住选区；没选中就包住整条公式（与 latexLive 一致），空输入框则把光标放进空壳里 */
  const wrapSelection = useCallback(
    (open: string, close = '}') => {
      const ta = taRef.current
      const start = ta?.selectionStart ?? 0
      const end = ta?.selectionEnd ?? tex.length
      const selected = tex.slice(start, end)

      if (selected) {
        const next = tex.slice(0, start) + open + selected + close + tex.slice(end)
        update(next)
        requestAnimationFrame(() => {
          ta?.focus()
          const pos = start + open.length + selected.length
          ta?.setSelectionRange(pos, pos)
        })
        return
      }

      if (!tex.trim()) {
        const next = `${open}${close}`
        update(next)
        requestAnimationFrame(() => {
          ta?.focus()
          ta?.setSelectionRange(open.length, open.length)
        })
        return
      }

      const next = `${open}${tex}${close}`
      update(next)
      requestAnimationFrame(() => {
        ta?.focus()
        ta?.setSelectionRange(next.length, next.length)
      })
    },
    [tex, update],
  )

  /** 环境：整体套壳 / 去壳 */
  const applyEnvironment = useCallback(
    (env: string | null) => {
      const stripped = tex
        .replace(/^\s*\\begin\{[a-zA-Z*]+\}(\[[^\]]*\])?/, '')
        .replace(/\\end\{[a-zA-Z*]+\}\s*$/, '')
      update(env ? `\\begin{${env}}${stripped}\\end{${env}}` : stripped)
      requestAnimationFrame(() => taRef.current?.focus())
    },
    [tex, update],
  )

  const previewHtml = useMemo(() => {
    if (!tex.trim()) return '<span class="zh-formula__empty">输入公式后在这里实时预览</span>'
    try {
      return renderKatex(tex, display)
    } catch {
      return '<span class="zh-formula__error">公式暂无法解析，请检查</span>'
    }
  }, [tex, display])

  if (!open) return null

  const activeCat = SYMBOL_CATEGORIES.find((c) => c.key === openCat) ?? null

  return (
    <div className="zh-modal-mask" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className={`zh-modal zh-modal--math${fullscreen ? ' zh-modal--math-full' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label="公式编辑器"
        style={{ ['--mf-size' as string]: `${inputFontSize}px` }}
      >
        {/* 顶栏：标题 + 公式排版（行内/行间）+ 全屏 */}
        <div className="zh-mathhead">
          <span className="zh-mathhead__title">公式编辑器</span>
          <span className="zh-mathhead__mode">公式排版</span>
          <button
            type="button"
            className={`zh-mathmode__btn${!display ? ' zh-mathmode__btn--active' : ''}`}
            title="行内公式"
            onClick={() => setDisplay(false)}
          >
            行内
          </button>
          <button
            type="button"
            className={`zh-mathmode__btn${display ? ' zh-mathmode__btn--active' : ''}`}
            title="行间公式（单独占一行）"
            onClick={() => setDisplay(true)}
          >
            行间
          </button>
          <button
            type="button"
            className="zh-mathclose"
            title={fullscreen ? '退出全屏' : '全屏编辑'}
            onClick={() => setFullscreen((v) => !v)}
          >
            {fullscreen ? '⤡' : '⤢'}
          </button>
          <button type="button" className="zh-mathclose" onClick={onClose} aria-label="关闭">
            ✕
          </button>
        </div>

        {/* 分类行 */}
        <div className="zh-mathcats">
          {SYMBOL_CATEGORIES.map((cat) => (
            <button
              key={cat.key}
              type="button"
              className={`zh-mathcat${openCat === cat.key ? ' zh-mathcat--active' : ''}`}
              onClick={() => {
                setOpenCat((cur) => (cur === cat.key ? null : cat.key))
                setDropdown(null)
              }}
            >
              {cat.label}
              <span className="zh-mathcat__caret">▾</span>
            </button>
          ))}
        </div>

        {/* 输入区 + 实时预览（分类面板浮在它们上面） */}
        <div className="zh-mathbody">
          <div className="zh-mathpane">
            <div className="zh-mathpane__label">输入 TeX 公式</div>
            <div className="zh-mathsource-wrap">
              <textarea
                ref={taRef}
                className="zh-mathsource"
                value={tex}
                spellCheck={false}
                placeholder="例如：E = mc^2（输入 \ 会给出补全提示）"
                onChange={(e) => {
                  update(e.target.value)
                  setCaret(e.target.selectionStart ?? 0)
                  setAcDismissed(false)
                  setAcIndex(0)
                }}
                onKeyUp={(e) => {
                  const ta = e.target as HTMLTextAreaElement
                  setCaret(ta.selectionStart ?? 0)
                }}
                onClick={(e) => setCaret((e.target as HTMLTextAreaElement).selectionStart ?? 0)}
                onKeyDown={(e) => {
                  if (suggestions.length === 0) return
                  if (e.key === 'ArrowDown') {
                    e.preventDefault()
                    setAcIndex((i) => (i + 1) % suggestions.length)
                  } else if (e.key === 'ArrowUp') {
                    e.preventDefault()
                    setAcIndex((i) => (i - 1 + suggestions.length) % suggestions.length)
                  } else if (e.key === 'Enter' || e.key === 'Tab') {
                    e.preventDefault()
                    acceptSuggestion(suggestions[acIndex])
                  } else if (e.key === 'Escape') {
                    // 只收起补全，不要把弹窗关掉
                    e.preventDefault()
                    e.stopPropagation()
                    setAcDismissed(true)
                  }
                }}
              />
              {suggestions.length > 0 && (
                <div className="zh-autocomplete" role="listbox">
                  <div className="zh-autocomplete__hint">补全（↑↓ 选择，Enter 插入）</div>
                  {suggestions.map((s, i) => (
                    <button
                      key={s.cmd}
                      type="button"
                      className={`zh-autocomplete__item${i === acIndex ? ' zh-autocomplete__item--on' : ''}`}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => acceptSuggestion(s)}
                      role="option"
                      aria-selected={i === acIndex}
                    >
                      <span
                        className="zh-autocomplete__face"
                        dangerouslySetInnerHTML={{ __html: faces.get(s.face) ?? renderKatex(s.face, false) }}
                      />
                      <span className="zh-autocomplete__cmd">\{s.cmd}</span>
                      <span className="zh-autocomplete__label">{s.label}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
          <div className="zh-mathpane zh-mathpane--preview">
            <div className="zh-mathpane__label">公式实时预览中…</div>
            <div className="zh-formula__preview" dangerouslySetInnerHTML={{ __html: previewHtml }} />
          </div>

          {activeCat && (
            <div className="zh-mathpanel">
              <button type="button" className="zh-mathpanel__close" onClick={() => setOpenCat(null)}>
                ✕
              </button>
              {activeCat.sections.map((sec) => (
                <div className="zh-mathsec" key={sec.title}>
                  <div className="zh-mathsec__title">{sec.title}</div>
                  <div className="zh-mathsec__grid">
                    {sec.items.map((item) => (
                      <button
                        key={item.latex + item.label}
                        type="button"
                        className="zh-symbol"
                        title={`${item.label}　${item.latex}`}
                        data-latex={item.latex}
                        onClick={() => {
                          insertLatex(item.latex)
                          setOpenCat(null)
                        }}
                        dangerouslySetInnerHTML={{ __html: faces.get(item.face) ?? item.label }}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 防呆提示 */}
        <div className={`zh-mathhint${hint ? ' zh-mathhint--warn' : ''}`} role="status">
          {hint ?? '点分类按钮挑符号，点一下就填进输入框；也可以自己直接敲'}
        </div>

        {/* 功能行 */}
        <div className="zh-mathoptions">
          <div className="zh-optbar">
            <button
              type="button"
              className={`zh-opt${dropdown === 'color' ? ' zh-opt--active' : ''}`}
              onClick={() => setDropdown((d) => (d === 'color' ? null : 'color'))}
            >
              <span className="zh-opt__dot" style={{ background: lastColor }} />
              颜色 <span className="zh-opt__caret">▾</span>
            </button>
            <button
              type="button"
              className={`zh-opt${dropdown === 'font' ? ' zh-opt--active' : ''}`}
              onClick={() => setDropdown((d) => (d === 'font' ? null : 'font'))}
            >
              <span className="zh-opt__glyph">A</span>字体 <span className="zh-opt__caret">▾</span>
            </button>
            <button
              type="button"
              className={`zh-opt${dropdown === 'size' ? ' zh-opt--active' : ''}`}
              onClick={() => setDropdown((d) => (d === 'size' ? null : 'size'))}
            >
              <span className="zh-opt__glyph">T↓</span>字号 <span className="zh-opt__caret">▾</span>
            </button>
            <button
              type="button"
              className={`zh-opt${dropdown === 'env' ? ' zh-opt--active' : ''}`}
              onClick={() => setDropdown((d) => (d === 'env' ? null : 'env'))}
            >
              <span className="zh-opt__glyph">{'{}'}</span>环境 <span className="zh-opt__caret">▾</span>
            </button>
            <button
              type="button"
              className="zh-opt zh-opt--danger"
              onClick={() => {
                update('')
                requestAnimationFrame(() => taRef.current?.focus())
              }}
            >
              🗑 清空
            </button>
          </div>

          <div className="zh-optbar zh-optbar--right">
            <button
              type="button"
              className="zh-opt zh-opt--stepper"
              onClick={() => setInputFontSize((s) => Math.max(12, s - 2))}
              title="输入框字号变小"
            >
              −
            </button>
            <span className="zh-opt__num">{inputFontSize}</span>
            <button
              type="button"
              className="zh-opt zh-opt--stepper"
              onClick={() => setInputFontSize((s) => Math.min(28, s + 2))}
              title="输入框字号变大"
            >
              ＋
            </button>
          </div>

          {/* 下拉菜单 */}
          {dropdown && (
            <div className={`zh-optmenu zh-optmenu--${dropdown}`}>
              {dropdown === 'color' &&
                COLORS.map((c) => (
                  <button
                    key={c.label}
                    type="button"
                    className="zh-optmenu__item"
                    onClick={() => {
                      wrapSelection(`\\color{${c.latex}}{`)
                      setLastColor(c.css)
                      setDropdown(null)
                    }}
                  >
                    <span style={{ color: c.css }}>{c.label}</span>
                  </button>
                ))}
              {dropdown === 'color' && (
                <label className="zh-optmenu__item zh-optmenu__item--custom">
                  <span style={{ color: '#666' }}>RGB 自定义 Custom</span>
                  <input
                    type="color"
                    defaultValue="#3366ff"
                    onChange={(e) => {
                      wrapSelection(`\\color{${e.target.value}}{`)
                      setLastColor(e.target.value)
                      setDropdown(null)
                    }}
                  />
                </label>
              )}
              {dropdown === 'font' &&
                FONTS.map((f) => (
                  <button
                    key={f.label}
                    type="button"
                    className="zh-optmenu__item zh-optmenu__item--preview"
                    onClick={() => {
                      wrapSelection(f.open)
                      setDropdown(null)
                    }}
                  >
                    <span dangerouslySetInnerHTML={{ __html: optionFaces.get(f.sample) ?? '' }} />
                    <span className="zh-optmenu__text">{f.label}</span>
                  </button>
                ))}
              {dropdown === 'size' &&
                SIZES.map((s) => (
                  <button
                    key={s.label}
                    type="button"
                    className="zh-optmenu__item zh-optmenu__item--preview"
                    onClick={() => {
                      wrapSelection(s.open)
                      setDropdown(null)
                    }}
                  >
                    <span dangerouslySetInnerHTML={{ __html: optionFaces.get(s.open) ?? '' }} />
                    <span className="zh-optmenu__text">{s.label}</span>
                  </button>
                ))}
              {dropdown === 'env' &&
                ENVIRONMENTS.map((e) => (
                  <button
                    key={e.label}
                    type="button"
                    className="zh-optmenu__item zh-optmenu__item--preview"
                    title={e.note}
                    onClick={() => {
                      applyEnvironment(e.env)
                      setDropdown(null)
                    }}
                  >
                    {e.env && (
                      <span dangerouslySetInnerHTML={{ __html: optionFaces.get(e.env) ?? '' }} />
                    )}
                    <span className="zh-optmenu__text">{e.label}</span>
                  </button>
                ))}
            </div>
          )}
        </div>

        {/* 底部操作 */}
        <div className="zh-mathfooter">
          <button type="button" className="zh-btn-plain zh-btn-cancel" onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className="zh-btn-solid zh-btn-confirm"
            disabled={!tex.trim()}
            onClick={() => {
              onConfirm(tex.trim(), display)
              onClose()
            }}
          >
            确认
          </button>
        </div>
      </div>
    </div>
  )
}
