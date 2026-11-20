import type { Editor } from '@tiptap/core'
import { imageFileName, isAnimatedEmbeddedImage } from '../editorActions'
import { editorEquations } from '../math/equationIndex'
import { equationLabels, equationReferences } from '../math/equationSyntax'
import { repairLatex, rendersOk } from '../math/latexRepair'
import { documentMacros } from '../math/documentMacros'
import { expandDocumentMacros } from '../math/expandDocumentMacros'
import { scholarIndex } from '../scholarIndex'
import { diagramIssue, diagramsIn } from '../mermaidDiagrams'
import { indexObjects } from '../tiptap/objectReferences'

export type ExportTarget = 'docx' | 'pdf' | 'zhihu' | 'zhihu-draft'
export const exportTargetNames: Record<ExportTarget, string> = {
  docx: 'Word 文档',
  pdf: 'PDF 文档',
  zhihu: '知乎 Markdown',
  'zhihu-draft': '知乎草稿',
}

export interface ExportIssue {
  pos: number
  name: string
  detail: string
  level: 'fix' | 'notice' | 'block'
}

export interface ExportReview {
  target: ExportTarget
  issues: ExportIssue[]
}

export function checkExport(editor: Editor, target: ExportTarget, doc = editor.state.doc): ExportIssue[] {
  const issues: ExportIssue[] = []
  const add = (pos: number, name: string, detail: string, level: ExportIssue['level'] = 'fix') => {
    issues.push({ pos, name, detail, level })
  }
  const objects = indexObjects(doc)
  for (const item of objects.items) {
    if (item.id && objects.byId.get(item.id) === null) {
      add(item.pos, '图表标识重复', `${item.number}与其他图表使用相同标识。重新保存该图表的题注可分配新标识。`)
    }
  }
  for (const { pos, id } of objects.references) {
    if (!objects.byId.get(id)) add(pos, '图表引用失效', `未找到对应的图表（${id}），或该标识重复。`)
  }
  const scholar = scholarIndex(doc)
  for (const link of scholar.links.values()) {
    if (!link.target) add(link.pos, '学术引用失效', `未找到唯一的脚注、文献或结构块（${link.key}）。`)
  }
  for (const problem of scholar.bibProblems) add(problem.pos, 'BibTeX 无法解析', problem.error)

  const equations = editorEquations(editor, doc)
  const { macros, positions, problems } = documentMacros(doc)
  const zhihu = target === 'zhihu' || target === 'zhihu-draft'
  for (const [index, problem] of problems.entries()) {
    if (problem) add(positions[index], 'LaTeX 宏定义无法解析', problem)
  }
  for (const diagram of diagramsIn(doc)) {
    const issue = diagramIssue(diagram.source)
    if (issue) add(diagram.pos, 'Mermaid 图表无法渲染', issue)
  }
  for (const { latex, display, pos } of equations.entries) {
    if (!latex.trim()) add(pos, '公式内容为空', '请输入公式或删除空公式。')
    else if (!rendersOk(repairLatex(latex, display, macros), display, macros)) {
      add(pos, '公式无法渲染', '请检查这处公式的 LaTeX 语法。')
    } else if (zhihu && positions.length && expandDocumentMacros(latex, macros).unresolved) {
      add(pos, '文档宏无法自动展开', '请在公式中写出展开后的 LaTeX，再导出至知乎。', 'notice')
    }
    const invalid = [...new Set(equationReferences(latex))].filter((id) => !equations.byLabel.get(id)?.number)
    if (invalid.length) add(pos, '公式引用失效', `未找到唯一且已编号的公式（${invalid.join('、')}）。`)
    const duplicates = display ? [...new Set(equationLabels(latex))].filter((id) => equations.byLabel.get(id) === null) : []
    if (duplicates.length) add(pos, '公式标签重复', `请为各个公式使用唯一标签（${duplicates.join('、')}）。`)
  }

  const animations = new Map<string, boolean>()
  doc.descendants((node, pos) => {
    if (node.type.name === 'videoEmbed') {
      const detail = target === 'pdf' || target === 'docx' ? '导出后保留视频链接，播放器无法在文档内运行。'
        : '知乎导入可能将嵌入视频替换为链接。请在草稿中核对。'
      add(pos, '嵌入视频', detail, 'notice')
    }
    if (node.type.name !== 'image') return
    const src = String(node.attrs.src ?? '').trim()
    const name = String(node.attrs.alt || (src.startsWith('data:') ? '' : imageFileName(src)) || '图片')
    const dom = doc === editor.state.doc ? editor.view.nodeDOM(pos) : null
    const image = dom instanceof HTMLImageElement ? dom : dom instanceof HTMLElement ? dom.querySelector('img') : null
    const directImage = /^(?:https?:|data:image\/)/i.test(src) || (target !== 'zhihu-draft' && src.startsWith('//'))
    if (src && !directImage) {
      const detail = `「${name}」使用本地或临时地址。请将图片导入文档后再导出。`
      add(pos, '图片未嵌入', detail, target === 'zhihu-draft' ? 'block' : 'fix')
    } else if (!src || (image?.complete && !image.naturalWidth)) {
      add(pos, '图片无法读取', `请重新导入「${name}」，或检查来源地址。`)
    }
    if (!animations.has(src)) animations.set(src, isAnimatedEmbeddedImage(src))
    if (animations.get(src) || (!src.startsWith('data:') && /\.(?:gif|apng)(?:[?#]|$)/i.test(src))) {
      const detail = target === 'pdf' || target === 'docx' ? `「${name}」在导出文档中以静态画面呈现。`
        : `请在知乎草稿中预览「${name}」，确认动画播放正常。`
      add(pos, '动图兼容性', detail, 'notice')
    }
  })
  return issues.sort((a, b) => a.pos - b.pos)
}
