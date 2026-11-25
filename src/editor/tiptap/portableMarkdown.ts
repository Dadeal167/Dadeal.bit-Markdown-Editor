import { Node } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import type MarkdownIt from 'markdown-it'
import type { Node as PMNode } from '@tiptap/pm/model'
import { Plugin } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { ScholarSerializer } from './scholarMarkdown'
import { markdownFrontMatter } from '../markdownFrontMatter'

export const FrontMatter = Node.create({
  name: 'markdownFrontMatter', group: 'block', atom: true, selectable: false,
  addAttributes() {
    return { source: { default: '', rendered: false, parseHTML: (element: HTMLElement) => {
      try {
        const source = decodeURIComponent(element.dataset.markdownFrontMatter ?? '')
        return markdownFrontMatter(source) === source ? source : ''
      } catch { return '' }
    } } }
  },
  parseHTML() { return [{ tag: 'div[data-markdown-front-matter]' }] },
  renderHTML({ node }) {
    return ['div', { 'data-markdown-front-matter': encodeURIComponent(node.attrs.source), hidden: 'hidden' }]
  },
  addStorage() {
    // editorActions emits the header before applying Markdown and LaTeX normalization to the body.
    return { markdown: { serialize() {} } }
  },
})

const alertLabels = { NOTE: '说明', TIP: '提示', IMPORTANT: '重要', WARNING: '警告', CAUTION: '注意' }
type AlertKind = keyof typeof alertLabels
const alertKind = (value: string | undefined): AlertKind =>
  value && Object.hasOwn(alertLabels, value) ? value as AlertKind : 'NOTE'

const installed = new WeakSet<MarkdownIt>()
function registerPortableBlocks(md: MarkdownIt) {
  if (installed.has(md)) return
  installed.add(md)
  md.core.ruler.before('inline', 'dadealbit_portable_blocks', ({ tokens }) => {
    for (let index = 0; index < tokens.length - 2; index++) {
      const opening = tokens[index]
      const paragraph = tokens[index + 1]
      const inline = tokens[index + 2]
      if (paragraph.type !== 'paragraph_open' || inline.type !== 'inline') continue
      if (opening.type === 'list_item_open') {
        const task = /^\[([ xX])\](?:[ \t]+|(?=\n|$))/.exec(inline.content)
        if (!task) continue
        opening.attrSet('data-task-checked', String(task[1].toLowerCase() === 'x'))
        inline.content = inline.content.slice(task[0].length).replace(/^\n/, '')
      } else if (opening.type === 'blockquote_open') {
        const alert = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\][ \t]*(?:\n|$)/.exec(inline.content)
        if (!alert) continue
        opening.attrSet('data-github-alert', alert[1])
        inline.content = inline.content.slice(alert[0].length)
        if (!inline.content && tokens[index + 4]?.type !== 'blockquote_close') tokens.splice(index + 1, 3)
      }
    }
  })
}

export const GithubAlert = Node.create({
  name: 'githubAlert', group: 'block', content: 'block+', defining: true,
  addAttributes() {
    return { kind: { default: 'NOTE', rendered: false, parseHTML: (element: HTMLElement) => alertKind(element.dataset.githubAlert) } }
  },
  parseHTML() {
    return [{ tag: 'blockquote[data-github-alert]', priority: 60,
      contentElement: (element) => element.querySelector<HTMLElement>('[data-alert-content]') ?? element }]
  },
  renderHTML({ node }) {
    const kind = alertKind(node.attrs.kind)
    return ['blockquote', { 'data-github-alert': kind },
      ['strong', { class: 'zh-alert-label', contenteditable: 'false' }, alertLabels[kind]],
      ['div', { 'data-alert-content': '' }, 0]]
  },
  addStorage() {
    return { markdown: { parse: { setup: registerPortableBlocks }, serialize(state: ScholarSerializer, node: PMNode) {
      state.wrapBlock('> ', '> ', node, () => {
        state.write(`[!${alertKind(node.attrs.kind)}]\n`)
        state.renderContent(node)
      })
    } } }
  },
})

function taskWidgets(doc: PMNode, editable: () => boolean): DecorationSet {
  const widgets: Decoration[] = []
  doc.descendants((node, pos) => {
    if (node.type.name !== 'listItem' || typeof node.attrs.taskChecked !== 'boolean' || !node.firstChild?.isTextblock) return
    widgets.push(Decoration.widget(pos + 2, (view, getPos) => {
      const checkbox = document.createElement('input')
      checkbox.type = 'checkbox'
      checkbox.className = 'zh-task-checkbox'
      checkbox.checked = node.attrs.taskChecked
      checkbox.setAttribute('aria-label', '任务完成状态')
      checkbox.addEventListener('click', (event) => {
        const at = getPos()
        if (at === undefined || !editable()) {
          event.preventDefault()
          return
        }
        const location = view.state.doc.resolve(at)
        const depth = location.depth - 1
        if (depth < 1) {
          event.preventDefault()
          return
        }
        const item = location.node(depth)
        if (item.type.name !== 'listItem' || typeof item.attrs.taskChecked !== 'boolean') {
          event.preventDefault()
          return
        }
        view.dispatch(view.state.tr.setNodeMarkup(location.before(depth), undefined, { ...item.attrs, taskChecked: checkbox.checked }))
      })
      return checkbox
    }, { side: -1, key: `task-${node.attrs.taskChecked}`, stopEvent: () => true }))
  })
  return DecorationSet.create(doc, widgets)
}

// Keep StarterKit's listItem commands and schema so checked and ordinary items can share a list.
export const StarterKitWithTasks = StarterKit.extend({
  addExtensions() {
    return this.parent?.().map((extension) => extension instanceof Node && extension.name === 'listItem' ? extension.extend({
      addAttributes() {
        return { ...this.parent?.(), taskChecked: { default: null,
          parseHTML: (element: HTMLElement) => element.hasAttribute('data-task-checked') ? element.dataset.taskChecked === 'true' : null,
          renderHTML: (attrs: Record<string, unknown>) => typeof attrs.taskChecked === 'boolean'
            ? { 'data-task-checked': String(attrs.taskChecked) } : {},
        } }
      },
      addStorage() {
        return { ...this.parent?.(), markdown: { serialize(state: ScholarSerializer, node: PMNode) {
          if (typeof node.attrs.taskChecked === 'boolean') state.write(node.attrs.taskChecked ? '[x] ' : '[ ] ')
          state.renderContent(node)
        } } }
      },
      addProseMirrorPlugins() {
        const editable = () => this.editor.isEditable
        return [...(this.parent?.() ?? []), new Plugin<DecorationSet>({
          state: {
            init: (_, state) => taskWidgets(state.doc, editable),
            apply: (tr, current) => tr.docChanged ? taskWidgets(tr.doc, editable) : current,
          },
          props: { decorations(state) { return this.getState(state) } },
        })]
      },
    }) : extension) ?? []
  },
})

export function projectPortableBlocks(root: ParentNode) {
  for (const metadata of root.querySelectorAll('[data-markdown-front-matter]')) metadata.remove()
  for (const item of root.querySelectorAll<HTMLElement>('li[data-task-checked]')) {
    const paragraph = item.firstElementChild?.matches('p') ? item.firstElementChild : item
    paragraph.prepend(item.ownerDocument.createTextNode(item.dataset.taskChecked === 'true' ? '☑ ' : '☐ '))
  }
  for (const quote of root.querySelectorAll<HTMLElement>('blockquote[data-github-alert]')) {
    if (quote.querySelector(':scope > .zh-alert-label')) continue
    const label = quote.ownerDocument.createElement('strong')
    label.className = 'zh-alert-label'
    label.textContent = alertLabels[alertKind(quote.dataset.githubAlert)]
    quote.prepend(label)
  }
}
