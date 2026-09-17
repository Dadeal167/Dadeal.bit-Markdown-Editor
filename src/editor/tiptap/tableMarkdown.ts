import type { Editor } from '@tiptap/core'
import { Table } from '@tiptap/extension-table'

/**
 * 修 tiptap-markdown 的表格序列化：它写单元格时只渲染**第一个孩子**，
 * 而且要求 `textContent.trim()` 非空 —— 于是"整格只有一个公式"或"整格只有一张图"时，
 * 整格被跳过（实测：`| $p_{1}$ | 内容 |` 导出后公式那格变成空的，内容直接丢）。
 * 这里改成：有孩子就渲染整格，多个段落用 `<br>` 连起来。
 */
export const MarkdownTable = Table.extend({
  addStorage() {
    return {
      markdown: {
        serialize(
          state: {
            inTable: boolean
            write: (s: string) => void
            ensureNewLine: () => void
            closeBlock: (n: unknown) => void
            renderInline: (n: unknown) => void
          },
          node: { forEach: (f: (row: unknown, p: number, i: number) => void) => void },
        ) {
          state.inTable = true
          node.forEach((row, _p, i) => {
            const r = row as {
              forEach: (f: (col: unknown, p: number, j: number) => void) => void
              childCount: number
            }
            state.write('| ')
            r.forEach((col, _p2, j) => {
              if (j) state.write(' | ')
              const cell = col as { childCount: number; forEach: (f: (child: unknown, p: number, k: number) => void) => void }
              if (cell.childCount > 0) {
                cell.forEach((child, _p3, k) => {
                  if (k) state.write('<br>')
                  state.renderInline(child)
                })
              }
            })
            state.write(' |')
            state.ensureNewLine()
            if (!i) {
              const delimiterRow = Array.from({ length: r.childCount }).map(() => '---').join(' | ')
              state.write(`| ${delimiterRow} |`)
              state.ensureNewLine()
            }
          })
          state.closeBlock(node)
          state.inTable = false
        },
        parse: {
          // 解析交给 markdown-it
        },
      },
    }
  },
})

/**
 * 表格单元格里的 `|` 在 Markdown 里必须是 `\|`，否则读回来会被当成列分隔符，
 * 把表格切坏（实测：单元格 `a|b` 存盘后重开变成两格，公式 `$|x|$` 直接变成 `$` 和 `x`）。
 *
 * tiptap-markdown 的表序列化不会转义单元格内部的竖线，所以这里在拿到 md 之后，
 * **按文档里的表格结构**把这些竖线补上转义：
 *  - 从文档里统计每个单元格内部有几个竖线（文本 + 公式 latex 里的）
 *  - 逐行处理以 `|` 开头的表格行，按"这一格还该有几个内部竖线"决定 `|` 是分隔符还是内容
 *  - 行内竖线数量与预期不符就**原样返回**（宁可不动，也不能乱改内容）
 */
export function escapeTablePipes(editor: Editor, md: string): string {
  const rows: number[][] = []

  editor.state.doc.descendants((node) => {
    if (node.type.name !== 'table') return true
    node.forEach((row) => {
      const counts: number[] = []
      row.forEach((cell) => {
        let n = 0
        cell.descendants((child) => {
          if (child.isText) {
            n += (child.text?.match(/\|/g) ?? []).length
          } else if (child.type.name === 'mathInline') {
            n += String(child.attrs.latex ?? '').match(/\|/g)?.length ?? 0
          }
          return true
        })
        counts.push(n)
      })
      rows.push(counts)
    })
    // 不看嵌套表格：内层行会在它自己的 table 节点里被统计
    return false
  })

  if (rows.length === 0 || !md.includes('|')) return md

  let rowIndex = 0
  return md
    .split('\n')
    .map((line) => {
      if (!/^\s*\|/.test(line)) return line
      // 对齐行（| --- | :--: |）没有内容，跳过
      if (/^\s*\|[\s:|-]*\|\s*$/.test(line)) return line

      const counts = rows[rowIndex]
      rowIndex += 1
      if (!counts) return line

      // 预期竖线总数 = 单元格数 + 1（首尾与分隔）+ 单元格内部的竖线
      const expected = counts.length + 1 + counts.reduce((a, b) => a + b, 0)
      const actual = (line.match(/(?<!\\)\|/g) ?? []).length
      if (actual !== expected) return line // 结构对不上，宁可不改

      const left = [...counts]
      let out = ''
      let cell = -1
      for (let i = 0; i < line.length; i += 1) {
        const ch = line[i]
        if (ch === '\\') {
          out += ch + (line[i + 1] ?? '')
          i += 1
          continue
        }
        if (ch !== '|') {
          out += ch
          continue
        }
        if (cell < 0) {
          cell = 0
          out += ch
          continue
        }
        if (left[cell] > 0) {
          left[cell] -= 1
          out += '\\|'
          continue
        }
        cell += 1
        out += ch
      }
      return out
    })
    .join('\n')
}
