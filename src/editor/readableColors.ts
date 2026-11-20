/** 使用 ProseMirror 装饰标记低对比度文字，保持文档颜色标记和撤销记录。 */
import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { relativeLuminance, rgbLuminance } from './pageBackground'

/** 颜色 mark 的名字（见 tiptap/TextColor.ts） */
const COLOR_MARK = 'textColor'

/** 把任意 CSS 颜色解析成 [r,g,b]（支持 #rgb / #rrggbb / rgb() / rgba()）；认不出返回 null */
export function parseColor(input: string): [number, number, number] | null {
  const s = input.trim().toLowerCase()
  if (s === 'white') return [255, 255, 255]
  if (s === 'black') return [0, 0, 0]
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

/** 仅调整屏幕上的低对比度文字，保留文档中的颜色标记。 */
export const DimColorFix = Extension.create({
  name: 'dimColorFix',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('dimColorFix'),
        props: {
          decorations(state) {
            const root = document.documentElement
            const dark = (root.dataset.paperTone ?? root.dataset.theme) === 'dark'
            const glass = root.dataset.memoryLobby === 'on' && root.dataset.lobbyMaterial !== 'solid'
            const paper = root.style.getPropertyValue('--doc-bg') || (dark ? '#1e2126' : '#ffffff')
            const background = relativeLuminance(glass ? (dark ? '#626262' : '#909090') : paper)
            const decos: Decoration[] = []
            state.doc.descendants((node, pos) => {
              if (!node.isText || !node.text) return
              const color = node.marks.find((m) => m.type.name === COLOR_MARK)?.attrs.color as string | undefined
              const rgb = color ? parseColor(color) : null
              if (!rgb) return
              const foreground = rgbLuminance(rgb)
              const contrast = (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05)
              if (contrast < 4.5 || (glass && (dark ? foreground <= background : foreground >= background))) {
                decos.push(Decoration.inline(pos, pos + node.nodeSize, { class: 'zh-dim-color' }))
              }
            })
            return DecorationSet.create(state.doc, decos)
          },
        },
      }),
    ]
  },
})
