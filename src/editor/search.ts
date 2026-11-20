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
import { DOMParser as PMDOMParser, type Node as PMNode } from '@tiptap/pm/model'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { closeHistory } from '@tiptap/pm/history'
import type { Editor } from '@tiptap/core'
import type { Doc } from './documents'
import { escapeMarkdownDestinations } from './tiptap/mdDestinations'
import { protectMathSpans, recoverEscapedMath, stripLeakedMarks } from './tiptap/mathMarkdown'
import { looksLikeFormula, stripExporterHeader } from './zhihuMarkdown'

const parsedDocuments = new WeakMap<Doc, { schema: Editor['schema']; node: PMNode }>()

export function searchableDocument(editor: Editor, doc: Doc): PMNode | null {
  const cached = parsedDocuments.get(doc)
  if (cached?.schema === editor.schema) return cached.node
  const storage = editor.storage as unknown as { markdown?: { parser?: { parse(value: string): string } } }
  const parser = storage.markdown?.parser
  if (!parser) return null
  try {
    const template = document.createElement('template')
    const markdown = recoverEscapedMath(stripExporterHeader(stripLeakedMarks(doc.md, '检索文档')), looksLikeFormula)
    const { md } = protectMathSpans(markdown)
    template.innerHTML = parser.parse(escapeMarkdownDestinations(md))
    const node = PMDOMParser.fromSchema(editor.schema).parse(template.content)
    parsedDocuments.set(doc, { schema: editor.schema, node })
    return node
  } catch {
    return null
  }
}

export interface SearchMatch {
  from: number
  to: number
  kind: 'text' | 'formula'
  text: string
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
 * 搜索不区分大小写，允许在连续文字中跨越加粗等标记。
 *
 * 顺带把命中处前后的原文取出来（`before` / `after`）——
 * 结果列表要"把对应的那段文字完整显示出来"，只给个序号是看不出是哪一处的。
 */
export function findMatches(doc: PMNode, query: string, limit = MAX_MATCHES, includeFormulas = true): SearchMatch[] {
  const q = query.trim()
  if (!q) return []
  const pattern = new RegExp(q.replace(/[.*+?^$(){}|[\]\\]/g, '\\$&'), 'giu')
  const out: SearchMatch[] = []
  let run = ''
  let runStart = 0
  const search = (source: string, pos: number, nodeSize?: number) => {
    pattern.lastIndex = 0
    let hit: RegExpExecArray | null
    while (out.length < limit && (hit = pattern.exec(source))) {
      const start = hit.index
      const end = start + hit[0].length
      out.push({
        from: nodeSize === undefined ? pos + start : pos,
        to: nodeSize === undefined ? pos + end : pos + nodeSize,
        kind: nodeSize === undefined ? 'text' : 'formula',
        text: hit[0],
        before: flat(source.slice(Math.max(0, start - SNIPPET_SIDE), start)),
        after: flat(source.slice(end, end + SNIPPET_SIDE)),
      })
      if (nodeSize !== undefined) break
    }
  }
  const flush = () => {
    if (run) search(run, runStart)
    run = ''
  }
  doc.descendants((node, pos) => {
    if (out.length >= limit) return false
    if (node.isText && node.text) {
      if (run && runStart + run.length !== pos) flush()
      if (!run) runStart = pos
      run += node.text
    } else {
      flush()
      if (includeFormulas && (node.type.name === 'mathInline' || node.type.name === 'mathBlock')) {
        search(String(node.attrs.latex ?? ''), pos, node.nodeSize)
      }
    }
  })
  flush()
  return out
}

/** 逆序替换使前面的位置保持有效，整次操作可以一次撤销。 */
export function replaceTextMatches(editor: Editor, matches: readonly SearchMatch[], replacement: string): number {
  const textMatches = matches.filter((match) => match.kind === 'text' && match.text !== replacement)
  if (!textMatches.length) return 0
  const transaction = closeHistory(editor.state.tr)
  for (let index = textMatches.length - 1; index >= 0; index--) {
    const { from, to } = textMatches[index]
    transaction.insertText(replacement, from, to)
  }
  editor.view.dispatch(transaction)
  return textMatches.length
}

/**
 * 结果列表里那一行的显示文本：命中字居中，两边补上下文。
 * 太长就两边对称地掐，**命中字本身一定要完整留着**（这是"完整显示"的核心）。
 * 前缀加 `…` 表示前面还有内容，保证最终长度不超过 SNIPPET_MAX。
 */
export function snippetOf(match: SearchMatch): string {
  const hit = flat(match.text)
  const room = Math.max(0, SNIPPET_MAX - hit.length)
  const want = Math.floor(room / 2)

  let before = match.before
  let after = match.after
  if (!want) return hit
  if (before.length > want) before = '…' + before.slice(before.length - want + 1)
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
    if (match.kind === 'formula') {
      const node = view.nodeDOM(match.from)
      if (node instanceof Element) node.scrollIntoView({ block: 'center', behavior: 'smooth' })
      return
    }
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
            const decos = matches.map((match, index) => {
              const attrs = { class: index === current ? 'zh-search-hit zh-search-hit--current' : 'zh-search-hit' }
              return match.kind === 'formula'
                ? Decoration.node(match.from, match.to, attrs)
                : Decoration.inline(match.from, match.to, attrs)
            })
            return DecorationSet.create(state.doc, decos)
          },
        },
      }),
    ]
  },
})
