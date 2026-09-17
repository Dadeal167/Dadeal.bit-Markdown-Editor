import { Mark, mergeAttributes } from '@tiptap/core'

/**
 * 正文文字颜色。
 *
 * 为什么单独做 mark：Markdown 没有颜色语法，所以序列化成行内 HTML
 * `<span style="color:#d93025">重点</span>`（Markdown 本身允许行内 HTML，
 * 我们的解析也开了 `html: true`，能原样读回来）。
 *
 * 注意：数学节点声明了 `marks: ''`，所以这个 mark 套不到公式上——
 * 公式的颜色只由公式弹窗里的「颜色」控制，两者互不干扰。
 */
export const TextColor = Mark.create({
  name: 'textColor',

  addAttributes() {
    return {
      color: {
        default: null,
        parseHTML: (element) => (element as HTMLElement).style.color || null,
        renderHTML: (attributes) =>
          attributes.color ? { style: `color: ${attributes.color as string}` } : {},
      },
    }
  },

  parseHTML() {
    return [{ tag: 'span[style*="color"]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes), 0]
  },

  addCommands() {
    return {
      setTextColor:
        (color: string) =>
        ({ commands }) =>
          commands.setMark(this.name, { color }),
      unsetTextColor:
        () =>
        ({ commands }) =>
          commands.unsetMark(this.name),
    }
  },

  addStorage() {
    return {
      markdown: {
        serialize: {
          open: (_state: unknown, mark: { attrs: { color?: string } }) =>
            `<span style="color:${mark.attrs.color ?? 'inherit'}">`,
          close: '</span>',
          mixable: true,
          expelEnclosingWhitespace: true,
        },
      },
    }
  },
})

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    textColor: {
      /** 给选中文字上色 */
      setTextColor: (color: string) => ReturnType
      /** 去掉选中文字的颜色 */
      unsetTextColor: () => ReturnType
    }
  }
}
