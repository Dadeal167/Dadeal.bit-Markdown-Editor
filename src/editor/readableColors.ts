/**
 * 深色主题下的"文字颜色"可读性修补。
 *
 * 背景：「文字颜色」是套在选中文字上的 mark，存成行内 `<span style="color:#1f2329">`。
 * 浅色下没问题，但换成深色主题后，那些**深色字**（尤其是"全选设成黑色"）就变成深底深字、
 * 看不见了 —— 用户报过"换成深色主题字体要自动变白"。
 *
 * 做法：给"太暗的彩色文字"加一层 **ProseMirror decoration**（`class="zh-dim-color"`），
 * 样式表里 `[data-theme='dark'] .zh-prose .zh-dim-color { color: var(--zh-text) !important }`
 * 把它显示成主题文字色；退出深色主题就不再产出这个 decoration，颜色原样恢复。
 * 文档内容一个字都不动（存成 .md 还是作者选的颜色）。
 *
 * ⚠️ 为什么不用"直接改 DOM"（v1 的写法，审计里真抓到过）：
 * 往编辑器渲染出来的 span 上打 `data-dim="1"` 会被 ProseMirror 自己的 MutationObserver 看见，
 * 它认为文档 DOM 被外部改动了 → 重渲染 → 我们的属性被抹掉 → 我们再打 …… 实测 2 秒里来回 116 次，
 * 最后"谁后写谁赢"，而收尾的总是 ProseMirror，于是标记掉了、黑字照旧黑。
 * decoration 是 ProseMirror **官方给外部加显示效果的口子**（代码高亮就是这么做的），
 * 它属于视图层、参与重渲染，不会打架，也不会写进 getHTML() / 导出的文件里。
 */
import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

/** 颜色 mark 的名字（见 tiptap/TextColor.ts） */
const COLOR_MARK = 'textColor'

/** 把任意 CSS 颜色解析成 [r,g,b]（支持 #rgb / #rrggbb / rgb() / rgba()）；认不出返回 null */
export function parseColor(input: string): [number, number, number] | null {
  const s = input.trim().toLowerCase()
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(s)
  if (hex) {
    const h = hex[1]
    const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
    return [parseInt(full.slice(0, 2), 16), parseInt(full.slice(2, 4), 16), parseInt(full.slice(4, 6), 16)]
  }
  const rgb = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/.exec(s)
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])]
  return null
}

/** 感知亮度（0=黑 1=白）。用 Rec.709 权重，比简单平均更贴近眼睛的感受 */
export function luminance(color: string): number | null {
  const c = parseColor(color)
  if (!c) return null
  const [r, g, b] = c.map((v) => v / 255)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** 亮度低于这个值，在深色底上就看不清了（0.45 ≈ 中灰偏暗） */
export const TOO_DARK = 0.45

/** 这个颜色在深色底上是不是看不清 */
export function isTooDark(color: string | null | undefined): boolean {
  if (!color) return false
  const lum = luminance(color)
  return lum !== null && lum < TOO_DARK
}

/** 深色下把"太暗的文字颜色"显示成主题文字色；浅色下什么都不做（留着给样式表用） */
export const DimColorFix = Extension.create({
  name: 'dimColorFix',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('dimColorFix'),
        props: {
          decorations(state) {
            // 只认"当前主题是深色"：浅色下不产出 decoration，作者选的颜色原样显示
            if (document.documentElement.dataset.theme !== 'dark') return DecorationSet.empty
            const decos: Decoration[] = []
            state.doc.descendants((node, pos) => {
              if (!node.isText || !node.text) return
              const color = node.marks.find((m) => m.type.name === COLOR_MARK)?.attrs.color as string | undefined
              if (isTooDark(color)) decos.push(Decoration.inline(pos, pos + node.nodeSize, { class: 'zh-dim-color' }))
            })
            return DecorationSet.create(state.doc, decos)
          },
        },
      }),
    ]
  },
})
