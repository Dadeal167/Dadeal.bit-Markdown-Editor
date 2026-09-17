/**
 * 公式"写法坏了"的自动修复。
 *
 * 为什么需要它：用户从知乎、Typora、各种导出工具拿到的 .md 里，
 * 公式的反斜杠经常被多写一层或吃掉一层，例如
 *     \left \\{ x_{n} \right \\}      （多了一层 —— KaTeX 直接报错）
 *     ...\beta)]\\\                   （收尾多了一个反斜杠）
 *     p(A\or B)                       （\or 不是 KaTeX 命令，本该是 \lor）
 * 这些公式在编辑器里就是一行红字。这里的做法是：
 * **只动渲染不出来的公式**，按"最可能的写法"逐步修，谁能渲染成功就用谁；
 * 本来就能正常渲染的公式一个字符都不改。
 */
import katex from 'katex'

/** 能不能用 KaTeX 渲染出来（strict:false —— 中文、① 这类字符只警告不报错） */
const okCache = new Map<string, boolean>()

export function rendersOk(tex: string, display: boolean): boolean {
  if (!tex.trim()) return true
  const key = (display ? 'D' : 'I') + tex
  const hit = okCache.get(key)
  if (hit !== undefined) return hit
  let ok = true
  try {
    katex.renderToString(tex, { throwOnError: true, displayMode: display, strict: false })
  } catch {
    ok = false
  }
  // 公式多的文档（六百多个）每次渲染都跑一遍会卡，缓存一下
  if (okCache.size > 4000) okCache.clear()
  okCache.set(key, ok)
  return ok
}

/**
 * 一步步累加的修法。顺序有讲究：
 * 先修"反斜杠写重了"，再修"该有的反斜杠没了"，最后才动结尾和命令名。
 */
const STEPS: Array<(s: string) => string> = [
  // \\{  \\}  →  \{  \}      （\left \\{ 这类，多了一个反斜杠）
  (s) => s.replace(/\\\\(?=[{}])/g, '\\'),
  // \left {  \right }  →  \left\{  \right\}   （少了一个反斜杠）
  (s) => s.replace(/(\\(?:left|right|middle|big|Big|bigg|Bigg)\s*)\{/g, '$1\\{'),
  (s) => s.replace(/(\\(?:left|right|middle|big|Big|bigg|Bigg)\s*)\}/g, '$1\\}'),
  // 三个及以上反斜杠 → 两个（LaTeX 换行 \\ 被写成 \\\\\ 的情况）
  // 注意写成 /\\{3,}/ 才对：/\\\\{3,}/ 是"一个反斜杠 + 三个以上反斜杠"＝四个起
  (s) => s.replace(/\\{3,}/g, '\\\\'),
  // 结尾孤零零的反斜杠 / 反斜杠后面直接结束
  (s) => s.replace(/\\+$/, ''),
  // 公式里混进了多余的 $（定界符被吃进来一个）
  (s) => s.replace(/^\$+/, '').replace(/\$+$/, ''),
]

/** 常见"不是 KaTeX 命令"的写法 → 真正想表达的命令 */
const SPELLING: Array<[RegExp, string]> = [
  [/\\or(?![a-zA-Z])/g, '\\lor'],
  [/\\and(?![a-zA-Z])/g, '\\land'],
  [/\\rightleftarrow(?![a-zA-Z])/g, '\\leftrightarrow'],
  [/\\leftrightarrow(?![a-zA-Z])/g, '\\leftrightarrow'],
  [/\\dollar/g, '\\$'],
  [/\\degree(?![a-zA-Z])/g, '^{\\circ}'],
  [/\\celsius(?![a-zA-Z])/g, '^{\\circ}\\mathrm{C}'],
  [/\\perthousand(?![a-zA-Z])/g, '\\text{‰}'],
  [/\\permil(?![a-zA-Z])/g, '\\text{‰}'],
]

/** 同一段公式会被反复渲染（每次输入都重渲染），缓存一下省点时间 */
const cache = new Map<string, string>()
const CACHE_MAX = 4000

/**
 * 返回"能渲染出来"的公式写法。
 * 本来就没问题的原样返回；修不好也原样返回（交给界面显示成可点击修改的红字）。
 */
export function repairLatex(tex: string, display: boolean): string {
  if (!tex.trim()) return tex
  const key = (display ? 'D' : 'I') + tex
  const hit = cache.get(key)
  if (hit !== undefined) return hit

  let out = tex
  if (!rendersOk(tex, display)) {
    let cur = tex
    for (const step of STEPS) {
      const next = step(cur)
      if (next !== cur) {
        cur = next
        if (rendersOk(cur, display)) {
          out = cur
          break
        }
      }
    }
    if (out === tex) {
      // 结构性修法都没救回来，再试"命令名拼错"
      for (const [re, to] of SPELLING) {
        const next = cur.replace(re, to)
        if (next !== cur && rendersOk(next, display)) {
          out = next
          break
        }
      }
    }
    // 全部失败的兜底：把拼写修正逐个叠上去碰碰运气
    if (out === tex) {
      let acc = cur
      for (const [re, to] of SPELLING) acc = acc.replace(re, to)
      if (acc !== cur && rendersOk(acc, display)) out = acc
    }
  }

  if (cache.size > CACHE_MAX) cache.clear()
  cache.set(key, out)
  return out
}
