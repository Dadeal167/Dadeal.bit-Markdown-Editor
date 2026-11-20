import { Extension, Node, type Editor } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { NodeSelection, Plugin, PluginKey, Selection, TextSelection } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react'
import { useCallback, useSyncExternalStore } from 'react'
import { objectId, objectKind, objectName, type ObjectKind } from './objectMarkup'

export interface DocumentObject {
  id: string
  kind: ObjectKind
  pos: number
  size: number
  caption: string
  title: string
  number: string
}

const indexes = new WeakMap<PMNode, ReturnType<typeof buildIndex>>()

function buildIndex(doc: PMNode) {
  const items: DocumentObject[] = []
  const byId = new Map<string, DocumentObject | null>()
  const byPos = new Map<number, DocumentObject>()
  const references: { pos: number; id: string }[] = []
  const counters = { fig: 0, tab: 0 }
  doc.descendants((node, pos) => {
    if (node.type.name === 'objectReference') references.push({ pos, id: node.attrs.target })
    if (node.type.name !== 'image' && node.type.name !== 'table') return
    const kind = node.type.name === 'image' ? 'fig' : 'tab'
    const id = objectId(node.attrs.objectId, kind)
    const caption = String(node.attrs.caption ?? '')
    const title = kind === 'fig' ? String(node.attrs.alt || node.attrs.title || '图片')
      : `${node.childCount} 行 × ${node.firstChild?.childCount ?? 0} 列`
    const number = id ? `${objectName(kind)} ${++counters[kind]}` : ''
    const item: DocumentObject = { id, kind, pos, size: node.nodeSize, caption, title, number }
    items.push(item)
    byPos.set(pos, item)
    if (id) byId.set(id, byId.has(id) ? null : item)
  })
  return { items, byId, byPos, references }
}

export function indexObjects(doc: PMNode) {
  const cached = indexes.get(doc)
  if (cached) return cached
  const index = buildIndex(doc)
  indexes.set(doc, index)
  return index
}

const objectDecorationKey = new PluginKey<DecorationSet>('objectNumbering')
export const ObjectNumbering = Extension.create({
  name: 'objectNumbering',
  addProseMirrorPlugins() {
    const decorate = (doc: PMNode) => {
      const index = indexObjects(doc)
      return DecorationSet.create(doc, index.items.filter((item) => item.id)
        .map((item) => Decoration.node(item.pos, item.pos + item.size, {
          ...(index.byId.get(item.id) ? { id: `object-${item.id}` } : {}),
          style: `--object-number: ${JSON.stringify(item.number + (item.caption ? '　' : ''))}`,
        })))
    }
    return [new Plugin({
      key: objectDecorationKey,
      state: { init: (_, state) => decorate(state.doc), apply: (tr, old) => tr.docChanged ? decorate(tr.doc) : old },
      props: { decorations: (state) => objectDecorationKey.getState(state) },
    })]
  },
})

export function objectReferenceText(doc: PMNode, id: string): string {
  return indexObjects(doc).byId.get(id)?.number ?? `${objectName(objectKind(id))} ?`
}

export function gotoDocumentNode(editor: Editor, pos: number): void {
  const node = editor.state.doc.nodeAt(pos)
  if (!node) return
  const dom = editor.view.nodeDOM(pos)
  editor.chain().focus().command(({ tr }) => {
    tr.setSelection(NodeSelection.isSelectable(node) ? NodeSelection.create(tr.doc, pos)
      : Selection.near(tr.doc.resolve(pos)))
    return true
  }).run()
  if (dom instanceof HTMLElement) dom.scrollIntoView({ block: 'center', inline: 'nearest' })
}

export function updateObjectCaption(editor: Editor, pos: number, caption: string | null, insert = false): boolean {
  const index = indexObjects(editor.state.doc)
  const item = index.byPos.get(pos)
  if (!item) return false
  let id = caption === null ? '' : item.id
  if (caption !== null && (!id || index.byId.get(id) === null)) {
    const reserved = new Set([...index.byId.keys(), ...index.references.map((ref) => ref.id)])
    let suffix = 1
    do { id = `${item.kind}-${suffix++}` } while (reserved.has(id))
  }
  return editor.chain().focus().command(({ tr }) => {
    const node = tr.doc.nodeAt(pos)
    if (!node) return false
    if (insert && !(tr.selection instanceof TextSelection)) {
      const after = tr.doc.resolve(tr.selection.to)
      const paragraph = editor.schema.nodes.paragraph
      if (after.parent.inlineContent) tr.setSelection(TextSelection.create(tr.doc, after.pos))
      else if (after.parent.canReplaceWith(after.index(), after.index(), paragraph)) {
        tr.insert(after.pos, paragraph.create())
        tr.setSelection(TextSelection.create(tr.doc, after.pos + 1))
      } else {
        const next = Selection.findFrom(after, 1, true) ?? Selection.findFrom(after, -1, true)
        if (!next) return false
        tr.setSelection(next)
      }
    }
    tr.setNodeMarkup(tr.mapping.map(pos), undefined, { ...node.attrs, objectId: id, caption: caption ?? '' })
    if (insert) tr.replaceSelectionWith(editor.schema.nodes.objectReference.create({ target: id }), false)
    return true
  }).run()
}

function ReferenceView({ editor, node }: NodeViewProps) {
  const id = objectId(node.attrs.target)
  const subscribe = useCallback((refresh: () => void) => {
    editor.on('transaction', refresh)
    return () => { editor.off('transaction', refresh) }
  }, [editor])
  const text = useSyncExternalStore(subscribe, () => objectReferenceText(editor.state.doc, id))
  const linked = Boolean(indexObjects(editor.state.doc).byId.get(id))
  return (
    <NodeViewWrapper as="span" className="zh-object-ref" data-dadealbit-ref={id}>
      {linked ? <a href={`#object-${id}`} title="跳转到引用的图表" onClick={(event) => {
        event.preventDefault()
        const target = indexObjects(editor.state.doc).byId.get(id)
        if (target) gotoDocumentNode(editor, target.pos)
      }}>{text}</a> : <span data-unresolved="true" title={`图表引用失效（${id}）`}>{text}</span>}
    </NodeViewWrapper>
  )
}

export const ObjectReference = Node.create({
  name: 'objectReference',
  group: 'inline',
  inline: true,
  atom: true,
  addAttributes() {
    return { target: { default: '', rendered: false, parseHTML: el => objectId(el.getAttribute('data-dadealbit-ref')) } }
  },
  parseHTML() {
    return [{ tag: 'span[data-dadealbit-ref]', getAttrs: el => objectId(el.getAttribute('data-dadealbit-ref')) ? null : false }]
  },
  renderHTML({ node }) {
    const target = objectId(node.attrs.target)
    return ['span', { 'data-dadealbit-ref': target }, objectName(objectKind(target))]
  },
  addNodeView() { return ReactNodeViewRenderer(ReferenceView) },
  addStorage() {
    return { markdown: { serialize(state: { write(text: string): void }, node: PMNode) {
      const id = objectId(node.attrs.target)
      state.write(`<span data-dadealbit-ref="${id}">${objectName(objectKind(id))}</span>`)
    } } }
  },
})
