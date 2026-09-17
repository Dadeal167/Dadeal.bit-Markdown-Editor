import { mergeAttributes } from '@tiptap/core'
import { Image } from '@tiptap/extension-image'

/**
 * 图片对齐：怎么写进 Markdown（**这是这套做法的关键，别随手改**）
 *
 * 需求：每张图单独设「左 / 居中 / 居右」。难点只有一个 —— 文档是**存成 Markdown** 的
 * （IndexedDB 里存的是 `md` 字段），所以对齐信息必须能从 `.md` 里读回来，
 * 否则"设好居中、刷新一下又变回左边"。
 *
 * 两条路，选了后者：
 *   · HTML 标签形态 `<img src="…" data-align="center">`：语义最正，但那是**给 Markdown
 *     引入一种新写法**，要同时照顾公式保护、表格转义、知乎导出好几条路 —— 正是历史上
 *     最容易出鬼的地方（图片/公式被 Markdown 解析器搅坏就是这么来的）。
 *   · 标准 Markdown 图片语法里的 **title 槽位**（`![alt](src "=c")`）：合法 Markdown，
 *     走的是**已有的**解析与序列化代码（title 本来就读写得好好的），不引入新形态。
 *     代价：别的软件里悬停会把这串哨兵当提示文字显示出来（纯观感问题；
 *     本项目没有让用户编辑 title 的入口，所以不会跟真实标题打架）。
 *
 * 哨兵格式（title 槽位）：
 *   `=c` / `=r`            对齐（居中 / 居右），左对齐不写
 *   `=|说明文字`           图片下面那行**居中说明**
 *   `=c|说明文字`          对齐 + 说明同时有
 *   `=c 真实标题`          老写法（空格分隔）仍然当"标题"处理，不显示成说明 —— 向后兼容
 */
const ALIGN_CENTER = '=c'
const ALIGN_RIGHT = '=r'

export type ImageAlign = 'left' | 'center' | 'right'

/** 从 title 里拆出"对齐 + 真实标题 + 图片说明" */
export function decodeImageTitle(raw: string | null | undefined): {
  align: ImageAlign
  title: string
  caption: string
} {
  const t = String(raw ?? '')
  if (!t.startsWith('=')) return { align: 'left', title: t, caption: '' }
  let rest = t.slice(1)
  let align: ImageAlign = 'left'
  if (rest.startsWith('c')) {
    align = 'center'
    rest = rest.slice(1)
  } else if (rest.startsWith('r')) {
    align = 'right'
    rest = rest.slice(1)
  }
  /* `|` 后面是**说明文字**（显示在图下面） */
  if (rest.startsWith('|')) return { align, title: '', caption: rest.slice(1) }
  /* 空标记（`=` / `=c`）或老的"空格 + 标题"写法 */
  return { align, title: rest.replace(/^\s+/, ''), caption: '' }
}

/** 拼回 title（没有对齐、也没有说明时返回空串 = 不写 title，老文档逐字节不变） */
export function encodeImageTitle(align: ImageAlign, title: string, caption = ''): string {
  const marker = align === 'center' ? ALIGN_CENTER : align === 'right' ? ALIGN_RIGHT : '='
  const body = String(title ?? '')
  const cap = String(caption ?? '').trim()
  if (cap) return `${marker}|${cap}`
  if (body) return marker === '=' ? body : `${marker} ${body}`
  return marker === '=' ? '' : marker
}

/** 居中的内联样式（编辑器里、导出的 HTML / PDF 里都用它，三处一致） */
function alignStyle(align: ImageAlign): string | null {
  if (align === 'center') return 'display:block;margin-left:auto;margin-right:auto'
  if (align === 'right') return 'display:block;margin-left:auto'
  return null
}

/**
 * 图片节点：修两个实测踩到的坑（别改回去）
 *
 * 1) 数字 alt 会把"存盘"整个搞崩
 *    Tiptap 解析 HTML 属性时有一层自动转换（@tiptap/core 的 fromString）：值长得像数字
 *    就变成 number。于是 `<img alt="18">`（知乎公式标记里到处都是这种，比如"第 18 题"）
 *    解析后 alt 是**数字** 18；而 markdown 序列化器对 alt 调 .replace() 直接抛
 *    `TypeError: e.replace is not a function` —— 结果是整篇文档存不下来、也导不出去。
 *    实测：用户那篇 166 个公式的文章导入后就是这个状态。
 *    这里给 alt/title 自己写 parseHTML（Tiptap 只在"没写 parseHTML"时才做那层转换），
 *    拿到的永远是字符串。
 *
 * 2) 兜底：序列化时一律按字符串处理
 *    就算以后有别的路径塞进来非字符串属性（粘贴、脚本、旧文档），也不会再让存盘炸掉。
 */
export const SafeImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      alt: { default: null, parseHTML: (el: HTMLElement) => el.getAttribute('alt') },
      /* title 里可能藏着对齐/说明哨兵：解析时就拆干净，节点里存的是**真实标题** */
      title: {
        default: null,
        parseHTML: (el: HTMLElement) => decodeImageTitle(el.getAttribute('title')).title || null,
      },
      align: {
        default: 'left' as ImageAlign,
        /* 两条来源都要认：`data-align`（我们导出的 HTML 再粘回来）和 title 哨兵（Markdown 存盘） */
        parseHTML: (el: HTMLElement) => {
          const raw = el.getAttribute('data-align')
          if (raw === 'center' || raw === 'right' || raw === 'left') return raw as ImageAlign
          return decodeImageTitle(el.getAttribute('title')).align
        },
        /* 左对齐（默认）**什么属性都不加** —— 保证老文档、老导出逐字节不变 */
        renderHTML: (attrs: Record<string, unknown>) => {
          const align = (attrs.align ?? 'left') as ImageAlign
          if (align === 'left') return {}
          const out: Record<string, string> = { 'data-align': align }
          const style = alignStyle(align)
          if (style) out.style = style
          return out
        },
      },
      /* 图片下面那行**居中说明**（用户："说明的文字就放在图片下面居中"）。
         存的地方还是 Markdown 的 title 槽位（`=|说明文字`），所以刷新、换电脑、
         导出 HTML / PDF 都跟着走；留空时**什么都不写**，老文档逐字节不变。 */
      caption: {
        default: '',
        parseHTML: (el: HTMLElement) => {
          /* 我们导出的 HTML 是 <figure><img><figcaption>说明</figcaption></figure> */
          const fromFigure = el.querySelector?.('figcaption')?.textContent
          if (fromFigure != null) return fromFigure.trim()
          return decodeImageTitle(el.getAttribute('title')).caption
        },
      },
    }
  },

  /**
   * DOM 结构：没说明就是一张光图（和以前一模一样）；有说明才包一层 `<figure>`，
   * 图下面跟一个 `<figcaption>`（说明）。
   *
   * 为什么不把说明画成"正文里的一段文字"：那样它会变成文档内容 —— 用户一删就没了、
   * 存进 .md 也会混进正文。挂在图片节点自己身上，它才是"这张图的说明"。
   */
  renderHTML({ node, HTMLAttributes }) {
    const caption = String((node.attrs as Record<string, unknown>).caption ?? '').trim()
    const attrs = { ...(HTMLAttributes as Record<string, unknown>) }
    if (!caption) return ['img', mergeAttributes(this.options.HTMLAttributes, attrs)]
    /* 对齐样式挪到 figure 上：说明跟着图一起居中/靠右，而不是各对各的 */
    const { style, 'data-align': dataAlign, ...imgAttrs } = attrs
    const figAttrs: Record<string, unknown> = { class: 'zh-figure' }
    if (dataAlign) figAttrs['data-align'] = dataAlign
    if (style) figAttrs.style = style
    return [
      'figure',
      figAttrs,
      ['img', mergeAttributes(this.options.HTMLAttributes, imgAttrs)],
      ['figcaption', { class: 'zh-caption' }, caption],
    ]
  },

  addStorage() {
    const parent = (this.parent?.() ?? {}) as { markdown?: Record<string, unknown> }
    return {
      ...parent,
      markdown: {
        ...(parent.markdown ?? {}),
        // 和 prosemirror-markdown 的默认实现保持一致，只是把属性强制成字符串再拼
        serialize(
          state: {
            write: (s: string) => void
            esc: (s: string) => string
            closeBlock?: (n: unknown) => void
            inTable?: boolean
          },
          node: { attrs: Record<string, unknown> },
        ) {
          const src = String(node.attrs.src ?? '')
          const alt = node.attrs.alt == null ? '' : String(node.attrs.alt)
          const title = node.attrs.title == null ? '' : String(node.attrs.title)
          const caption = node.attrs.caption == null ? '' : String(node.attrs.caption)
          /* 对齐 + 说明都写进 title 槽位（左对齐又没有说明 = 不写，见文件顶部说明） */
          const outTitle = encodeImageTitle((node.attrs.align ?? 'left') as ImageAlign, title, caption)
          state.write(
            `![${state.esc(alt)}](${src.replace(/[()]/g, '\\$&')}${outTitle ? ` "${outTitle.replace(/"/g, '\\"')}"` : ''})`,
          )
          // 块级图片后面必须空一行，否则会被粘到下一个块上。
          // 实测（用户文件）：图片后面紧跟的引用会变成 `![](图)> 引用…`，
          // 那个 `>` 就不再是引用了，整段显示成一行乱码。
          // 表格单元格里不能这么做（会切坏表格）。
          if (!state.inTable) state.closeBlock?.(node)
        },
      },
    }
  },
})
