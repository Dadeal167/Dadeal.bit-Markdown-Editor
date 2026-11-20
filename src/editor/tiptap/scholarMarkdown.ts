import type { Node as PMNode } from '@tiptap/pm/model'
import { SCHOLAR_KEY, STATEMENT_NAMES, type StatementKind } from '../scholarIndex'

interface Token {
  type: string
  content: string
  children: Token[] | null
  attrSet(name: string, value: string): void
}
interface InlineState { src: string; pos: number; posMax: number; push(type: string, tag: string, nesting: number): Token }
interface BlockState {
  src: string; line: number; bMarks: number[]; eMarks: number[]; tShift: number[]; sCount: number[]; blkIndent: number
  tokens: Token[]; env: object; md: MarkdownIt
  push(type: string, tag: string, nesting: number): Token
}
interface MarkdownIt {
  inline: { ruler: { before(at: string, name: string, rule: (state: InlineState, silent: boolean) => boolean): void } }
  block: {
    ruler: { before(at: string, name: string, rule: (state: BlockState, start: number, end: number, silent: boolean) => boolean, options: { alt: string[] }): void }
    parse(source: string, parser: MarkdownIt, env: object, target: Token[]): void
  }
}

export interface ScholarSerializer {
  write(text: string): void
  text(text: string, escape?: boolean): void
  ensureNewLine(): void
  renderContent(node: PMNode): void
  wrapBlock(indent: string, lead: string, node: PMNode, render: () => void): void
}

const registered = new WeakSet<MarkdownIt>()

export function registerScholarSyntax(md: MarkdownIt): void {
  if (registered.has(md)) return
  registered.add(md)
  md.inline.ruler.before('link', 'scholar_ref', (state, silent) => {
    if (state.src[state.pos] !== '[' || !['^', '@'].includes(state.src[state.pos + 1])) return false
    const match = /^\[([\^@])([^\]\s]{1,126})\]/u.exec(state.src.slice(state.pos, Math.min(state.pos + 131, state.posMax)))
    if (!match) return false
    const kind = match[1] === '^' ? 'footnote' : match[2].startsWith('stmt:') ? 'statement' : 'citation'
    const key = kind === 'statement' ? match[2].slice(5) : match[2]
    if (!SCHOLAR_KEY.test(key)) return false
    if (!silent) {
      const token = state.push('scholar_ref_open', 'span', 1)
      token.attrSet('data-scholar-ref', kind)
      token.attrSet('data-scholar-key', key)
      state.push('scholar_ref_close', 'span', -1)
    }
    state.pos += match[0].length
    return true
  })
  md.block.ruler.before('reference', 'scholar_footnote', (state, start, end, silent) => {
    const first = state.src.slice(state.bMarks[start] + state.tShift[start], state.eMarks[start])
    const match = /^\[\^([^\]\s]{1,120})\]:(?:[ \t]+(.*)|\s*)$/.exec(first)
    if (!match || !SCHOLAR_KEY.test(match[1])) return false
    if (silent) return true
    const lines = [match[2] ?? '']
    let next = start + 1
    let blanks = 0
    while (next < end) {
      const line = state.src.slice(state.bMarks[next] + state.blkIndent, state.eMarks[next])
      if (!line.trim()) { blanks++; next++; continue }
      if (state.sCount[next] < state.blkIndent + 4) break
      for (; blanks; blanks--) lines.push('')
      lines.push(line.startsWith('\t') ? line.slice(1) : line.slice(4))
      next++
    }
    const token = state.push('scholar_note_open', 'div', 1)
    token.attrSet('data-scholar-note', match[1])
    state.md.block.parse(lines.join('\n'), md, state.env, state.tokens)
    state.push('scholar_note_close', 'div', -1)
    state.line = next - blanks
    return true
  }, { alt: ['paragraph', 'reference', 'blockquote', 'list'] })
}

export function parseStatements(root: HTMLElement): void {
  for (const quote of root.querySelectorAll('blockquote')) {
    const first = quote.firstElementChild
    if (!first?.matches('p')) continue
    const match = /^\[!(THEOREM|LEMMA|DEFINITION|EXAMPLE|PROOF)\](?:\{([^{}\s]+)\})?[ \t]*(.*)$/u.exec(first.textContent?.trim() ?? '')
    if (!match) continue
    const block = root.ownerDocument.createElement('div')
    block.dataset.scholarStatement = match[1]
    if (SCHOLAR_KEY.test(match[2] ?? '')) block.dataset.scholarKey = match[2]
    if (match[3]) block.dataset.scholarTitle = match[3]
    first.remove()
    block.append(...quote.childNodes)
    quote.replaceWith(block)
  }
}

export function serializeStatement(state: ScholarSerializer, node: PMNode, kind: StatementKind): void {
  state.wrapBlock('> ', '> ', node, () => {
    const key = SCHOLAR_KEY.test(node.attrs.key) ? `{${node.attrs.key}}` : ''
    const title = String(node.attrs.title ?? '').replace(/[\r\n]+/g, ' ').trim()
    // The title is stored as Markdown text on the callout's first line.
    state.write(`[!${Object.hasOwn(STATEMENT_NAMES, kind) ? kind : 'THEOREM'}]${key}`)
    if (title) state.text(` ${title}`)
    state.ensureNewLine()
    state.write('\n')
    state.renderContent(node)
  })
}
