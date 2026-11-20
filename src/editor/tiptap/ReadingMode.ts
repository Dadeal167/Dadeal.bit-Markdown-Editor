import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'

export const readingModeKey = new PluginKey<boolean>('readingMode')

export const ReadingMode = Extension.create({
  name: 'readingMode',
  addProseMirrorPlugins() {
    return [new Plugin({
      key: readingModeKey,
      state: {
        init: () => false,
        apply: (transaction, reading) => transaction.getMeta(readingModeKey) ?? reading,
      },
      filterTransaction: (transaction, state) => !transaction.docChanged || !readingModeKey.getState(state),
    })]
  },
})
