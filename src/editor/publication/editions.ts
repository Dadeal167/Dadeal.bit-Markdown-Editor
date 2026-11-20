import { Fragment, type Node as PMNode } from '@tiptap/pm/model'

export const editionBlockLabels = { hint: '提示', answer: '答案', solution: '解析' } as const
export type EditionBlockKind = keyof typeof editionBlockLabels

export function editionBlockKind(value: unknown): EditionBlockKind {
  return value === 'hint' || value === 'answer' ? value : 'solution'
}

export const editionLabels = { student: '学生版', teacher: '教师版', zhihu: '知乎版' } as const
export type Edition = keyof typeof editionLabels
export type EditionFormat = 'docx' | 'pdf' | 'plain' | 'zhihu'

export function hasEditionBlocks(doc: PMNode): boolean {
  let found = false
  doc.descendants((node) => {
    if (node.type.name === 'editionBlock') found = true
    return !found
  })
  return found
}

/** Project the document before export so hidden content never reaches a file or its indexes. */
export function editionDocument(doc: PMNode, edition: Edition): PMNode {
  const { schema } = doc.type
  const project = (node: PMNode): PMNode[] => {
    const marked = node.type.name === 'editionBlock'
    if (marked && edition === 'student') return []
    if (node.isLeaf) return [node]
    const children: PMNode[] = []
    node.forEach((child) => children.push(...project(child)))
    if (marked) {
      const label = schema.text(editionBlockLabels[editionBlockKind(node.attrs.kind)], [schema.marks.bold.create()])
      return [schema.nodes.paragraph.create(null, label), ...children]
    }
    const content = Fragment.fromArray(children)
    if (node.content.eq(content)) return [node]
    if (node.type.validContent(content)) return [node.copy(content)]
    const filled = node.type.createAndFill(node.attrs, content, node.marks)
    return filled ? [filled] : []
  }
  return project(doc)[0] ?? doc.type.createAndFill()!
}
