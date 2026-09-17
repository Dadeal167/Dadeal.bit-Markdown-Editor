import { SYMBOL_CATEGORIES } from './symbolData'

export interface LatexSuggestion {
  /** 命令名（不含反斜杠），用于前缀匹配与显示 */
  cmd: string
  /** 选中后插入的完整代码 */
  latex: string
  /** 中文名 */
  label: string
  /** 用 KaTeX 画出来的图形 */
  face: string
}

/** 符号表里没覆盖、但手打时常用的命令 */
const EXTRA: LatexSuggestion[] = [
  { cmd: 'boxed', latex: '\\boxed{}', label: '加框', face: '\\boxed{\\Box}' },
  { cmd: 'text', latex: '\\text{}', label: '文字', face: '\\text{\\Box}' },
  { cmd: 'displaystyle', latex: '\\displaystyle ', label: '行内大号显示', face: '\\displaystyle \\sum' },
  { cmd: 'quad', latex: '\\quad ', label: '空格', face: 'a\\quad b' },
  { cmd: 'qquad', latex: '\\qquad ', label: '大空格', face: 'a\\qquad b' },
  { cmd: 'ldots', latex: '\\ldots', label: '省略号', face: '\\ldots' },
  { cmd: 'overrightarrow', latex: '\\overrightarrow{AB}', label: '向量箭头', face: '\\overrightarrow{AB}' },
  { cmd: 'overset', latex: '\\overset{}{}', label: '上标文字', face: '\\overset{\\Box}{\\Box}' },
  { cmd: 'underset', latex: '\\underset{}{}', label: '下标文字', face: '\\underset{\\Box}{\\Box}' },
  { cmd: 'substack', latex: '\\substack{ \\\\ }', label: '多行上下标', face: '\\substack{a \\\\ b}' },
]

/** 从符号表里抽出"命令 → 示例代码"，同名命令只留第一个 */
function buildFromSymbols(): LatexSuggestion[] {
  const map = new Map<string, LatexSuggestion>()
  for (const cat of SYMBOL_CATEGORIES) {
    for (const sec of cat.sections) {
      for (const item of sec.items) {
        const m = item.latex.match(/^\\([a-zA-Z]+)/)
        if (!m) continue
        const cmd = m[1]
        // \begin{cases} 这类只提示 "begin" 没意义，跳过
        if (cmd === 'begin') continue
        if (map.has(cmd)) continue
        map.set(cmd, { cmd, latex: item.latex, label: item.label, face: item.face })
      }
    }
  }
  return [...map.values()]
}

export const LATEX_SUGGESTIONS: LatexSuggestion[] = [...buildFromSymbols(), ...EXTRA].sort((a, b) =>
  a.cmd.localeCompare(b.cmd),
)

/**
 * 根据光标前正在输入的内容给出候选。
 * 只在"刚敲了反斜杠 + 若干字母"时触发，最多返回 3 条（用户要求：不要多，就三个）。
 */
export function suggestFor(tex: string, caret: number, limit = 3): LatexSuggestion[] {
  const before = tex.slice(0, caret)
  const m = before.match(/\\([a-zA-Z]*)$/)
  if (!m) return []
  const q = m[1].toLowerCase()
  if (q.length === 0) return []
  const hits = LATEX_SUGGESTIONS.filter((s) => s.cmd.toLowerCase().startsWith(q))
  // 短的优先（更可能是想打的那个），同长度按字母序
  hits.sort((a, b) => a.cmd.length - b.cmd.length || a.cmd.localeCompare(b.cmd))
  return hits.slice(0, limit)
}

/** 正在输入的 "\xxx" 片段在文本里的起始位置（没有则返回 -1） */
export function commandStart(tex: string, caret: number): number {
  const before = tex.slice(0, caret)
  const m = before.match(/\\([a-zA-Z]*)$/)
  return m ? before.length - m[0].length : -1
}
