import type { Node as PMNode } from '@tiptap/pm/model'
import { BIB_LANGUAGE, refLabel, scholarIndex, type Target } from '../scholarIndex'

export function projectScholarHtml(root: HTMLElement, content: PMNode, zhihu: boolean): void {
  const index = scholarIndex(content)
  const document = root.ownerDocument
  const addAnchor = (container: HTMLElement, id: string) => {
    const anchor = document.createElement('span')
    anchor.id = id
    container.prepend(anchor)
  }
  const links = [...index.links.values()]
  root.querySelectorAll<HTMLElement>('[data-scholar-ref]').forEach((element, i) => {
    const link = links[i]
    if (!link) return
    const label = link.kind === 'footnote' && zhihu ? `〔注${refLabel(link)}〕` : refLabel(link)
    if (zhihu || !link.target) { element.replaceWith(document.createTextNode(label)); return }
    const wrap = document.createElement(link.kind === 'footnote' ? 'sup' : 'span')
    const reference = document.createElement('a')
    reference.href = `#${link.target.anchor}`
    reference.textContent = label
    wrap.append(reference)
    if (link.kind === 'footnote') {
      wrap.id = link.anchor
      reference.setAttribute('role', 'doc-noteref')
    } else addAnchor(wrap, link.anchor)
    element.replaceWith(wrap)
  })

  const heading = (text: string) => {
    const paragraph = document.createElement('p')
    const bold = document.createElement('strong')
    bold.textContent = text
    paragraph.append(bold)
    return paragraph
  }
  const statements = [...index.statementNodes.values()]
  root.querySelectorAll<HTMLElement>('[data-scholar-statement]').forEach((block, i) => {
    const target = statements[i]
    if (!target) return
    const paragraph = heading([target.label, target.title].filter(Boolean).join('　'))
    if (!zhihu) addAnchor(paragraph, target.anchor)
    block.prepend(paragraph)
  })

  const notes = [...index.footnoteNodes.values()]
  const footnotes = [...root.querySelectorAll<HTMLElement>('[data-scholar-note]')]
  if (notes.length) {
    const section = document.createElement('div')
    section.className = 'document-footnotes'
    if (!zhihu) section.setAttribute('role', 'doc-footnotes')
    section.append(heading('脚注'))
    const numbered = footnotes.map((block, i) => ({ block, target: notes[i] })).filter((item): item is { block: HTMLElement; target: Target } => Boolean(item.target))
    numbered.sort((a, b) => (Number(a.target.label) || Infinity) - (Number(b.target.label) || Infinity))
    for (const { target, block } of numbered) {
      const label = zhihu && target.label !== '脚注' ? `〔注${target.label}〕` : target.label === '脚注' ? '未引用的脚注' : `脚注 ${target.label}`
      const paragraph = heading(label)
      if (!zhihu) {
        block.id = target.anchor
        block.setAttribute('role', 'doc-footnote')
        for (const [i, link] of (index.backlinks.get(target.anchor) ?? []).entries()) {
          const back = document.createElement('a')
          back.href = `#${link.anchor}`
          back.textContent = ` ↩${i + 1}`
          paragraph.append(back)
        }
      }
      block.prepend(paragraph)
      section.append(block)
    }
    root.append(section)
  }

  for (const source of root.querySelectorAll(`pre > code.language-${BIB_LANGUAGE}`)) source.parentElement?.remove()
  if (index.bibliography.size) {
    const section = document.createElement('div')
    section.className = 'document-bibliography'
    section.append(heading('参考文献'))
    for (const item of index.bibliography.values()) {
      const paragraph = document.createElement('p')
      paragraph.textContent = `${item.label} ${item.text}`
      if (!zhihu) addAnchor(paragraph, item.anchor)
      section.append(paragraph)
    }
    root.append(section)
  }
}
