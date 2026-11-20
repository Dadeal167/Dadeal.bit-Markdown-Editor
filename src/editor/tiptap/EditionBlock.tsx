import { Node, type Editor } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { closeHistory } from '@tiptap/pm/history'
import { Selection } from '@tiptap/pm/state'
import { findWrapping } from '@tiptap/pm/transform'
import { NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react'
import { editionBlockLabels, editionBlockKind, type EditionBlockKind } from '../publication/editions'
import type { ScholarSerializer } from './scholarMarkdown'

function EditionBlockView({ editor, node, getPos, updateAttributes }: NodeViewProps) {
  const kind = editionBlockKind(node.attrs.kind)
  const unwrap = () => {
    const pos = getPos()
    if (pos === undefined) return
    const tr = editor.state.tr.replaceWith(pos, pos + node.nodeSize, node.content)
    editor.view.dispatch(closeHistory(tr.setSelection(Selection.near(tr.doc.resolve(pos), 1)).scrollIntoView()))
    editor.view.focus()
  }
  return <NodeViewWrapper className="zh-edition-block" data-edition-kind={kind}>
    <div className="zh-edition-block__head" contentEditable={false}>
      <select className="zh-input" aria-label="分版块类型" value={kind} onChange={(event) => updateAttributes({ kind: event.target.value })}>
        {Object.entries(editionBlockLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
      </select>
      <span className="zh-edition-block__label">{editionBlockLabels[kind]}</span>
      <button type="button" className="zh-plain-link" onClick={unwrap}>转为正文</button>
    </div>
    <NodeViewContent />
  </NodeViewWrapper>
}

function parseEditionBlocks(root: HTMLElement) {
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_COMMENT)
  const markers: Comment[] = []
  for (let comment = walker.nextNode(); comment; comment = walker.nextNode()) markers.push(comment as Comment)
  const open = new Map<ParentNode, { marker: Comment; kind: string }[]>()
  for (const marker of markers) {
    const parent = marker.parentNode
    if (!parent) continue
    const text = marker.data.trim()
    const start = /^dadealbit:edition (hint|answer|solution)$/u.exec(text)
    if (start) {
      const stack = open.get(parent) ?? []
      stack.push({ marker, kind: start[1] })
      open.set(parent, stack)
    } else if (text === '/dadealbit:edition') {
      const start = open.get(parent)?.pop()
      if (!start) continue
      const block = root.ownerDocument.createElement('div')
      block.dataset.editionKind = start.kind
      while (start.marker.nextSibling && start.marker.nextSibling !== marker) block.append(start.marker.nextSibling)
      start.marker.replaceWith(block)
      marker.remove()
    }
  }
}

export const EditionBlock = Node.create({
  name: 'editionBlock', group: 'block', content: 'block+', isolating: true,
  addAttributes() {
    return { kind: { default: 'solution', parseHTML: (el: HTMLElement) => editionBlockKind(el.dataset.editionKind), rendered: false } }
  },
  parseHTML() { return [{ tag: 'div[data-edition-kind]' }] },
  renderHTML({ node }) { return ['div', { 'data-edition-kind': editionBlockKind(node.attrs.kind) }, 0] },
  addNodeView() { return ReactNodeViewRenderer(EditionBlockView) },
  addStorage() {
    return { markdown: { parse: { updateDOM: parseEditionBlocks }, serialize(state: ScholarSerializer, node: PMNode) {
      state.wrapBlock('', '', node, () => {
        state.write(`<!-- dadealbit:edition ${editionBlockKind(node.attrs.kind)} -->`)
        state.ensureNewLine()
        state.write('\n')
        state.renderContent(node)
        state.write('<!-- /dadealbit:edition -->')
      })
    } } }
  },
})

export function insertEditionBlock(editor: Editor, kind: EditionBlockKind) {
  const { selection, schema } = editor.state
  const { $from, $to } = selection
  for (let depth = $from.depth; depth > 0; depth--) {
    if ($from.node(depth).type !== schema.nodes.editionBlock || $to.pos > $from.end(depth)) continue
    const pos = $from.before(depth)
    editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { kind }))
    editor.view.focus()
    return true
  }
  const range = $from.blockRange($to, (parent) => parent === editor.state.doc)
  if (!selection.empty && range) {
    const wrapping = findWrapping(range, schema.nodes.editionBlock, { kind })
    if (!wrapping) return false
    editor.view.dispatch(closeHistory(editor.state.tr.wrap(range, wrapping).scrollIntoView()))
  } else {
    const pos = $from.depth > 0 ? $from.after(1) : $from.pos
    const block = schema.nodes.editionBlock.createAndFill({ kind })
    if (!block) return false
    const tr = editor.state.tr.insert(pos, block)
    editor.view.dispatch(tr.setSelection(Selection.near(tr.doc.resolve(pos + 1), 1)).scrollIntoView())
  }
  editor.view.focus()
  return true
}
