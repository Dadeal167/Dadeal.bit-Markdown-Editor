import { Image } from '@tiptap/extension-image'

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
      title: { default: null, parseHTML: (el: HTMLElement) => el.getAttribute('title') },
    }
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
          state.write(
            `![${state.esc(alt)}](${src.replace(/[()]/g, '\\$&')}${title ? ` "${title.replace(/"/g, '\\"')}"` : ''})`,
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
