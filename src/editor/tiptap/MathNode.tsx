import { Node, mergeAttributes } from '@tiptap/core'
import { NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react'
import type { NodeViewProps } from '@tiptap/react'
import { requestMathEdit } from '../mathEvents'
import { injectMathIntoDom, MATH_BLOCK_MARK, MATH_INLINE_MARK } from './mathMarkdown'
import { repairLatex, rendersOk } from '../math/latexRepair'
import katex from 'katex'

/** KaTeX 渲染（失败时退化为空，由占位提示兜底） */
export function renderKatex(latex: string, display: boolean): string {
  if (!latex.trim()) return ''
  try {
    return katex.renderToString(latex, { throwOnError: false, displayMode: display })
  } catch {
    return ''
  }
}

function MathView(props: NodeViewProps) {
  const { node, getPos, selected } = props
  const latex = String(node.attrs.latex ?? '')
  const display = node.type.name === 'mathBlock'
  // 源文件里反斜杠写重/写漏的公式（\left \\{ 之类）按修好的写法渲染，
  // 用户点开编辑时看到的也是修好的那份，确认一次就存下来了
  const shown = repairLatex(latex, display)
  const html = renderKatex(shown, display)
  const empty = !latex.trim()
  // 注意：不能用 html.includes('katex-error') 判断——KaTeX 遇到"不认识的命令"
  // （\boguscmd 这种）会**悄悄**渲染成普通文字，不给任何错误标记（实测）。
  // 所以用 throwOnError:true 的渲染检测当准绳，和"文档体检"的口径保持一致。
  const broken = !empty && !rendersOk(shown, display)

  const open = () => {
    // ⚠️ getPos() 在 NodeView 已经脱离文档时会返回 undefined（不是 null）：
    // 直接当 number 用会走"编辑已有公式"那条路，pos=undefined → nodeAt(undefined)=null
    // → 用户改完的公式被静默丢掉。所以这里明确判一下，拿不到位置就当新公式插。
    const raw = typeof getPos === 'function' ? getPos() : undefined
    const pos = typeof raw === 'number' ? raw : null
    requestMathEdit({ latex: shown, display, pos })
  }

  return (
    <NodeViewWrapper
      as={display ? 'div' : 'span'}
      className={[
        'math-node',
        display ? 'math-node--block' : '',
        empty ? 'math-node--empty' : '',
        broken ? 'math-node--error' : '',
        selected ? 'math-node--selected' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      data-latex={latex}
      data-math-broken={broken ? 'true' : undefined}
      title={broken ? '这个公式没能渲染出来（多半是源文件里的写法有问题），点击可以修改' : '点击修改公式'}
      onClick={open}
    >
      {empty ? (
        <span className="math-node__placeholder">{display ? '点击输入公式' : '公式'}</span>
      ) : (
        <span className="math-node__body" dangerouslySetInnerHTML={{ __html: html }} />
      )}
    </NodeViewWrapper>
  )
}

const mathAttrs = {
  latex: {
    default: '',
    parseHTML: (el: HTMLElement) => el.getAttribute('data-latex') ?? '',
    renderHTML: (attributes: Record<string, unknown>) => ({ 'data-latex': attributes.latex }),
  },
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    math: {
      insertMathInline: (latex: string) => ReturnType
      insertMathBlock: (latex: string) => ReturnType
      updateMathAt: (pos: number, latex: string) => ReturnType
    }
  }
}

export const MathInline = Node.create({
  name: 'mathInline',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  // 不接受任何 mark：正文的文字颜色/加粗都碰不到公式，
  // 公式的颜色/字体/字号只由公式弹窗控制（两边互不干扰）
  marks: '',

  addAttributes() {
    return mathAttrs
  },

  parseHTML() {
    return [{ tag: 'span[data-math-inline]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(HTMLAttributes, { 'data-math-inline': 'true' }),
      String(HTMLAttributes['data-latex'] ?? ''),
    ]
  },

  addNodeView() {
    return ReactNodeViewRenderer(MathView)
  },

  addCommands() {
    return {
      insertMathInline:
        (latex: string) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs: { latex } }),
      updateMathAt:
        (pos: number, latex: string) =>
        ({ tr, dispatch }) => {
          const node = tr.doc.nodeAt(pos)
          if (!node) return false
          if (dispatch) tr.setNodeMarkup(pos, undefined, { ...node.attrs, latex })
          return true
        },
    }
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: { write: (s: string) => void }, node: { attrs: { latex: string } }) {
          // 用标记字符包起来，由 finalizeMarkdown 统一换成 $…$（这样正文里的字面 $ 才能安全转义）
          state.write(`${MATH_INLINE_MARK}${node.attrs.latex}${MATH_INLINE_MARK}`)
        },
        parse: {
          updateDOM(element: HTMLElement) {
            injectMathIntoDom(element)
          },
        },
      },
    }
  },
})

export const MathBlock = Node.create({
  name: 'mathBlock',
  group: 'block',
  atom: true,
  selectable: true,
  marks: '',

  addAttributes() {
    return mathAttrs
  },

  parseHTML() {
    return [{ tag: 'div[data-math-block]' }]
  },

  addCommands() {
    return {
      // 注意：命令必须挂在自己的扩展上——`this` 是扩展自身，
      // 之前把 insertMathBlock 写在 MathInline 里，于是"行间"插出来的是行内节点
      insertMathBlock:
        (latex: string) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs: { latex } }),
    }
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, { 'data-math-block': 'true' }),
      String(HTMLAttributes['data-latex'] ?? ''),
    ]
  },

  addNodeView() {
    return ReactNodeViewRenderer(MathView)
  },

  addStorage() {
    return {
      markdown: {
        serialize(
          state: { write: (s: string) => void; closeBlock: (n: unknown) => void },
          node: { attrs: { latex: string } },
        ) {
          state.write(`${MATH_BLOCK_MARK}${node.attrs.latex}${MATH_BLOCK_MARK}`)
          state.closeBlock(node)
        },
      },
    }
  },
})
