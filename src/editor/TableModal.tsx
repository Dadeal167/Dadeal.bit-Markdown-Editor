import { useEffect, useState } from 'react'
import { useEscapeClose } from './useEscapeClose'

interface Props {
  open: boolean
  onClose(): void
  onConfirm(rows: number, cols: number): void
}

export default function TableModal({ open, onClose, onConfirm }: Props) {
  const [rowsStr, setRowsStr] = useState('2')
  const [colsStr, setColsStr] = useState('2')

  useEscapeClose(open, onClose)

  useEffect(() => {
    if (!open) return
    setRowsStr('2')
    setColsStr('2')
    // 必须把焦点抢到输入框：工具栏按钮的 mousedown 被 preventDefault 了，
    // 焦点还留在正文里，用户敲「3」会直接写进文档（实测过）
    const timer = window.setTimeout(() => {
      const input = document.querySelector<HTMLInputElement>('.zh-modal--table input')
      input?.focus()
      // 默认值要选中，否则用户想输 3 会变成 23
      input?.select()
    }, 30)
    return () => window.clearTimeout(timer)
  }, [open])

  if (!open) return null

  const rows = Number(rowsStr)
  const cols = Number(colsStr)
  const rowsOk = Number.isInteger(rows) && rows >= 1 && rows <= 100
  const colsOk = Number.isInteger(cols) && cols >= 1 && cols <= 8
  const valid = rowsOk && colsOk

  return (
    <div className="zh-modal-mask" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="zh-modal zh-modal--table" role="dialog" aria-modal="true" aria-label="插入表格">
        <div className="zh-modal__head">
          <span>插入表格</span>
          <button type="button" className="zh-modal__close" onClick={onClose} aria-label="关闭">
            ✕
          </button>
        </div>
        <div className="zh-modal__body">
          <div className="zh-table-form">
            <input
              type="number"
              min={1}
              max={100}
              value={rowsStr}
              placeholder="输入表格行数（最大 100 行）"
              aria-label="输入表格行数"
              onChange={(e) => setRowsStr(e.target.value.replace(/\D/g, ''))}
            />
            <input
              type="number"
              min={1}
              max={8}
              value={colsStr}
              placeholder="输入表格列数（最大 8 列）"
              aria-label="输入表格列数"
              onChange={(e) => setColsStr(e.target.value.replace(/\D/g, ''))}
            />
          </div>
          {!valid && <div className="zh-table-form__error">请输入有效数值：行数 1–100，列数 1–8</div>}
        </div>
        <div className="zh-modal__footer">
          <button type="button" className="zh-btn-plain" onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className="zh-btn-solid"
            disabled={!valid}
            onClick={() => {
              onConfirm(rows, cols)
              onClose()
            }}
          >
            插入
          </button>
        </div>
      </div>
    </div>
  )
}
