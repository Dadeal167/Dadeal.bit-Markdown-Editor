import { useEffect, useRef, useState } from 'react'
import type { Editor } from '@tiptap/core'
import * as actions from './editorActions'

interface Props {
  editor: Editor | null
}

interface MenuPos {
  left: number
  top: number
  rows: number
  cols: number
  canMerge: boolean
  canSplit: boolean
}

/** 光标在表格里时，表格上方（放不下就下方）浮出一排结构操作按钮 */
export default function TableMenu({ editor }: Props) {
  const [pos, setPos] = useState<MenuPos | null>(null)
  const last = useRef<MenuPos | null>(null)

  useEffect(() => {
    if (!editor) return
    const update = () => {
      const table = actions.currentTableElement(editor)
      if (!table) {
        if (last.current !== null) {
          last.current = null
          setPos(null)
        }
        return
      }
      const rect = table.getBoundingClientRect()
      const { rows, cols } = actions.tableSize(editor)
      const next: MenuPos = {
        left: Math.min(Math.max(rect.left, 12), Math.max(12, window.innerWidth - 420)),
        // 表格顶部空间不够就放到表格下面
        top: rect.top > 64 ? rect.top - 42 : rect.bottom + 8,
        rows,
        cols,
        canMerge: editor.can().mergeCells(),
        canSplit: editor.can().splitCell(),
      }
      const prev = last.current
      if (
        !prev ||
        prev.left !== next.left ||
        prev.top !== next.top ||
        prev.rows !== next.rows ||
        prev.cols !== next.cols ||
        prev.canMerge !== next.canMerge ||
        prev.canSplit !== next.canSplit
      ) {
        last.current = next
        setPos(next)
      }
    }

    update()
    editor.on('selectionUpdate', update)
    editor.on('transaction', update)
    window.addEventListener('scroll', update, true)
    window.addEventListener('resize', update)
    return () => {
      editor.off('selectionUpdate', update)
      editor.off('transaction', update)
      window.removeEventListener('scroll', update, true)
      window.removeEventListener('resize', update)
    }
  }, [editor])

  if (!editor || !pos) return null

  const buttons: { key: string; label: string; title: string; run: () => void; disabled?: boolean }[] = [
    {
      key: 'row-before',
      label: '↑ 插行',
      title: '在光标所在行上方插入一行',
      run: () => actions.addRowBefore(editor),
    },
    {
      key: 'row-after',
      label: '↓ 插行',
      title: '在光标所在行下方插入一行',
      run: () => actions.addRowAfter(editor),
    },
    {
      key: 'col-before',
      label: '← 插列',
      title: '在光标所在列左侧插入一列',
      run: () => actions.addColumnBefore(editor),
    },
    {
      key: 'col-after',
      label: '→ 插列',
      title: '在光标所在列右侧插入一列',
      run: () => actions.addColumnAfter(editor),
    },
    {
      key: 'row-del',
      label: '删本行',
      title: '删除光标所在这一行',
      run: () => actions.deleteRow(editor),
      disabled: pos.rows <= 1,
    },
    {
      key: 'col-del',
      label: '删本列',
      title: '删除光标所在这一列',
      run: () => actions.deleteColumn(editor),
      disabled: pos.cols <= 1,
    },
    {
      key: 'merge',
      label: '合并',
      title: '合并选中的多个单元格',
      run: () => actions.mergeCells(editor),
      disabled: !pos.canMerge,
    },
    {
      key: 'split',
      label: '拆分',
      title: '拆分已合并的单元格',
      run: () => actions.splitCell(editor),
      disabled: !pos.canSplit,
    },
  ]

  return (
    <div
      className="zh-tablemenu"
      style={{ left: pos.left, top: pos.top }}
      // 阻止 mousedown 默认行为：保住编辑器里的光标位置
      onMouseDown={(e) => e.preventDefault()}
    >
      <span className="zh-tablemenu__size">
        {pos.rows} 行 × {pos.cols} 列
      </span>
      {buttons.map((b) => (
        <button
          key={b.key}
          type="button"
          className="zh-tablemenu__btn"
          title={b.title}
          disabled={b.disabled}
          onClick={b.run}
        >
          {b.label}
        </button>
      ))}
      <button
        type="button"
        className="zh-tablemenu__btn zh-tablemenu__btn--danger"
        title="把整个表格删掉"
        onClick={() => actions.deleteTable(editor)}
      >
        删除表格
      </button>
    </div>
  )
}
