import type { Editor } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { NodeSelection, Plugin, PluginKey, TextSelection } from '@tiptap/pm/state'
import { Extension } from '@tiptap/core'
import { repairLatex } from './latexRepair'
import { documentMacros } from './documentMacros'
import {
  equationLabels, equationMarkup, equationReferences, manualEquationTag, standaloneEquationReference, substituteEquationReferences,
} from './equationSyntax'

export interface EquationEntry {
  pos: number
  latex: string
  display: boolean
  label?: string
  number?: string
  manual: boolean
  parentheses: boolean
  suppressed: boolean
}

interface EquationIndex {
  entries: EquationEntry[]
  byPos: Map<number, EquationEntry>
  byLabel: Map<string, EquationEntry | null>
  referenced: Set<string>
}

export const equationNumberingKey = new PluginKey<boolean>('equationNumbering')
export const EquationNumbering = Extension.create({
  name: 'equationNumbering',
  addProseMirrorPlugins() {
    return [new Plugin({
      key: equationNumberingKey,
      state: {
        init: () => false,
        apply: (transaction, previous) => transaction.getMeta(equationNumberingKey) ?? previous,
      },
    })]
  },
})

const caches = [new WeakMap<PMNode, EquationIndex>(), new WeakMap<PMNode, EquationIndex>()]

export function indexEquations(doc: PMNode, numberAll: boolean): EquationIndex {
  const cache = caches[numberAll ? 1 : 0]
  const cached = cache.get(doc)
  if (cached) return cached
  const index: EquationIndex = { entries: [], byPos: new Map(), byLabel: new Map(), referenced: new Set() }
  let next = 1
  doc.descendants((node, pos) => {
    const display = node.type.name === 'mathBlock'
    if (!display && node.type.name !== 'mathInline') return
    const latex = String(node.attrs.latex ?? '')
    const names = display ? [...new Set(equationLabels(latex))] : []
    const tag = display ? manualEquationTag(latex) : null
    const { core, suppressed } = equationMarkup(latex)
    const number = tag ? tag.value || undefined : (display && core.trim() && !suppressed && (numberAll || names.length > 0)
      ? String(next++) : undefined)
    const entry: EquationEntry = {
      pos, latex, display, label: names[0], number, manual: !!tag, parentheses: tag?.parentheses ?? true, suppressed,
    }
    index.entries.push(entry)
    index.byPos.set(pos, entry)
    for (const name of names) index.byLabel.set(name, index.byLabel.has(name) ? null : entry)
    for (const name of equationReferences(latex)) index.referenced.add(name)
  })
  cache.set(doc, index)
  return index
}

export function editorEquations(editor: Editor, doc = editor.state.doc): EquationIndex {
  return indexEquations(doc, equationNumberingKey.getState(editor.state) === true)
}

export function screenEquation(editor: Editor, pos: number | undefined, latex: string): string {
  const index = editorEquations(editor)
  const item = pos === undefined ? undefined : index.byPos.get(pos)
  const value = substituteEquationReferences(equationMarkup(latex).core, (label) => index.byLabel.get(label)?.number)
  return item?.display && item.number && !item.manual ? value + `\\tag{${item.number}}` : value
}

export function exportEquation(index: EquationIndex, entry: EquationEntry) {
  const { core } = equationMarkup(entry.latex)
  const tag = entry.display ? manualEquationTag(core) : null
  const latex = substituteEquationReferences(
    tag ? core.slice(0, tag.from) + core.slice(tag.to) : core,
    (label) => index.byLabel.get(label)?.number,
  ).trim()
  const ref = entry.display ? null : standaloneEquationReference(entry.latex)
  const target = ref ? index.byLabel.get(ref.label) : undefined
  return { latex, number: entry.number, parentheses: entry.parentheses, ref, target }
}

export function gotoEquation(editor: Editor, pos: number): void {
  if (editor.state.doc.nodeAt(pos)?.type.name !== 'mathBlock') return
  editor.chain().focus().setNodeSelection(pos).scrollIntoView().run()
}

export function insertEquationReference(editor: Editor, pos: number): boolean {
  const index = editorEquations(editor)
  const entry = index.byPos.get(pos)
  if (!entry?.display || !equationMarkup(entry.latex).core.trim() ||
      (entry.suppressed && !entry.number) || (entry.label && !index.byLabel.get(entry.label))) return false
  let label = entry.label
  if (!label) {
    let suffix = 1
    while (index.byLabel.has('eq:' + suffix) || index.referenced.has('eq:' + suffix)) suffix += 1
    label = 'eq:' + suffix
  }
  return editor.chain().focus().command(({ tr }) => {
    const node = tr.doc.nodeAt(pos)
    if (node?.type.name !== 'mathBlock') return false
    if (!entry.label) tr.setNodeMarkup(pos, undefined, { ...node.attrs, latex: entry.latex + ` \\label{${label}}` })
    if (tr.selection instanceof NodeSelection) {
      tr.setSelection(TextSelection.near(tr.doc.resolve(tr.selection.to)))
    }
    return true
  }).insertMathInline(`\\eqref{${label}}`).run()
}

export function equationNumberText(number: string, parentheses: boolean): string {
  const plain = number.replace(/^\\text\{([^{}]*)\}$/, '$1')
  return parentheses ? `(${plain})` : plain
}

/** 以序列化后的公式为键，保留重复出现的相同公式在文档中的顺序。 */
export function createEquationExportResolver(editor: Editor, mapLatex?: (latex: string) => string, doc = editor.state.doc) {
  const index = editorEquations(editor, doc)
  const { macros } = documentMacros(doc)
  const queues = new Map<string, { entries: EquationEntry[]; offset: number }>()
  const keyOf = (latex: string, display: boolean) => (display ? 'D' : 'I') + latex.trim()
  for (const entry of index.entries) {
    const key = keyOf(repairLatex(entry.latex, entry.display, macros), entry.display)
    const queue = queues.get(key)
    if (queue) queue.entries.push(entry)
    else queues.set(key, { entries: [entry], offset: 0 })
  }
  return (latex: string, display: boolean) => {
    const queue = queues.get(keyOf(latex, display))
    const entry = queue?.entries[queue.offset++]
    if (!entry) return undefined
    const equation = exportEquation(index, entry)
    return mapLatex ? { ...equation, latex: mapLatex(equation.latex) } : equation
  }
}
