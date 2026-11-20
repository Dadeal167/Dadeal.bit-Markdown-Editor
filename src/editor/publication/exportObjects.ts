import type { Node as PMNode } from '@tiptap/pm/model'
import { codeMask } from '../tiptap/mathMarkdown'
import { decodeObjectCaption, objectCaptionText } from '../tiptap/objectMarkup'
import { indexObjects, objectReferenceText } from '../tiptap/objectReferences'

export function projectObjectHtml(root: HTMLElement, content: PMNode, isZhihu: boolean): void {
  const index = indexObjects(content)
  const objects = index.items.filter((item) => item.id)
  const document = root.ownerDocument
  root.querySelectorAll<HTMLElement>('[data-dadealbit-object]').forEach((element, position) => {
    const item = objects[position]
    if (!item || item.id !== element.dataset.dadealbitObject) return
    const caption = item.kind === 'fig' ? element.querySelector('figcaption') : document.createElement('caption')
    if (!caption) return
    caption.className = 'zh-caption'
    caption.textContent = objectCaptionText(item.number, item.caption)
    if (isZhihu) {
      // 草稿编辑器可以接收普通段落。图片和表格继续走原有导入路径。
      const text = document.createElement('p')
      text.textContent = caption.textContent
      if (item.kind === 'fig') {
        const image = element.querySelector('img')
        if (image) {
          const paragraph = document.createElement('p')
          paragraph.append(image)
          element.replaceWith(paragraph, text)
        }
      } else {
        element.before(text)
        element.removeAttribute('data-dadealbit-object')
        element.removeAttribute('data-caption')
      }
      return
    }
    if (index.byId.get(item.id)) {
      const anchor = document.createElement('span')
      anchor.id = `object-${item.id}`
      caption.prepend(anchor)
    }
    if (item.kind === 'tab') element.prepend(caption)
  })

  for (const reference of root.querySelectorAll<HTMLElement>('[data-dadealbit-ref]')) {
    const id = reference.dataset.dadealbitRef ?? ''
    const text = objectReferenceText(content, id)
    if (isZhihu || !index.byId.get(id)) reference.replaceWith(document.createTextNode(text))
    else {
      const link = document.createElement('a')
      link.href = `#object-${id}`
      link.textContent = text
      reference.replaceWith(link)
    }
  }
}

function plainCaption(text: string): string {
  return text.replace(/[&<>`*_$~[\]\\|]/g, (char) => `&#${char.codePointAt(0)};`)
}

function continuationPrefix(prefix: string): string {
  const quote = /^(?:[ \t]*>[ \t]?)*[ \t]*/.exec(prefix)?.[0] ?? ''
  const item = /^(?:[-+*]|\d+[.)])[ \t]+$/.exec(prefix.slice(quote.length))
  return quote + (item ? ' '.repeat(item[0].length) : '')
}

export function projectObjectMarkdown(md: string, doc: PMNode): string {
  const index = indexObjects(doc)
  if (!index.references.length && !index.byId.size) return md
  const numbers = new Map<string, string[]>()
  for (const item of index.items) {
    if (!item.id) continue
    const queue = numbers.get(item.id)
    if (queue) queue.push(item.number)
    else numbers.set(item.id, [item.number])
  }
  const mask = codeMask(md)
  const reference = /<span data-dadealbit-ref="((?:fig|tab)-[a-z0-9-]+)">[图表]<\/span>/g
  const table = /^((?:[ \t]*>[ \t]?)*[ \t]*(?:(?:[-+*]|\d+[.)])[ \t]+)?)\|[ \t]*<span data-dadealbit-table="(tab-[a-z0-9-]+)" data-caption="([^"]*)"><\/span>/gm
  const figure = /(!\[(?:\\.|[^\]\\])*\]\([^\r\n]*?) "\[dadealbit-figure:(fig-[a-z0-9-]+):([^\]\s]*)\](?: ((?:\\.|[^"\\])*))?"\)/g
  const edits: { offset: number; end: number; text: string }[] = []
  for (const match of md.matchAll(reference)) {
    if (mask[match.index]) continue
    edits.push({ offset: match.index, end: match.index + match[0].length, text: objectReferenceText(doc, match[1]) })
  }
  for (const match of md.matchAll(table)) {
    if (mask[match.index]) continue
    const [raw, prefix, id, caption] = match
    const number = numbers.get(id)?.shift()
    if (!number) continue
    const text = plainCaption(objectCaptionText(number, decodeObjectCaption(caption)))
    const nextLine = continuationPrefix(prefix)
    edits.push({ offset: match.index, end: match.index + raw.length, text: `${prefix}${text}\n${nextLine.trimEnd()}\n${nextLine}| ` })
  }
  for (const match of md.matchAll(figure)) {
    if (mask[match.index]) continue
    const [raw, image, id, caption, title] = match
    const number = numbers.get(id)?.shift()
    if (!number) continue
    const lineStart = md.lastIndexOf('\n', match.index - 1) + 1
    const prefix = md.slice(lineStart, match.index)
    const tableCell = /^[\s>]*\|/.test(prefix)
    const nextLine = continuationPrefix(prefix)
    const separator = tableCell ? '<br>' : `\n${nextLine.trimEnd()}\n${nextLine}`
    const text = plainCaption(objectCaptionText(number, decodeObjectCaption(caption)))
    const restored = image + (title ? ` "${title}"` : '') + ')'
    edits.push({ offset: match.index, end: match.index + raw.length, text: restored + separator + text })
  }
  let at = 0
  let output = ''
  for (const edit of edits.sort((a, b) => a.offset - b.offset)) {
    if (edit.offset < at) continue
    output += md.slice(at, edit.offset) + edit.text
    at = edit.end
  }
  return output + md.slice(at)
}
