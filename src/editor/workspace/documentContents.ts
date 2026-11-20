import type { Node as PMNode } from '@tiptap/pm/model'
import { chapterIndex, contentsEntries } from '../tiptap/chapters'

export function addDocumentContents(root: HTMLElement, content: PMNode, title: string): void {
  const entries = contentsEntries(content, title)
  if (!entries.length) return
  const { chapters } = chapterIndex(content)
  const document = root.ownerDocument
  root.querySelectorAll('h1,h2,h3').forEach((heading, index) => {
    const entry = chapters[index]
    if (!entry) return
    const anchor = document.createElement('span')
    anchor.id = entry.id
    heading.prepend(anchor)
  })

  const nav = document.createElement('nav')
  nav.className = 'document-contents'
  nav.setAttribute('aria-label', '目录')
  const heading = document.createElement('p')
  heading.className = 'document-contents__title'
  heading.textContent = '目录'
  nav.append(heading)
  for (const entry of entries) {
    const item = document.createElement('p')
    item.className = `document-contents__item document-contents__item--h${entry.level}`
    const link = document.createElement('a')
    link.href = '#' + entry.id
    link.textContent = entry.text
    item.append(link)
    nav.append(item)
  }
  root.prepend(nav)
}
