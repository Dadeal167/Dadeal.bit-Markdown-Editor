/**
 * 文档内搜索（「搜索」按钮 / Ctrl+F）
 *
 * 做法和深色主题那个颜色修补一样：命中处用 **ProseMirror decoration** 画高亮，
 * 文档内容一个字都不动（不会写进 getHTML()、不会进导出的 .md）。
 *
 * 三件事分开：
 *   · findMatches —— 纯函数：给定文档和关键词，算出所有命中的位置
 *   · SearchHighlight —— 插件：按当前关键词/当前第几条，产出高亮 decorations
 *   · scrollToMatch —— 把当前命中滚到视野中间（**不动编辑器焦点**，这样搜索框还能继续打字）
 */
import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import type { EditorState } from '@tiptap/pm/state'
import type { Node as PMNode } from '@tiptap/pm/model'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { Editor } from '@tiptap/core'

export interface SearchMatch {
  from: number
  to: number
  /** 命中处周边的原文（`before` + 命中字 + `after`），给结果列表显示用 */
  before: string
  after: string
}

export interface SearchState {
  /** 关键词（空 = 没在搜） */
  query: string
  /** 当前是第几条（0 基） */
  current: number
}

export const EMPTY_SEARCH: SearchState = { query: '', current: 0 }

export const searchPluginKey = new PluginKey<SearchState>('textSearch')

/** 一次最多高亮多少条（防止一个"的"字把整篇点满，卡住渲染） */
const MAX_MATCHES = 2000

/** 每条命中前后各取多少个字，拼成结果列表里那一行 */
const SNIPPET_SIDE = 20
/** 一行最多显示多少字（超了中间省略） */
const SNIPPET_MAX = 70

/** 把空白压平，免得结果行被换行/连续空格撑开 */
const flat = (s: string): string => s.replace(/\s+/g, ' ')

/**
 * 找出所有命中：大小写不敏感；只在**同一个文本节点**里匹配
 * （跨节点匹配会把高亮切成两半，ProseMirror 的 inline decoration 处理不了）。
 *
 * 顺带把命中处前后的原文取出来（`before` / `after`）——
 * 结果列表要"把对应的那段文字完整显示出来"，只给个序号是看不出是哪一处的。
 */
export function findMatches(doc: PMNode, query: string): SearchMatch[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const out: SearchMatch[] = []
  doc.descendants((node, pos) => {
    if (out.length >= MAX_MATCHES) return false
    if (!node.isText || !node.text) return
    // 公式、代码块里的文字也一起搜（用户找的是"文档里的字"，不该漏）
    const text = node.text
    const hay = text.toLowerCase()
    let at = hay.indexOf(q)
    while (at >= 0) {
      const start = pos + at
      const end = pos + at + q.length
      out.push({
        from: start,
        to: end,
        before: flat(text.slice(Math.max(0, at - SNIPPET_SIDE), at)),
        after: flat(text.slice(at + q.length, at + q.length + SNIPPET_SIDE)),
      })
      if (out.length >= MAX_MATCHES) break
      at = hay.indexOf(q, at + q.length)
    }
    return
  })
  return out
}

/**
 * 结果列表里那一行的显示文本：命中字居中，两边补上下文。
 * 太长就两边对称地掐，**命中字本身一定要完整留着**（这是"完整显示"的核心）。
 * 前缀加 `…` 表示前面还有内容，保证最终长度不超过 SNIPPET_MAX。
 */
export function snippetOf(match: SearchMatch, query: string): string {
  const hit = flat(query.trim())
  const room = Math.max(0, SNIPPET_MAX - hit.length)
  const want = Math.floor(room / 2)

  let before = match.before
  let after = match.after
  if (before.length > want) before = '…' + before.slice(-(want - 1))
  if (after.length > want) after = after.slice(0, want - 1) + '…'
  return before + hit + after
}

/** 读当前搜索状态 */
export function getSearch(state: EditorState): SearchState {
  return (searchPluginKey.getState(state) as SearchState | undefined) ?? EMPTY_SEARCH
}

/** 改搜索状态（关键词/当前条数）：走一个 meta 事务，插件重算高亮 */
export function setSearch(editor: Editor, patch: Partial<SearchState>): void {
  const next = { ...getSearch(editor.state), ...patch }
  editor.view.dispatch(editor.state.tr.setMeta(searchPluginKey, next))
}

/** 把某个命中滚到视野中间。**不 focus 编辑器** —— 搜索框要保持能继续输入 */
export function scrollToMatch(editor: Editor, match: SearchMatch | undefined): void {
  if (!match) return
  try {
    const view = editor.view
    const dom = view.domAtPos(match.from)
    const el = (dom.node.nodeType === 3 ? dom.node.parentElement : (dom.node as HTMLElement)) ?? null
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  } catch {
    /* 位置算不出来就算了，不影响继续搜 */
  }
}

/** 搜索高亮插件：所有命中画黄底，当前那条再深一点 */
export const SearchHighlight = Extension.create({
  name: 'searchHighlight',

  addProseMirrorPlugins() {
    return [
      new Plugin<SearchState>({
        key: searchPluginKey,
        state: {
          init: () => EMPTY_SEARCH,
          apply(tr, value) {
            const meta = tr.getMeta(searchPluginKey) as SearchState | undefined
            return meta ? meta : value
          },
        },
        props: {
          decorations(state) {
            const { query, current } = getSearch(state)
            if (!query.trim()) return DecorationSet.empty
            const matches = findMatches(state.doc, query)
            if (!matches.length) return DecorationSet.empty
            const decos = matches.map((m, i) =>
              Decoration.inline(m.from, m.to, {
                class: i === current ? 'zh-search-hit zh-search-hit--current' : 'zh-search-hit',
              }),
            )
            return DecorationSet.create(state.doc, decos)
          },
        },
      }),
    ]
  },
})
