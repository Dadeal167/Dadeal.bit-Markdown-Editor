import { useEffect } from 'react'
import type { Editor } from '@tiptap/core'
import { watchSystemTheme, type Theme } from './theme'

/**
 * 主题一变，让编辑器重算一遍"深色下太暗的文字颜色"那层 decoration（见 readableColors.ts）。
 *
 * decoration 是 ProseMirror 在每次 state 更新时重算的（prosemirror-view 里
 * `viewDecorations()` 无条件跑），所以这里只要**发一个空事务**把状态推一下就够了 ——
 * 事务不带 doc/selection 变化，也不进撤销历史，用户无感。
 *
 * 跟随系统时还有第二种"主题变了"：用户没点任何东西，是**系统**切到了深色。
 * 那时 React 那边的 theme 没变、本效果不会重跑（实测症状：深色下太暗的文字还是黑的，
 * 直到用户下一次编辑才恢复），所以这里自己订阅一次系统主题变化；
 * 用 queueMicrotask 是为了等 ZhihuEditor 里那个 `applyTheme('system')` 先跑完
 * （它负责改 `<html data-theme>`，decoration 算的时候要读到新值）。
 */
export function useDimColorFix(theme: Theme, editor: Editor | null): void {
  useEffect(() => {
    if (!editor || editor.isDestroyed) return
    const push = () => {
      if (editor.isDestroyed) return
      editor.view.dispatch(editor.state.tr.setMeta('dimColorFixTheme', Date.now()))
    }
    push()
    if (theme !== 'system') return
    return watchSystemTheme(() => queueMicrotask(push))
  }, [theme, editor])
}
