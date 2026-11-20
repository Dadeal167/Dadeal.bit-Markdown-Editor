import type { Node as PMNode } from '@tiptap/pm/model'
import { Cite } from '@citation-js/core'
import '@citation-js/plugin-bibtex'

export const BIB_LANGUAGE = 'bibtex'
export const STATEMENT_NAMES = { THEOREM: '定理', LEMMA: '引理', DEFINITION: '定义', EXAMPLE: '例题', PROOF: '证明' } as const
export type StatementKind = keyof typeof STATEMENT_NAMES
export type RefKind = 'footnote' | 'citation' | 'statement'
export const SCHOLAR_KEY = /^[\p{L}\p{N}][\p{L}\p{N}_.:/-]{0,119}$/u

export function statementKind(value: unknown): StatementKind {
  return typeof value === 'string' && Object.hasOwn(STATEMENT_NAMES, value) ? value as StatementKind : 'THEOREM'
}

export function refKind(value: unknown): RefKind {
  return value === 'citation' || value === 'statement' ? value : 'footnote'
}

export interface BibEntry { key: string; title: string; text: string }
const bibliographies = new Map<string, { entries: BibEntry[]; error?: string }>()

export function parseBibTeX(source: string): { entries: BibEntry[]; error?: string } {
  const known = bibliographies.get(source)
  if (known) return known
  const text = (value: unknown) => Array.isArray(value) ? value.filter((item) => typeof item === 'string').join(' ')
    : typeof value === 'string' ? value : ''
  let result: { entries: BibEntry[]; error?: string }
  try {
    const list = source.trim() ? new Cite(source, { forceType: '@bibtex/text' }).data : []
    const entries = list.flatMap((item) => {
      const key = text(item.id)
      if (!SCHOLAR_KEY.test(key)) return []
      const title = text(item.title) || key
      const people = Array.isArray(item.author) ? item.author.map((person) =>
        text(person.literal) || [text(person.given), text(person.family)].filter(Boolean).join(' ')).filter(Boolean).join(', ') : ''
      const issued = item.issued as { 'date-parts'?: number[][] } | undefined
      const year = issued?.['date-parts']?.[0]?.[0]
      const publication = text(item['container-title']) || text(item.publisher)
      const doi = text(item.DOI)
      return [{ key, title, text: [people, title, publication, year?.toString(), doi ? `DOI ${doi}` : text(item.URL)].filter(Boolean).join('. ') }]
    })
    result = { entries }
    if (list.length && entries.length !== list.length) result.error = '部分文献的引用键无法读取。'
  } catch {
    result = { entries: [], error: 'BibTeX 文件无法解析。请检查文献条目格式。' }
  }
  if (bibliographies.size >= 16) bibliographies.delete(bibliographies.keys().next().value!)
  bibliographies.set(source, result)
  return result
}

export interface Target {
  key: string
  pos: number
  label: string
  anchor: string
  kind?: StatementKind
  title?: string
  text?: string
}
export interface ScholarLink { kind: RefKind; key: string; pos: number; anchor: string; target?: Target }

function buildIndex(doc: PMNode) {
  const footnotes = new Map<string, Target | null>()
  const statements = new Map<string, Target | null>()
  const statementNodes = new Map<number, Target>()
  const footnoteNodes = new Map<number, Target>()
  const library = new Map<string, BibEntry>()
  const bibProblems: { pos: number; error: string }[] = []
  const links = new Map<number, ScholarLink>()
  let chapter = 0
  let h1 = 0
  let h2 = 0
  doc.forEach((node) => { if (node.type.name === 'heading') {
    if (node.attrs.level === 1) h1++
    if (node.attrs.level === 2) h2++
  } })
  const chapterLevel = h1 > 1 || (h1 === 1 && !h2) ? 1 : 2
  const counts = new Map<StatementKind, number>()
  doc.descendants((node, pos, parent) => {
    if (node.type.name === 'heading' && parent === doc && node.attrs.level === chapterLevel) {
      chapter++
      counts.clear()
    }
    const key = String(node.attrs.key ?? '')
    if (node.type.name === 'scholarReference') links.set(pos, { kind: refKind(node.attrs.kind), key, pos, anchor: `scholar-link-${links.size + 1}` })
    if (node.type.name === 'footnoteDefinition') {
      const entry = { key, pos, label: '脚注', anchor: `scholar-note-${footnoteNodes.size + 1}` }
      footnoteNodes.set(pos, entry)
      footnotes.set(key, footnotes.has(key) ? null : entry)
    }
    if (node.type.name === 'mathStatement') {
      const kind = statementKind(node.attrs.kind)
      const number = (counts.get(kind) ?? 0) + 1
      counts.set(kind, number)
      const entry = { key, pos, kind, title: String(node.attrs.title ?? ''),
        label: `${STATEMENT_NAMES[kind]} ${chapter ? `${chapter}.` : ''}${number}`, anchor: `scholar-statement-${statementNodes.size + 1}` }
      statementNodes.set(pos, entry)
      if (key) statements.set(key, statements.has(key) ? null : entry)
    }
    if (node.type.name === 'codeBlock' && node.attrs.language === BIB_LANGUAGE) {
      const result = parseBibTeX(node.textContent)
      for (const entry of result.entries) if (!library.has(entry.key)) library.set(entry.key, entry)
      if (result.error) bibProblems.push({ pos, error: result.error })
    }
  })

  const bibliography = new Map<string, Target>()
  const backlinks = new Map<string, ScholarLink[]>()
  let noteNumber = 0
  for (const link of links.values()) {
    if (link.kind === 'footnote') {
      const target = footnotes.get(link.key)
      if (target) {
        if (!backlinks.has(target.anchor)) target.label = String(++noteNumber)
        link.target = target
      }
    } else if (link.kind === 'statement') link.target = statements.get(link.key) ?? undefined
    else {
      const entry = library.get(link.key)
      if (entry && !bibliography.has(link.key)) {
        bibliography.set(link.key, { ...entry, pos: -1, label: `[${bibliography.size + 1}]`, anchor: `scholar-cite-${bibliography.size + 1}` })
      }
      link.target = bibliography.get(link.key)
    }
    if (link.target) {
      const group = backlinks.get(link.target.anchor)
      if (group) group.push(link)
      else backlinks.set(link.target.anchor, [link])
    }
  }
  return { footnotes, statements, footnoteNodes, statementNodes, library, bibliography, links, backlinks, bibProblems }
}

const indexes = new WeakMap<PMNode, ReturnType<typeof buildIndex>>()
export function scholarIndex(doc: PMNode) {
  const cached = indexes.get(doc)
  if (cached) return cached
  const next = buildIndex(doc)
  indexes.set(doc, next)
  return next
}

export function refLabel(link?: ScholarLink): string {
  return link?.target?.label ?? (link?.kind === 'footnote' ? '?' : link?.kind === 'statement' ? '引用？' : '[?]')
}
