import { Node, mergeAttributes } from '@tiptap/core'
import { NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react'
import type { NodeViewProps } from '@tiptap/react'
import { useLayoutEffect, useRef } from 'react'
import { TextSelection } from '@tiptap/pm/state'
import { requestMathEdit } from '../mathEvents'
import { injectMathIntoDom, MATH_BLOCK_MARK, MATH_INLINE_MARK } from './mathMarkdown'
import { repairLatex, rendersOk } from '../math/latexRepair'
import katex from 'katex'

/**
 * 公式太宽时最多缩到一半。
 *
 * 再小就看不清了 —— 所以缩到下限还放不下的，改成在**公式框内部横向滚动**
 * （`.math-node[data-wide]` 的 `overflow-x:auto`），绝不撑破正文列。
 */
const MIN_MATH_SCALE = 0.5

/**
 * 把太宽的公式缩到放得下（只动显示，不动 LaTeX / Markdown）。
 *
 * 用户报的："遇见长的公式，会超出范围"。实测（.probe/probe-math-overflow.mjs）：
 * 正文列宽 654px 时，一行超长公式右边缘跑到 764px、行间公式的 KaTeX 内容直接溢出公式框。
 *
 * 做法：
 *   · 量出公式的**自然宽度**（先把上次的缩放清掉再量，免得越量越小）
 *   · 比容器内容宽就等比缩小（`zoom`，它是会改变布局的缩放，所以缩完真的不再占那么宽）
 *   · 缩到 0.5 还放不下 → 打上 data-wide，让它在公式框里横向滚动
 *   · 本来放得下就**什么都不做**（不留任何 style，短公式与老文档一模一样）
 *
 * 容器变宽变窄（改字号、拉窗口、切主题）会重新量：ResizeObserver + window.resize。
 */
function useFitToColumn(bodyRef: React.RefObject<HTMLSpanElement | null>, deps: unknown[]): void {
  const lastK = useRef(1)
  useLayoutEffect(() => {
    const body = bodyRef.current
    if (!body) return
    const wrap = body.closest('.math-node') as HTMLElement | null
    const host = wrap?.parentElement
    if (!wrap || !host) return

    let raf = 0
    const fit = () => {
      raf = 0
      /* 1) 清掉缩放，量出公式的**自然宽度**。
         ⚠️ 两个坑都踩过，记下来：
           · 不能用 `.math-node` / `.math-node__body` 的 rect —— 行间公式外面那层盒子宽度
             永远等于正文列，超出部分是被**裁在盒子里**的（实测：盒子 654px、内容 850px、
             盒内可滚 196px），rect 只会告诉你 654，看不出溢出
           · 也不能用元素自己的 scrollWidth 来判断"缩放后还差多少" —— 在 zoom 子树里
             scrollWidth 报的是**元素自身的 CSS 像素**（不随 zoom 变），于是循环会一直以为
             没缩够，一路缩到下限（实测缩成了 0.5，其实 0.78 就够了）
           所以：自然宽度用 scrollWidth 量（它最能反映"被裁掉多少"），
           **缩放后的效果一律用 .katex-html 的 rect 量**（rect 是按页面像素算的，跟 zoom 走）。 */
      wrap.style.zoom = ''
      const inner = body.querySelector('.katex-html') ?? body.querySelector('.katex') ?? body
      const natural = Math.ceil(Math.max(body.scrollWidth, inner.scrollWidth, inner.getBoundingClientRect().width))
      const cs = getComputedStyle(host)
      const avail =
        host.clientWidth - parseFloat(cs.paddingLeft || '0') - parseFloat(cs.paddingRight || '0')
      if (!natural || !avail) return
      /* 留 6px 余量：公式盒子自己还有左右内边距（`.math-node{padding:0 2px}` 等），
         按"刚好等于列宽"算会剩十几个像素被裁（实测残留 15px 可滚） */
      const budget = Math.max(40, avail - 6)
      let k = natural > budget ? Math.max(MIN_MATH_SCALE, budget / natural) : 1
      /* 迭代细化：盒子自身还有内边距、公式还带外边距，一次算不准（实测残留 15px）。
         每轮按"还差多少"再乘一次，最多 3 轮。 */
      for (let i = 0; i < 3 && k < 1; i += 1) {
        wrap.style.zoom = String(k)
        const still = Math.ceil(inner.getBoundingClientRect().width)
        if (still <= budget) break
        k = Math.max(MIN_MATH_SCALE, k * (budget / still))
      }
      lastK.current = k
      wrap.style.zoom = k < 1 ? String(k) : ''
      /* 缩到下限还放不下 → 允许它在公式框里横向滚动，绝不撑破正文 */
      const finalW = Math.ceil(inner.getBoundingClientRect().width)
      if (k <= MIN_MATH_SCALE + 1e-3 && finalW > budget + 1) wrap.dataset.wide = '1'
      else delete wrap.dataset.wide
    }
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(fit)
    }
    schedule()
    const ro = new ResizeObserver(schedule)
    ro.observe(host)
    window.addEventListener('resize', schedule)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', schedule)
      if (raf) cancelAnimationFrame(raf)
      wrap.style.zoom = ''
      delete wrap.dataset.wide
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
}

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
  const bodyRef = useRef<HTMLSpanElement | null>(null)
  /* 渲染内容变了、行内/行间换了，都要重量一次 */
  useFitToColumn(bodyRef, [html, display])

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
        <span ref={bodyRef} className="math-node__body" dangerouslySetInnerHTML={{ __html: html }} />
      )}
    </NodeViewWrapper>
  )
}

const mathAttrs = {
  latex: {
    default: '',
    /* 从 HTML 里读公式时也过一遍修复。
       为什么：公式进文档有两条路 —— markdown 的 `$…$` 会走 protectMathSpans/repairLatex，
       而 HTML 里存好的 data-latex 是**被这一行直接读走**的，以前完全绕过修复。
       于是就出现"同样的坏写法，从 .md 进来能修好、从 HTML 进来还是红字"。
       实测用户那篇里 `$a\in \[-\infty,\frac{1}{2}\]$` 就是这么漏掉的。
       repairLatex 对本来就能渲染的公式原样返回，所以在这里调不会误改。 */
    parseHTML: (el: HTMLElement) => {
      const raw = el.getAttribute('data-latex') ?? ''
      if (!raw) return raw
      const display = el.hasAttribute('data-math-block') || el.getAttribute('data-math-block') === 'true'
      return repairLatex(raw, display)
    },
    renderHTML: (attributes: Record<string, unknown>) => ({ 'data-latex': attributes.latex }),
  },
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    math: {
      insertMathInline: (latex: string) => ReturnType
      insertMathBlock: (latex: string) => ReturnType
      updateMathAt: (pos: number, latex: string, display?: boolean) => ReturnType
    }
  }
}

/**
 * ⚠️ 这里**故意没有** `leafText` —— 踩过一次，记下来免得后人再试：
 *
 * 直觉上"复制成纯文本时公式消失"应该在节点 spec 上加 `leafText` 修
 * （ProseMirror 的默认纯文本序列化是
 * `slice.content.textBetween(0, slice.content.size, "\n\n")`，
 * 而 `textBetween` 对没有 `leafText` 的原子节点贡献**空字符串**）。
 *
 * 但 **TipTap 不会把 `leafText` 传给 ProseMirror** —— 它组装 schema 时只挑自己
 * 认识的字段，`leafText` 被**静默丢弃**。实测 schema 里的键是：
 *   ["marks","group","inline","atom","selectable","attrs","parseDOM","toDOM"]
 * 加了 `leafText` 之后复制结果一个字都没变（还是 `前面文字  后面文字`）。
 *
 * 真正的修法在 `useMarkdownEditor.ts` 的 `editorProps.clipboardTextSerializer`。
 */

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
      /**
       * 改一个**已有**公式：改内容，并且可以换排版（行内 ⇄ 行间）。
       *
       * 为什么 `display` 这个参数必须有：以前这里只 `setNodeMarkup` 改 latex，
       * 类型传 `undefined`（= 保持原类型）—— 于是"点开公式 → 切成行间 → 确认"
       * **什么都不会发生**。用户 2026-09-26 问"公式怎么单独占一行"，实测出来的就是这条路：
       *     起始 ["mathInline"] → 切行间确认 → ["mathInline"]（一点没变）
       *   而新插入的行间公式 ["mathInline","mathBlock"]（正常）
       * 结果：已经写好的行内公式想独占一行，只能删掉重插。
       *
       * 换排版必须**换节点**，不能改属性：mathInline 是 inline 原子、mathBlock 是
       * block 原子，在 schema 里是两个类型，setNodeMarkup 换不了类型。
       *
       * 结构怎么搬（这块最容易出鬼，写清楚）：
       *   · 行内 → 行间：整段替换成块级公式。行内公式常常夹在段落中间，而块级节点
       *     不能待在段落里 —— 交给 ProseMirror 处理：放不进段落时它会把段落**切开**，
       *     公式落在两段之间（实测 '前面 $x+1$ 后面' → '前面' / 公式 / '后面'，文字不丢）
       *   · 行间 → 行内：优先**并回上一段**（"把公式收回正文里"才是切回行内的本意）；
       *     上一段不是普通段落（标题 / 列表 / 代码块）就自己起一段
       *
       * ⚠️ 位置算错会改坏**别的**节点（历史上踩过"位置失效却照改"的坑，用户改完的公式被丢掉），
       * 所以这里三道保险：
       *   1. `pos` 上必须真是一个公式节点，否则返回 false —— 调用方会当成新公式插入，不丢内容
       *   2. **先删后插**：`pos - 1`（上一段内容末尾）在删除点之前，删除不会挪动它
       *   3. 换完把光标放到公式**后面**，别停在原子节点上（否则下次打字会替换掉公式）
       */
      updateMathAt:
        (pos: number, latex: string, display?: boolean) =>
        ({ tr, dispatch, state }) => {
          const node = tr.doc.nodeAt(pos)
          if (!node) return false
          const isInline = node.type.name === 'mathInline'
          const isBlockNode = node.type.name === 'mathBlock'
          if (!isInline && !isBlockNode) return false
          const wantBlock = display === undefined ? isBlockNode : !!display
          /* 排版没变：只改内容（老路径，一个字节都不动结构） */
          if (wantBlock === isBlockNode) {
            if (dispatch) tr.setNodeMarkup(pos, undefined, { ...node.attrs, latex })
            return true
          }
          if (!dispatch) return true
          const schema = state.schema
          if (wantBlock) {
            /* ---------- 行内 → 行间 ----------
               块级节点不能待在段落里，所以这一段文字要"让位"。三种边界分开处理，
               不能一律丢给 replaceWith —— 实测那样会切出空段落：
                 `$\frac{a}{b}$`（整段就一个公式）→ paragraph(空) / 公式 / paragraph(空)，
                 导出的 Markdown 顶上多一个空行。 */
            const block = schema.nodes.mathBlock.create({ latex })
            const $pos = tr.doc.resolve(pos)
            const parent = $pos.parent
            const idx = $pos.index()
            const nothingBefore = idx === 0
            const nothingAfter = idx === parent.childCount - 1
            let caretAt = pos + block.nodeSize
            if (nothingBefore && nothingAfter) {
              /* 整段就这一个公式：整段换成块级公式 */
              const start = $pos.before()
              const end = $pos.after()
              tr.replaceWith(start, end, block)
              caretAt = start + block.nodeSize
            } else if (nothingBefore) {
              /* 公式在段首：块放到本段**之前**，剩下的文字留在这段里 */
              const paraStart = $pos.before()
              tr.delete(pos, pos + node.nodeSize)
              tr.insert(paraStart, block)
              caretAt = paraStart + block.nodeSize
            } else if (nothingAfter) {
              /* 公式在段尾：块放到本段**之后** */
              const paraEnd = $pos.after() - node.nodeSize
              tr.delete(pos, pos + node.nodeSize)
              tr.insert(paraEnd, block)
              caretAt = paraEnd + block.nodeSize
            } else {
              /* 夹在文字中间：这里交给 ProseMirror —— 放不进段落时它会把段落切开，
                 公式落在两段之间（实测 '前面 $x+1$ 后面' → '前面 ' / 公式 / ' 后面'，文字不丢）。
                 注意**只动公式本身**：切出来的前后文字里的空格保持原样，不去 trim。 */
              tr.replaceWith(pos, pos + node.nodeSize, block)
            }
            tr.setSelection(TextSelection.near(tr.doc.resolve(caretAt)))
            return true
          }
          /* ---------- 行间 → 行内 ----------
             优先并回**上一段**（"把公式收回正文里"才是切回行内的本意）；
             上面没有段落就并进**下一段**的开头；两边都不是段落（标题 / 列表 / 代码块旁）
             就自己起一段。
             ⚠️ 一律"先删后插"：删除点之后的坐标会挪，删除点之前的不会 —— 先删掉公式块，
             再往算好的位置插行内节点，位置就不会错。 */
          const inline = schema.nodes.mathInline.create({ latex })
          const $at = tr.doc.resolve(pos)
          const prev = $at.nodeBefore
          const next = $at.nodeAfter
          if (prev && prev.type.name === 'paragraph') {
            /* 上一段的内容末尾 = pos - 1（在删除点之前，不受删除影响） */
            tr.delete(pos, pos + node.nodeSize)
            tr.insert(pos - 1, inline)
            tr.setSelection(TextSelection.near(tr.doc.resolve(pos - 1 + inline.nodeSize)))
          } else if (next && next.type.name === 'paragraph') {
            /* 下一段的内容开头 = 删除后的 pos + 1 */
            tr.delete(pos, pos + node.nodeSize)
            tr.insert(pos + 1, inline)
            tr.setSelection(TextSelection.near(tr.doc.resolve(pos + 1 + inline.nodeSize)))
          } else {
            const para = schema.nodes.paragraph.create(null, inline)
            tr.replaceWith(pos, pos + node.nodeSize, para)
            tr.setSelection(TextSelection.near(tr.doc.resolve(pos + 1 + inline.nodeSize)))
          }
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
