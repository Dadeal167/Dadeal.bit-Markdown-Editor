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
 * 把公式里的 HTML 实体解回真字符。
 *
 * 为什么需要：从知乎（以及不少网页导出工具）导出的 .md，会把公式里的 `<` `>` `&` 写成
 * `&lt;` `&gt;` `&amp;`。KaTeX 不认识 `&lt;`，整条公式直接渲染失败、显示成红字。
 * 实测用户那篇 166 个公式里有 9 个带实体，**9 个全部渲染失败**，其余 157 个都正常 ——
 * 症状是"正文里一部分公式变成了源码样子的红字"。
 *
 * 只认数学里有意义的那几个；`&lt;` 这类必须放在 `&amp;` 前面先换，
 * 否则 `&amp;lt;` 会被先解成 `&lt;` 就停了。
 */
export function decodeMathEntities(tex: string): string {
  if (!tex.includes('&')) return tex
  return tex
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
}

/** 定界符：`$…$` 行内、`$$…$$` / `\[…\]` 行间 */
const INLINE_DELIM = /^\$([^$]+)\$$/
const BLOCK_DELIM = /^\$\$([\s\S]+)\$\$$/
const BRACKET_DELIM = /^\\\[([\s\S]+)\\\]$/

/**
 * 公式里混进了 `\[ … \]` 定界符。
 *
 * 为什么需要：`\[` `\]` 在 TeX 里是**行间公式定界符**，KaTeX 只允许它出现在公式最外层。
 * 而不少导出/复制场景会把 `\[ … \]` 塞进 `$ … $` 里，位置还不一定在两头：
 *     $a\in \[-\infty,\frac{1}{2}\]$      → 报 Undefined control sequence: \[
 * 实测用户那篇里就有一条这种。既然它已经在一段公式**里面**了，
 * 那就只可能是在当普通方括号用 —— 把转义的 `\[` `\]` 解回 `[` `]`。
 *
 * 注意：**多行**公式（aligned / cases 环境）里 `\\` 是换行符，不能碰；
 * 这里只处理 `\[` `\]` 这种带方括号的，跟 `\\` 无关。
 */
function unescapeBrackets(s: string): string {
  if (!s.includes('\\[')) return s
  return s.replace(/\\\[/g, '[').replace(/\\\]/g, ']')
}

/**
 * 整个 `\[ … \]` / `$$ … $$` 被当成公式内容塞进来 → 把里层定界符剥掉。
 * 这是上一招的"整条都是定界符"版本（`\[-\infty,\frac12\]` 这种）。
 */
function stripInnerDelims(s: string): string {
  if (s.includes('\n')) return s
  const t = s.trim()
  const m = INLINE_DELIM.exec(t) ?? BLOCK_DELIM.exec(t) ?? BRACKET_DELIM.exec(t)
  return m ? m[1].trim() : s
}

/**
 * 一步步累加的修法。顺序有讲究：
 * 先修"反斜杠写重了"，再修"该有的反斜杠没了"，最后才动结尾和命令名。
 */
const STEPS: Array<(s: string) => string> = [
  // HTML 实体 → 真字符（&lt; &gt; &amp; …）。放第一步：它最便宜，而且不做的话
  // 下面的反斜杠修法全都白搭 —— KaTeX 看到 &lt; 就整条失败。
  decodeMathEntities,
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
  // 整个 `\[ … \]` / `$$ … $$` 被塞进了公式 → 把里层定界符剥掉
  stripInnerDelims,
  // 公式中间夹着转义的方括号 `\[` `\]` → 解回普通方括号
  unescapeBrackets,
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
 *
 * **铁律：修不好就一个字都不许改。**
 *
 * 这条以前没写死，结果是"点了修复公式之后，公式反而全变成源码了"（用户实测截图）——
 * 命令前的反斜杠被剥掉、`$` 也没了，整段铺在正文里。
 * 病根是最后那个兜底分支：它把 SPELLING（猜命令拼写）那张表**不加验证地全量叠一遍**，
 * 只用一个"最后能不能渲染"判成败。可那张表里的正则没有锚定
 * （例如 `/\or(?![a-zA-Z])/` 会命中别的命令的尾巴），叠完之后会把一段本来只是
 * "整体渲染失败"的公式改成"部分命令被拆散"的样子 —— 更烂，而且**会存进文档**。
 *
 * 三道守卫（配套否定断言在 scripts/check-latex-repair-safety.mjs）：
 *   1. 每一步（含兜底）只有**改完确实能渲染**才采用
 *   2. 整函数包 try/catch —— 修复过程本身出错也返回原文
 *   3. 出口再校验一次：out 渲染不出来就退回原文
 *
 * 这个安全网做过**变异测试**：把守卫撤掉后跑套件，断言 A 立刻变红并指出
 * `"\text{中文} \or \left\{" → "\text{中文} \lor \left\{"`（改了还是渲染不出来）——
 * 说明这些断言真的能拦住这类 bug，不是摆设。
 */
export function repairLatex(tex: string, display: boolean): string {
  if (!tex.trim()) return tex
  const key = (display ? 'D' : 'I') + tex
  const hit = cache.get(key)
  if (hit !== undefined) return hit

  let out = tex
  try {
    if (!rendersOk(tex, display)) {
      let cur = tex
      for (const step of STEPS) {
        const next = step(cur)
        if (next === cur) continue
        cur = next
        /* 采用了才 break；没采用也要把 cur 留着给后面的步骤继续累加 */
        if (rendersOk(cur, display)) {
          out = cur
          break
        }
      }
      /* 结构性修法都没救回来：试"命令名拼错"，**一条一条验证** */
      if (out === tex) {
        for (const [re, to] of SPELLING) {
          const next = cur.replace(re, to)
          if (next !== cur && rendersOk(next, display)) {
            out = next
            break
          }
        }
      }
      /* 兜底：把拼写修正逐个叠上去碰碰运气。
         ⚠️ 这是历史遗留的"赌博"分支，只有在整段叠完之后**确实能渲染**时才采用。 */
      if (out === tex) {
        let acc = cur
        for (const [re, to] of SPELLING) acc = acc.replace(re, to)
        if (acc !== cur && rendersOk(acc, display)) out = acc
      }
    }
  } catch {
    /* 修复过程本身出错（正则/渲染异常）→ 原样返回，绝不让它改坏公式 */
    out = tex
  }

  /* 出口再兜一道：万一上面哪条路径让 out 变成了渲染不出来的东西，退回原文 */
  if (out !== tex) {
    try {
      if (!rendersOk(out, display)) out = tex
    } catch {
      out = tex
    }
  }

  if (cache.size > CACHE_MAX) cache.clear()
  cache.set(key, out)
  return out
}
