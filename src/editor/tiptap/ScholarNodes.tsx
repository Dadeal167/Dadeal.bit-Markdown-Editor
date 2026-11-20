import { Node, type Editor } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { NodeSelection } from '@tiptap/pm/state'
import { NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react'
import { useCallback, useEffect, useState, useSyncExternalStore, type MouseEvent } from 'react'
import { refKind, refLabel, scholarIndex, SCHOLAR_KEY, STATEMENT_NAMES, statementKind } from '../scholarIndex'
import { parseStatements, registerScholarSyntax, serializeStatement, type ScholarSerializer } from './scholarMarkdown'

export function useScholarIndex(editor: Editor) {
  const subscribe = useCallback((refresh: () => void) => {
    editor.on('transaction', refresh)
    return () => { editor.off('transaction', refresh) }
  }, [editor])
  const doc = useSyncExternalStore(subscribe, () => editor.state.doc)
  return scholarIndex(doc)
}

function jump(event: MouseEvent, anchor: string) {
  event.preventDefault()
  event.stopPropagation()
  const target = document.getElementById(anchor)
  target?.scrollIntoView({ block: 'center', inline: 'nearest' })
  target?.focus({ preventScroll: true })
}

function ReferenceView({ editor, getPos, node }: NodeViewProps) {
  const index = useScholarIndex(editor)
  const link = index.links.get(getPos() ?? -1)
  const body = link?.target ? <a className="zh-scholar-ref" href={`#${link.target.anchor}`}
    onClick={(event) => jump(event, link.target!.anchor)}>{refLabel(link)}</a>
    : <span title={`未找到引用 ${node.attrs.key}`} className="zh-scholar-missing">{refLabel(link)}</span>
  return <NodeViewWrapper as="span" id={link?.anchor} tabIndex={-1} data-scholar-kind={node.attrs.kind}>
    {node.attrs.kind === 'footnote' ? <sup>{body}</sup> : body}
  </NodeViewWrapper>
}

function FootnoteView({ editor, getPos }: NodeViewProps) {
  const index = useScholarIndex(editor)
  const entry = index.footnoteNodes.get(getPos() ?? -1)
  const backlinks = entry ? index.backlinks.get(entry.anchor) ?? [] : []
  return <NodeViewWrapper className="zh-footnote" id={entry?.anchor} tabIndex={-1}>
    <div className="zh-scholar-heading" contentEditable={false}>
      {backlinks.length ? `脚注 ${entry?.label}` : '脚注 · 未引用'}
      {backlinks.map((link, i) => <a key={link.anchor} href={`#${link.anchor}`}
        aria-label={`返回正文第 ${i + 1} 处脚注引用`} onClick={(event) => jump(event, link.anchor)}>{backlinks.length === 1 ? '↩' : `↩${i + 1}`}</a>)}
    </div>
    <NodeViewContent />
  </NodeViewWrapper>
}

function StatementView({ editor, node, getPos, updateAttributes }: NodeViewProps) {
  const entry = useScholarIndex(editor).statementNodes.get(getPos() ?? -1)
  const [collapsed, setCollapsed] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const proof = node.attrs.kind === 'PROOF'
  useEffect(() => {
    if (!collapsed) return
    const reveal = () => {
      const pos = getPos()
      if (pos !== undefined && editor.state.selection.from > pos && editor.state.selection.from < pos + node.nodeSize) setCollapsed(false)
    }
    editor.on('selectionUpdate', reveal)
    return () => { editor.off('selectionUpdate', reveal) }
  }, [collapsed, editor, node.nodeSize, getPos])
  return <NodeViewWrapper className="zh-statement" id={entry?.anchor} tabIndex={-1} data-kind={node.attrs.kind}>
    <div className="zh-scholar-heading" contentEditable={false}>
      <strong>{entry?.label ?? STATEMENT_NAMES[statementKind(node.attrs.kind)]}</strong>
      {editing ? <><span className="zh-scholar-title-print">{node.attrs.title}</span><form onSubmit={(event) => { event.preventDefault(); updateAttributes({ title: draft.trim() }); setEditing(false) }}>
        <input className="zh-input" aria-label="结构块标题" autoFocus value={draft} onChange={(event) => setDraft(event.target.value)} />
        <button type="submit" className="zh-plain-link">保存标题</button>
        <button type="button" className="zh-plain-link" onClick={() => setEditing(false)}>取消</button>
      </form></> : <>
        {node.attrs.title && <span>{node.attrs.title}</span>}
        <button type="button" className="zh-plain-link zh-scholar-edit zh-scholar-edit-title" onClick={() => { setDraft(node.attrs.title); setEditing(true) }}>编辑标题</button>
      </>}
      {proof && <button type="button" className="zh-plain-link zh-scholar-edit" aria-expanded={!collapsed} onClick={() => {
        const pos = getPos()
        const { selection } = editor.state
        if (!collapsed && pos !== undefined && selection.from > pos && selection.to < pos + node.nodeSize) {
          editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, pos)).setMeta('addToHistory', false))
        }
        setCollapsed((value) => !value)
      }}>{collapsed ? '展开证明' : '折叠证明'}</button>}
    </div>
    <NodeViewContent className={proof && collapsed ? 'zh-proof-collapsed' : undefined} />
  </NodeViewWrapper>
}

const validKey = (key: string | null) => key && SCHOLAR_KEY.test(key) ? key : ''

export const ScholarReference = Node.create({
  name: 'scholarReference', inline: true, group: 'inline', atom: true,
  addAttributes() {
    return {
      key: { default: '', parseHTML: (el: HTMLElement) => validKey(el.getAttribute('data-scholar-key')), rendered: false },
      kind: { default: 'footnote', parseHTML: (el: HTMLElement) => refKind(el.getAttribute('data-scholar-ref')), rendered: false },
    }
  },
  parseHTML() { return [{ tag: 'span[data-scholar-ref][data-scholar-key]' }] },
  renderHTML({ node }) { return ['span', { 'data-scholar-ref': node.attrs.kind, 'data-scholar-key': node.attrs.key }] },
  addNodeView() { return ReactNodeViewRenderer(ReferenceView) },
  addStorage() {
    return { markdown: {
      parse: { setup: registerScholarSyntax },
      serialize(state: ScholarSerializer, node: PMNode) {
        const lead = node.attrs.kind === 'footnote' ? '^' : node.attrs.kind === 'statement' ? '@stmt:' : '@'
        state.write(`[${lead}${node.attrs.key}]`)
      },
    } }
  },
})

export const FootnoteDefinition = Node.create({
  name: 'footnoteDefinition', group: 'block', content: 'block+', isolating: true,
  addAttributes() { return { key: { default: '', parseHTML: (el: HTMLElement) => validKey(el.getAttribute('data-scholar-note')), rendered: false } } },
  parseHTML() { return [{ tag: 'div[data-scholar-note]' }] },
  renderHTML({ node }) { return ['div', { 'data-scholar-note': node.attrs.key }, 0] },
  addNodeView() { return ReactNodeViewRenderer(FootnoteView) },
  addStorage() { return { markdown: { serialize(state: ScholarSerializer, node: PMNode) {
    state.wrapBlock('    ', `[^${node.attrs.key}]: `, node, () => state.renderContent(node))
  } } } },
})

export const MathStatement = Node.create({
  name: 'mathStatement', group: 'block', content: 'block+', isolating: true,
  addAttributes() {
    return {
      key: { default: '', parseHTML: (el: HTMLElement) => validKey(el.getAttribute('data-scholar-key')), rendered: false },
      kind: { default: 'THEOREM', parseHTML: (el: HTMLElement) => statementKind(el.getAttribute('data-scholar-statement')), rendered: false },
      title: { default: '', parseHTML: (el: HTMLElement) => el.getAttribute('data-scholar-title') ?? '', rendered: false },
    }
  },
  parseHTML() { return [{ tag: 'div[data-scholar-statement]' }] },
  renderHTML({ node }) { return ['div', { 'data-scholar-statement': node.attrs.kind, 'data-scholar-key': node.attrs.key, 'data-scholar-title': node.attrs.title }, 0] },
  addNodeView() { return ReactNodeViewRenderer(StatementView) },
  addStorage() {
    return { markdown: { parse: { updateDOM: parseStatements }, serialize(state: ScholarSerializer, node: PMNode) {
      serializeStatement(state, node, statementKind(node.attrs.kind))
    } } }
  },
})

export function ScholarBibliography({ editor }: { editor: Editor }) {
  const bibliography = [...useScholarIndex(editor).bibliography.values()]
  if (!bibliography.length) return null
  return <section className="zh-bibliography" aria-label="参考文献">
    <h2>参考文献</h2>
    {bibliography.map((entry) => <p tabIndex={-1} id={entry.anchor} key={entry.key}>{entry.label} {entry.text}</p>)}
  </section>
}
