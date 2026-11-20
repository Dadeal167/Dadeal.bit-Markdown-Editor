import { Extension, type Editor } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state'
import { closeHistory } from '@tiptap/pm/history'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

export interface Chapter {
  id: string
  pos: number
  body: number
  end: number
  level: number
  text: string
  topLevel: boolean
  parent: number | null
}

const indexes = new WeakMap<PMNode, ReturnType<typeof collectChapters>>()

function siblingKey(chapter: Chapter) {
  return `${chapter.parent ?? 'root'}:${chapter.level}`
}

function collectChapters(doc: PMNode) {
  const chapters: Chapter[] = []
  const stack: Chapter[] = []
  const siblings = new Map<string, Chapter[]>()
  const byPos = new Map<number, Chapter>()
  doc.descendants((node, pos, parent) => {
    if (node.type.name !== 'heading') return
    const level = Number(node.attrs.level ?? 1)
    const topLevel = doc === parent
    const body = pos + node.nodeSize
    if (topLevel) {
      while (stack.length && stack[stack.length - 1].level >= level) stack.pop()!.end = pos
    }
    const text = node.textBetween(0, node.content.size, ' ', (leaf) => {
      if (leaf.type.name === 'mathInline') return String(leaf.attrs.latex ?? '')
      return leaf.type.name === 'hardBreak' ? ' ' : ''
    }).trim()
    const chapter = { id: `doc-section-${chapters.length + 1}`, pos, body, end: topLevel ? doc.content.size : body,
      level, text: text || '（空标题）', topLevel, parent: stack.at(-1)?.pos ?? null }
    chapters.push(chapter)
    byPos.set(pos, chapter)
    if (topLevel) {
      stack.push(chapter)
      const key = siblingKey(chapter)
      const group = siblings.get(key)
      if (group) group.push(chapter)
      else siblings.set(key, [chapter])
    }
  })
  return { chapters, byPos, siblings }
}

export function chapterIndex(doc: PMNode) {
  const cached = indexes.get(doc)
  if (cached) return cached
  const index = collectChapters(doc)
  indexes.set(doc, index)
  return index
}

export function chapterSiblings(doc: PMNode, chapter: Chapter): Chapter[] {
  return chapter.topLevel ? chapterIndex(doc).siblings.get(siblingKey(chapter)) ?? [] : []
}

export function contentsEntries(doc: PMNode, title: string): Chapter[] {
  return chapterIndex(doc).chapters.filter((chapter) => !(chapter.pos === 0 && chapter.level === 1 && chapter.text === title.trim()))
}

interface ChapterState {
  folded: ReadonlySet<number>
  decorations: DecorationSet
}

interface ChapterUpdate {
  toggle?: number
  move?: { from: number; end: number; insertAt: number }
}

export const chapterKey = new PluginKey<ChapterState>('chapters')

function decorate(doc: PMNode, folded: ReadonlySet<number>, editor: Editor): DecorationSet {
  const { chapters } = chapterIndex(doc)
  const ranges = chapters.filter((chapter) => folded.has(chapter.pos))
  const marks = chapters.map((chapter) => Decoration.node(chapter.pos, chapter.body, { id: chapter.id }))
  if (ranges.length) {
    doc.forEach((node, pos) => {
      if (ranges.some((chapter) => pos >= chapter.body && pos < chapter.end)) {
        marks.push(Decoration.node(pos, pos + node.nodeSize, { class: 'zh-chapter-hidden' }))
      }
    })
    for (const chapter of ranges) {
      marks.push(Decoration.widget(chapter.body - 1, () => {
        const button = document.createElement('button')
        button.type = 'button'
        button.className = 'zh-chapter-expand'
        button.contentEditable = 'false'
        button.textContent = '展开章节'
        button.addEventListener('click', () => toggleChapter(editor, chapter.pos))
        return button
      }, {
        key: `expand-chapter-${chapter.pos}`,
        ignoreSelection: true,
        stopEvent: () => true,
      }))
    }
  }
  return DecorationSet.create(doc, marks)
}

export const ChapterManagement = Extension.create({
  name: 'chapterManagement',
  addProseMirrorPlugins() {
    const editor = this.editor
    return [new Plugin<ChapterState>({
      key: chapterKey,
      state: {
        init: (_, state) => ({ folded: new Set(), decorations: decorate(state.doc, new Set(), editor) }),
        apply(tr, previous) {
          const update = tr.getMeta(chapterKey) as ChapterUpdate | undefined
          if (!tr.docChanged && !tr.selectionSet && !update) return previous
          if (!tr.docChanged && !previous.folded.size && !update) return previous
          const index = chapterIndex(tr.doc)
          const folded = new Set<number>()
          for (const old of previous.folded) {
            const moved = update?.move
            const mapped = tr.mapping.mapResult(old, 1)
            if (moved && old >= moved.from && old < moved.end) folded.add(moved.insertAt + old - moved.from)
            else if (!mapped.deleted) folded.add(mapped.pos)
          }
          if (update?.toggle !== undefined) {
            if (folded.has(update.toggle)) folded.delete(update.toggle)
            else folded.add(update.toggle)
          }
          for (const pos of folded) {
            const chapter = index.byPos.get(pos)
            if (!chapter?.topLevel || chapter.body >= chapter.end ||
                (tr.selection.from < chapter.end && tr.selection.to >= chapter.body)) folded.delete(pos)
          }
          if (!tr.docChanged && folded.size === previous.folded.size && [...folded].every((pos) => previous.folded.has(pos))) return previous
          return { folded, decorations: decorate(tr.doc, folded, editor) }
        },
      },
      props: { decorations: (state) => chapterKey.getState(state)?.decorations },
    })]
  },
})

export function toggleChapter(editor: Editor, pos: number): void {
  const { state, view } = editor
  const chapter = chapterIndex(state.doc).byPos.get(pos)
  if (!chapter?.topLevel || chapter.body === chapter.end) return
  const folding = !chapterKey.getState(state)?.folded.has(pos)
  const tr = state.tr.setMeta(chapterKey, { toggle: pos } satisfies ChapterUpdate).setMeta('addToHistory', false)
  if (folding && tr.selection.from < chapter.end && tr.selection.to >= chapter.body) {
    tr.setSelection(TextSelection.create(tr.doc, pos + 1))
  }
  view.dispatch(tr)
}

export function canMoveChapter(doc: PMNode, from: number, target: number, side: 'before' | 'after'): boolean {
  const { byPos } = chapterIndex(doc)
  const chapter = byPos.get(from)
  const other = byPos.get(target)
  if (!chapter?.topLevel || !other?.topLevel || chapter.level !== other.level || chapter.parent !== other.parent) return false
  const destination = side === 'before' ? other.pos : other.end
  return destination < chapter.pos || destination > chapter.end
}

export function moveChapter(editor: Editor, from: number, target: number, side: 'before' | 'after'): number | null {
  const { state, view } = editor
  if (!canMoveChapter(state.doc, from, target, side)) return null
  const { byPos } = chapterIndex(state.doc)
  const chapter = byPos.get(from)!
  const other = byPos.get(target)!
  const destination = side === 'before' ? other.pos : other.end
  const content = state.doc.slice(chapter.pos, chapter.end).content
  const tr = closeHistory(state.tr).delete(chapter.pos, chapter.end)
  const insertAt = tr.mapping.map(destination)
  tr.insert(insertAt, content)
  tr.setSelection(TextSelection.create(tr.doc, insertAt + 1))
  tr.setMeta(chapterKey, { move: { from: chapter.pos, end: chapter.end, insertAt } } satisfies ChapterUpdate)
  view.dispatch(tr.scrollIntoView())
  return insertAt
}
