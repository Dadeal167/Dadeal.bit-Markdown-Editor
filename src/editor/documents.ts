/**
 * 多文档存储层。
 *
 * 结构：localStorage['md-editor-docs-v1'] = { docs: Doc[], currentId: string }
 * 同时兼容早期只有一个草稿槽的版本（md-editor-draft-v1）：首次加载时把它迁移成第一篇文档，
 * 老用户的内容不会丢。
 */

export interface Doc {
  id: string
  title: string
  md: string
  at: number
}

export interface DocStore {
  docs: Doc[]
  currentId: string
}

export const DOCS_KEY = 'md-editor-docs-v1'
export const LEGACY_DRAFT_KEY = 'md-editor-draft-v1'

/** 首次打开时的示例文档（只在完全没有文档时用） */
export const DEMO_MD = `# 欢迎使用

这是一篇用起来像 Word、存下来是 Markdown 的文档。**加粗**、*斜体* 直接点上面的按钮就行，不用记任何语法。

## 数学公式

点顶栏的「公式」，左边都是图形按钮，拼出来就行，比如 $x=\\frac{-b\\pm\\sqrt{b^2-4ac}}{2a}$。

$$
\\sum_{i=1}^{n} i=\\frac{n(n+1)}{2}
$$

## 列表与引用

- 无序列表：点「列表」
- 也可以切换成有序列表

> 引用：写重点句子的时候用

| 列 A | 列 B |
| --- | --- |
| 内容 1 | 内容 2 |

---
`

export function newId(): string {
  return `d${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`
}

export function createDoc(title = '', md = ''): Doc {
  return { id: newId(), title, md, at: Date.now() }
}

/** 文档在列表里的显示名 */
export function docLabel(doc: Doc): string {
  const t = doc.title.trim()
  if (t) return t
  const firstLine = doc.md
    .split('\n')
    .map((l) => l.replace(/^#+\s*/, '').trim())
    .find((l) => l.length > 0)
  return firstLine ? firstLine.slice(0, 24) : '未命名文档'
}

function readLegacy(): Doc | null {
  try {
    const raw = localStorage.getItem(LEGACY_DRAFT_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { title?: string; md?: string; at?: number }
    if (typeof parsed?.md !== 'string') return null
    // 空草稿不算：老版本第一次打开时也会写入示例内容，但用户没动过就不必迁移
    return {
      id: newId(),
      title: parsed.title ?? '',
      md: parsed.md,
      at: parsed.at ?? Date.now(),
    }
  } catch {
    return null
  }
}

export function loadStore(): DocStore {
  let initial: DocStore | null = null
  let broken = false

  try {
    const raw = localStorage.getItem(DOCS_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as DocStore
      const docs = Array.isArray(parsed?.docs) ? parsed.docs.filter((d) => d && typeof d.md === 'string') : []
      if (docs.length > 0) {
        const currentId = docs.some((d) => d.id === parsed.currentId) ? parsed.currentId : docs[0].id
        initial = { docs, currentId }
      } else {
        broken = true
      }
    }
  } catch {
    broken = true
  }

  if (broken) {
    // 数据坏了也先留一份备份再重建，别直接覆盖——用户可能还能人工抢救
    try {
      const raw = localStorage.getItem(DOCS_KEY)
      if (raw) localStorage.setItem(`${DOCS_KEY}-broken-${Date.now()}`, raw)
    } catch {
      /* 备份失败就算了 */
    }
  }

  if (!initial) {
    // 迁移旧版单草稿
    const legacy = readLegacy()
    if (legacy && legacy.md.trim()) {
      initial = { docs: [legacy], currentId: legacy.id }
    } else {
      const first = createDoc('', DEMO_MD)
      initial = { docs: [first], currentId: first.id }
    }
  }

  // 立刻落盘：迁移或首次创建的结果不能只留在内存里（否则刷新一次就白迁移了）
  saveStore(initial)
  return initial
}

/** 写入存储；返回 false 表示超配额（图片太多） */
export function saveStore(store: DocStore): boolean {
  try {
    localStorage.setItem(DOCS_KEY, JSON.stringify(store))
    return true
  } catch {
    return false
  }
}

/** 只是估个占用，用于界面提示 */
export function storeBytes(store: DocStore): number {
  try {
    return JSON.stringify(store).length
  } catch {
    return 0
  }
}
