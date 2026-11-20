import { InputRule, Node } from '@tiptap/core'
import type MarkdownIt from 'markdown-it'
import { Plugin } from '@tiptap/pm/state'

export const WIKI_LINK = /\[\[([^\[\]\r\n|#\\]*)(#[^\[\]\r\n|\\]+)?(\\?\|[^\[\]\r\n]+)?\]\]/gu
export const wikiLinkEvent = 'dadealbit:wiki-link'

export function parseWikiLink(raw: string) {
  const match = new RegExp(WIKI_LINK.source, 'u').exec(raw)
  if (match?.[0] !== raw) return null
  const name = match[1].trim()
  const fragment = match[2] ?? ''
  if (!name && !fragment) return null
  return { name, fragment, alias: match[3] ?? '', label: match[3]?.replace(/^\\?\|/, '').trim() || name + fragment }
}

const installed = new WeakSet<MarkdownIt>()
export function registerWikiLinks(md: MarkdownIt) {
  if (installed.has(md)) return
  installed.add(md)
  md.inline.ruler.before('link', 'wiki_link', (state, silent) => {
    if (!state.src.startsWith('[[', state.pos)) return false
    const end = state.src.indexOf(']]', state.pos + 2)
    if (end < 0 || end + 2 > state.posMax) return false
    const raw = state.src.slice(state.pos, end + 2)
    const link = parseWikiLink(raw)
    if (!link) return false
    if (!silent) {
      const open = state.push('wiki_link_open', 'span', 1)
      open.attrSet('data-wiki-link', raw)
      state.push('text', '', 0).content = link.label
      state.push('wiki_link_close', 'span', -1)
    }
    state.pos = end + 2
    return true
  })
}

export const WikiLink = Node.create({
  name: 'wikiLink',
  inline: true,
  group: 'inline',
  atom: true,
  addAttributes() {
    return { raw: { default: '', rendered: false, parseHTML: (el: HTMLElement) => el.getAttribute('data-wiki-link') ?? '' } }
  },
  parseHTML() { return [{ tag: 'span[data-wiki-link]', getAttrs: (el) => parseWikiLink(el.dataset.wikiLink ?? '') ? null : false }] },
  renderHTML({ node }) {
    return ['span', { 'data-wiki-link': node.attrs.raw, tabindex: '0', role: 'link', title: node.attrs.raw },
      parseWikiLink(node.attrs.raw)?.label ?? node.attrs.raw]
  },
  renderText({ node }) { return node.attrs.raw },
  addInputRules() {
    return [new InputRule({ find: new RegExp(WIKI_LINK.source + '$', 'u'), handler: ({ range, match, state }) => {
      if (parseWikiLink(match[0])) state.tr.replaceWith(range.from, range.to, this.type.create({ raw: match[0] }))
    } })]
  },
  addProseMirrorPlugins() {
    const activate = (event: MouseEvent | KeyboardEvent) => {
      const link = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-wiki-link]') : null
      if (!link?.dataset.wikiLink) return false
      event.preventDefault()
      link.dispatchEvent(new CustomEvent(wikiLinkEvent, { detail: link.dataset.wikiLink, bubbles: true }))
      return true
    }
    return [new Plugin({ props: {
      handleDOMEvents: {
        click: (_view, event) => activate(event),
        keydown: (_view, event) => event.key === 'Enter' && activate(event),
      },
    } })]
  },
  addStorage() {
    return { markdown: {
      parse: { setup: registerWikiLinks },
      serialize(state: { write(text: string): void; inTable?: boolean }, node: { attrs: Record<string, string> }) {
        state.write(state.inTable ? node.attrs.raw.replace(/\\\|/g, '|') : node.attrs.raw)
      },
    } }
  },
})
