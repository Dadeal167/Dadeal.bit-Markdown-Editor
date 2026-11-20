import { Extension } from '@tiptap/core'
import { NodeSelection, Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

export const writingFocusKey = new PluginKey<boolean>('writingFocus')

export const WritingFocus = Extension.create({
  name: 'writingFocus',
  addProseMirrorPlugins() {
    return [new Plugin({
      key: writingFocusKey,
      state: {
        init: () => false,
        apply: (transaction, previous) => transaction.getMeta(writingFocusKey) ?? previous,
      },
      props: {
        decorations(state) {
          if (!writingFocusKey.getState(state)) return null
          const { selection } = state
          const anchor = selection instanceof NodeSelection ? selection.$from : selection.$head
          const from = anchor.depth ? anchor.before(1) : anchor.pos
          const block = state.doc.nodeAt(from)
          return block ? DecorationSet.create(state.doc, [
            Decoration.node(from, from + block.nodeSize, { class: 'zh-writing-current' }),
          ]) : null
        },
      },
    })]
  },
})
