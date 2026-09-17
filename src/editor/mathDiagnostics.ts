/**
 * 公式诊断包：**把出问题的现场留下来**。
 *
 * 为什么需要它（这是从一次失败里学来的）：
 * 用户报过三次"公式坏了"，而我每次都**拿不到坏样本** ——
 *   · "公式旁边变方块"：只有一段聊天文本，查不到根因就过去了；
 *   · "点了搜索才坏"：我的测量和用户的说法对不上，我给的解释都是推测；
 *   · "点了修复公式之后全变成源码"：只有一张截图，反推不出是哪条正则踩中的。
 * 没有数据的推理只会产出"合理的错误"。所以这里加一个出口：
 * 用户觉得公式不对时，**点一下就把现场导出来**，发给我就能精确复现。
 *
 * 导出内容（都是只读采集，不改文档）：
 *   · 每个公式节点：位置、是不是行内、**节点里存的 latex**、渲染是否成功、页面上是否标红
 *   · 全文里"看起来是公式但没被识别"的 `$…$` 片段（原文公式残留）
 *   · 浏览器信息、编辑器版本标记、当前主题
 *   · **动作历史**：最近若干次"修复公式 / 检查图片与公式 / 打开文档"等操作，
 *     以及每次操作**前后**的公式快照摘要 —— 这样"点完按钮才坏"能一眼看出来
 */
import type { Editor } from '@tiptap/core'
import { repairLatex, rendersOk } from './math/latexRepair'

/** 诊断包里最多放多少个公式（文档公式特别多时截断，避免文件过大） */
const MAX_FORMULAS = 400
/** 动作历史保留多少条 */
const MAX_EVENTS = 40

interface DiagEvent {
  at: string
  action: string
  detail?: string
  /** 操作前的公式摘要（数量 + 坏的数量 + 一份指纹） */
  before?: FormulaSummary
  after?: FormulaSummary
}

interface FormulaSummary {
  total: number
  renderFail: number
  /** 所有 latex 拼起来的简单指纹，用来判断"动作前后公式有没有被改动" */
  fingerprint: string
}

const events: DiagEvent[] = []

/** latex 列表的轻量指纹（不做加密，只要能判断"变没变"） */
function fingerprint(latexes: string[]): string {
  let h = 2166136261
  for (const s of latexes) {
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i)
      h = Math.imul(h, 16777619)
    }
    h ^= 0x1f
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

/** 采集当前文档里所有公式的 latex（只读） */
function collectLatex(editor: Editor): string[] {
  const out: string[] = []
  try {
    editor.state.doc.descendants((n) => {
      if (n.type.name === 'mathInline' || n.type.name === 'mathBlock') out.push(String(n.attrs.latex ?? ''))
    })
  } catch {
    /* 文档拿不到就算了，诊断本身不该抛 */
  }
  return out
}

/** 当前公式状态摘要 */
export function summarizeFormulas(editor: Editor): FormulaSummary {
  const latexes = collectLatex(editor)
  let fail = 0
  for (const l of latexes) {
    if (!l.trim()) continue
    try {
      if (!rendersOk(l, false)) fail += 1
    } catch {
      fail += 1
    }
  }
  return { total: latexes.length, renderFail: fail, fingerprint: fingerprint(latexes) }
}

/**
 * 记一条动作（不带前后快照，用于"打开文档"这类不需要快照的事件）。
 * 需要前后对比的请用 `withDiag`。
 */
export function recordDiag(action: string, detail?: string): void {
  try {
    events.push({ at: new Date().toISOString(), action, detail })
    if (events.length > MAX_EVENTS) events.shift()
  } catch {
    /* 忽略 */
  }
}

/** 带"前后快照"地执行一个动作，并记进诊断历史 */
export function withDiag<T>(editor: Editor | null, action: string, fn: () => T): T {
  if (!editor || editor.isDestroyed) return fn()
  let before: FormulaSummary | undefined
  try {
    before = summarizeFormulas(editor)
  } catch {
    /* 忽略 */
  }
  const t0 = performance.now()
  let result: T
  try {
    result = fn()
  } catch (e) {
    recordDiag(action, `抛异常：${String(e).slice(0, 120)}`)
    throw e
  }
  const ms = Math.round(performance.now() - t0)
  try {
    const after = summarizeFormulas(editor)
    events.push({
      at: new Date().toISOString(),
      action,
      detail: `耗时 ${ms}ms`,
      before,
      after,
    })
    if (events.length > MAX_EVENTS) events.shift()
  } catch {
    /* 忽略 */
  }
  return result
}

/** 诊断历史（给测试和导出用） */
export function diagEvents(): DiagEvent[] {
  return events.slice()
}

export function clearDiag(): void {
  events.length = 0
}

export interface FormulaDiag {
  exportedAt: string
  editor: {
    userAgent: string
    platform: string
    theme: string
    /** 构建标记：产物里写死的字符串，用来确认用户跑的是哪一版 */
    buildMark: string
    docChars: number
  }
  summary: FormulaSummary
  /**
   * **结构摘要** —— 判断"公式节点有没有被降级"的关键。
   *
   * 为什么要单独一组：用户报过一次"点了修复公式后，公式全变成源码、一格一格的"。
   * 拿到现场才发现那不是"内容被改坏"（那种 KaTeX 会画红框），而是
   * **数学节点被降级成了普通文字** —— 两种事故形状和排查方向完全不同：
   *   · 内容坏了：mathInline 还在，只是 latex 渲染不出来 → 查 repairLatex
   *   · 结构坏了：mathInline 不见了、变成 paragraph → 查解析/序列化/替换节点的代码
   * 以前的诊断只记 latex，看不出是哪一种，白查了一轮。
   */
  structure: {
    nodeTypes: Record<string, number>
    mathInline: number
    mathBlock: number
    mathTotal: number
    /**
     * **疑似降级的段落**：段落文字里有 LaTeX 命令名（或"命令名在、反斜杠没了"），
     * 而这一段里没有数学节点 —— 这就是节点被降级的指纹。
     */
    suspectDegraded: { pos: number; text: string }[]
    suspectDegradedCount: number
  }
  formulas: {
    index: number
    pos: number
    display: boolean
    /** 节点的**类型名**：正常应该是 mathInline / mathBlock */
    nodeType: string
    /** 节点上挂了哪些属性（键名），用来确认 latex 属性还在不在 */
    attrKeys: string[]
    /** **节点里存的**写法（这是最关键的：坏不坏看它） */
    storedLatex: string
    /** 按存着的写法，单独跑一遍修复会得到什么（用来判断"修复会不会改坏它"） */
    repairedLatex: string
    /** 存着的写法本身能不能渲染 */
    storedRenders: boolean
    /** 修完能不能渲染 */
    repairedRenders: boolean
    /** 页面上那个节点是不是标了"渲染失败" */
    markedBroken: boolean
    /** 页面上的 KaTeX 是不是报错态 */
    katexError: boolean
    /** 页面上这个节点里有没有真的渲染出 KaTeX 子树 */
    hasKatexDom: boolean
  }[]
  truncated: boolean
  /** 看着像公式、却没被识别成公式的 `$…$` 残留 */
  rawDollarSamples: string[]
  events: DiagEvent[]
}

/** 疑似"公式被降级成普通文字"的判据：段落里有 LaTeX 命令名，却没有数学节点 */
const LATEX_CMD_RE = /\\(frac|sqrt|left|right|varphi|Delta|odot|angle|infty|sum|int|alpha|beta|theta|lambda|pi|mu|sigma|omega|times|cdot|pm|leq|geq|neq|begin|end)\b/
/** 命令名在、反斜杠没了（= 被剥掉一层）的判据 */
const DEBACKSLASHED_RE = /(?<!\\)\b(frac|sqrt|left|right|varphi|Delta|odot|angle|infty)\b/

/** 采集一份完整的诊断包（只读，不改文档） */
export function buildFormulaDiag(editor: Editor | null): FormulaDiag {
  const domNodes = [...document.querySelectorAll('.math-node')]
  const formulas: FormulaDiag['formulas'] = []
  let truncated = false

  /* 结构统计：节点类型分布 + 疑似降级的段落 */
  const nodeTypes: Record<string, number> = {}
  const suspectDegraded: { pos: number; text: string }[] = []

  if (editor && !editor.isDestroyed) {
    let index = 0
    try {
      editor.state.doc.descendants((n, pos) => {
        nodeTypes[n.type.name] = (nodeTypes[n.type.name] ?? 0) + 1

        /* 段落里出现 LaTeX 命令名、却没有数学节点 → 公式被降级成文字了 */
        if (n.type.name === 'paragraph' || n.type.name === 'heading') {
          const text = n.textContent ?? ''
          if (LATEX_CMD_RE.test(text) || DEBACKSLASHED_RE.test(text)) {
            if (suspectDegraded.length < 40) suspectDegraded.push({ pos, text: text.slice(0, 160) })
          }
        }

        if (n.type.name !== 'mathInline' && n.type.name !== 'mathBlock') return
        if (index >= MAX_FORMULAS) {
          truncated = true
          return false
        }
        const display = n.type.name === 'mathBlock'
        const stored = String(n.attrs.latex ?? '')
        let repaired = stored
        let storedOk = false
        let repairedOk = false
        try {
          storedOk = rendersOk(stored, display)
          repaired = repairLatex(stored, display)
          repairedOk = rendersOk(repaired, display)
        } catch {
          /* 渲染判断本身出错，就当不通过 */
        }
        const dom = domNodes[index]
        formulas.push({
          index,
          pos,
          display,
          nodeType: n.type.name,
          attrKeys: Object.keys(n.attrs ?? {}),
          storedLatex: stored,
          repairedLatex: repaired,
          storedRenders: storedOk,
          repairedRenders: repairedOk,
          markedBroken: dom?.getAttribute('data-math-broken') === 'true',
          katexError: Boolean(dom?.querySelector('.katex-error')),
          hasKatexDom: Boolean(dom?.querySelector('.katex')),
        })
        index += 1
        return
      })
    } catch {
      /* 遍历出错就返回已经采到的部分 */
    }
  }

  /* 正文里"看着像公式"的 $…$ 残留（原文公式没被识别） */
  const rawDollarSamples: string[] = []
  try {
    const text = document.querySelector('.zh-prose')?.textContent ?? ''
    for (const m of text.matchAll(/\$[^$\n]{2,80}\$/g)) {
      if (rawDollarSamples.length >= 20) break
      rawDollarSamples.push(m[0])
    }
  } catch {
    /* 忽略 */
  }

  const buildMark = `${typeof __BUILD_MODE__ === 'string' ? __BUILD_MODE__ : '?'} @ ${
    typeof __BUILD_TIME__ === 'string' ? __BUILD_TIME__ : '?'
  }`
  return {
    exportedAt: new Date().toISOString(),
    editor: {
      userAgent: navigator.userAgent,
      platform: navigator.platform ?? '',
      theme: document.documentElement.dataset.theme ?? '',
      buildMark,
      docChars: (document.querySelector('.ProseMirror')?.textContent ?? '').length,
    },
    summary: editor && !editor.isDestroyed ? summarizeFormulas(editor) : { total: formulas.length, renderFail: 0, fingerprint: '' },
    structure: {
      nodeTypes,
      mathInline: nodeTypes.mathInline ?? 0,
      mathBlock: nodeTypes.mathBlock ?? 0,
      mathTotal: (nodeTypes.mathInline ?? 0) + (nodeTypes.mathBlock ?? 0),
      suspectDegraded,
      suspectDegradedCount: suspectDegraded.length,
    },
    formulas,
    truncated,
    rawDollarSamples,
    events: diagEvents(),
  }
}

/** 把诊断包存成文件下载 */
export function downloadFormulaDiag(editor: Editor | null): { formulas: number; events: number } {
  const diag = buildFormulaDiag(editor)
  const text = JSON.stringify(diag, null, 2)
  const blob = new Blob([text], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  a.href = url
  a.download = `公式诊断-${stamp}.json`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  window.setTimeout(() => URL.revokeObjectURL(url), 4000)
  return { formulas: diag.formulas.length, events: diag.events.length }
}
