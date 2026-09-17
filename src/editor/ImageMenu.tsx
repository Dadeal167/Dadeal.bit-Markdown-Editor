import { useEffect, useRef, useState } from 'react'
import type { Editor } from '@tiptap/core'
import * as actions from './editorActions'

interface Props {
  editor: Editor | null
}

interface MenuTarget {
  /**
   * 被点的那张图在文档里的位置（点的时候算好，之后只认这个数字）。
   *
   * ⚠️ 别再存 DOM 元素本身（踩过）：加说明会把图片的 DOM 从 `<img>` 变成
   * `<figure><img>…</figure>`，节点 DOM 被重建，存下来的那个 `<img>` 立刻脱离文档 ——
   * 表现是"输入第一个字，菜单就自己关了"（用户："说明文字没法改"）。
   * 位置（`at`）不会因为改属性而变，所以每次用位置重新解析元素才是稳的。
   */
  at: number
  align: 'left' | 'center' | 'right'
  caption: string
  left: number
  top: number
}

/** 菜单打开时给图片加的高亮类名（样式在 index.css） */
const TARGET_CLASS = 'zh-img--target'

/**
 * 点到一张图片时，图片上方（放不下就下方）浮出一排图片操作：
 * 「左 / 居中 / 居右」+「图片说明」输入框（说明显示在图下面、居中）。
 *
 * 为什么要有它：图片的对齐和说明以前都没法设 —— 插进去就贴着左、光秃秃一张图。
 * 现在每张图单独设，设置跟着文档走（存在 Markdown 的 title 槽位里，见 SafeImage.ts），
 * 刷新、换电脑、导出 HTML / PDF 都一样。
 *
 * ⚠️ 为什么不按"选中的图片节点"来做（别改回去）：ProseMirror 是**按点击坐标**找最近的
 * 光标位置的，真鼠标点在图片上，选区会落到**旁边段落里的文字位置**上
 * （实测：点 400×300 的图片，selection 是 TextSelection、from 落在上一段；
 * 图片越细长越容易点偏）。试过在 handleClick 里强行设 NodeSelection，PM 随后的处理
 * 还会把它改回去。所以改成**以被点的那个元素为准**：点的时候立刻记下"哪张图、在哪个位置"，
 * 之后定位和改属性都只用这份记录 —— 跟 PM 的选区语义完全解耦。
 */
export default function ImageMenu({ editor }: Props) {
  const [target, setTarget] = useState<MenuTarget | null>(null)
  /* 说明输入框里的草稿：跟着图片位置走（换一张图就换成那张图的说明） */
  const [draft, setDraft] = useState('')
  const draftFor = useRef<number | null>(null)
  const last = useRef<MenuTarget | null>(null)
  const marked = useRef<HTMLImageElement | null>(null)

  useEffect(() => {
    if (!editor) return
    const dom = editor.view.dom

    /**
     * 按**位置**把这张图当前的 DOM 找出来。
     *
     * ⚠️ 必须每次重新解析，不能存元素（踩过）：加/去说明会把图片的 DOM 在
     * `<img>` 与 `<figure><img><figcaption></figure>` 之间切换、节点 DOM 被重建，
     * 存下来的旧 `<img>` 会立刻脱离文档 —— 而"脱离文档"看起来就跟"图片被删了"一样，
     * 于是菜单自己关掉（表现：输入第一个字菜单就消失，说明改不下去）。
     */
    const imgAt = (at: number): HTMLImageElement | null => {
      try {
        const node = editor.view.nodeDOM(at)
        if (!(node instanceof HTMLElement)) return null
        if (node.tagName === 'IMG') return node as HTMLImageElement
        return node.querySelector('img')
      } catch {
        return null
      }
    }

    /** 从被点的 <img> 反查它在文档里的位置（带说明的图外面包了 figure，位置从 figure 上取） */
    const posOf = (el: HTMLElement): number | null => {
      for (const node of [el, el.parentElement]) {
        if (!node) continue
        try {
          const at = editor.view.posAtDOM(node, 0)
          if (actions.imageAlignAt(editor, at)) return at
        } catch {
          /* 试下一个 */
        }
      }
      return null
    }

    /** 记下"点到哪张图"，并顺手把它高亮出来 */
    const onClick = (event: MouseEvent) => {
      const el = (event.target as HTMLElement | null)?.closest?.('img')
      if (!el || !dom.contains(el)) {
        setTarget(null)
        return
      }
      const at = posOf(el as HTMLElement)
      if (at == null) {
        setTarget(null)
        return
      }
      const align = actions.imageAlignAt(editor, at)
      if (!align) {
        setTarget(null)
        return
      }
      const rect = el.getBoundingClientRect()
      const caption = actions.imageCaptionAt(editor, at) ?? ''
      if (draftFor.current !== at) {
        draftFor.current = at
        setDraft(caption)
      }
      setTarget({
        at,
        align,
        caption,
        left: Math.min(Math.max(rect.left, 12), Math.max(12, window.innerWidth - 420)),
        top: rect.top > 64 ? rect.top - 42 : rect.bottom + 8,
      })
    }

    /** 位置会变（滚动 / 缩放 / 窗口大小 / 改说明导致 DOM 重建）—— 按位置重新量一次 */
    const reposition = () => {
      const cur = last.current
      if (!cur) return
      /* 图片可能被删掉/挪走：位置上的节点不再（或不再是那张）图片就收起菜单 */
      const align = actions.imageAlignAt(editor, cur.at)
      const img = align ? imgAt(cur.at) : null
      if (!align || !img) {
        setTarget(null)
        return
      }
      const rect = img.getBoundingClientRect()
      const next: MenuTarget = {
        ...cur,
        align,
        caption: actions.imageCaptionAt(editor, cur.at) ?? '',
        left: Math.min(Math.max(rect.left, 12), Math.max(12, window.innerWidth - 420)),
        top: rect.top > 64 ? rect.top - 42 : rect.bottom + 8,
      }
      if (
        !last.current ||
        last.current.left !== next.left ||
        last.current.top !== next.top ||
        last.current.align !== next.align ||
        last.current.caption !== next.caption
      ) {
        setTarget(next)
      }
    }

    dom.addEventListener('click', onClick)
    editor.on('transaction', reposition)
    window.addEventListener('scroll', reposition, true)
    window.addEventListener('resize', reposition)
    return () => {
      dom.removeEventListener('click', onClick)
      editor.off('transaction', reposition)
      window.removeEventListener('scroll', reposition, true)
      window.removeEventListener('resize', reposition)
    }
  }, [editor])

  /* 记住当前目标（给 reposition 用），并给图片加/摘高亮。
     高亮也按位置解析 —— 因为改说明会让 DOM 重建，旧元素上的类会跟着被丢掉。 */
  useEffect(() => {
    last.current = target
    if (!editor || !target) {
      if (marked.current) marked.current.classList.remove(TARGET_CLASS)
      marked.current = null
      return
    }
    let img: HTMLImageElement | null = null
    try {
      const node = editor.view.nodeDOM(target.at)
      img = node instanceof HTMLElement ? (node.tagName === 'IMG' ? (node as HTMLImageElement) : node.querySelector('img')) : null
    } catch {
      img = null
    }
    if (marked.current && marked.current !== img) marked.current.classList.remove(TARGET_CLASS)
    if (img) img.classList.add(TARGET_CLASS)
    marked.current = img
    return () => {
      img?.classList.remove(TARGET_CLASS)
    }
  }, [target, editor])

  if (!editor || !target) return null

  const buttons: { key: MenuTarget['align']; label: string; title: string }[] = [
    { key: 'left', label: '左', title: '靠左（默认，跟文字一起排）' },
    { key: 'center', label: '居中', title: '居中显示（单独占一行）' },
    { key: 'right', label: '居右', title: '靠右显示（单独占一行）' },
  ]

  return (
    <div
      className="zh-imgmenu"
      style={{ left: target.left, top: target.top }}
      /* 点按钮时不丢编辑器里的选区 —— 但**不能连输入框一起挡**：
         在容器上统一 preventDefault，输入框就拿不到焦点（用户："说明文字没法改"，
         点进去光标根本不出现）。实测踩过：这条 bug 我自己的套件没抓到，因为那里用
         `fill()` 直接赋值、绕过了鼠标焦点；现在套件里补了"真点进去 + 真打字"那条。 */
      onMouseDown={(e) => {
        if ((e.target as HTMLElement).closest('input')) return
        e.preventDefault()
      }}
    >
      <span className="zh-imgmenu__label">图片位置</span>
      {buttons.map((b) => (
        <button
          key={b.key}
          type="button"
          className={`zh-imgmenu__btn${target.align === b.key ? ' zh-imgmenu__btn--active' : ''}`}
          title={b.title}
          onClick={() => {
            actions.setImageAlign(editor, target.at, b.key)
            setTarget({ ...target, align: b.key })
          }}
        >
          {b.label}
        </button>
      ))}
      <span className="zh-imgmenu__label zh-imgmenu__label--caption">说明</span>
      <input
        className="zh-imgmenu__input"
        type="text"
        value={draft}
        placeholder="图下面居中显示（可留空）"
        title="图片说明：显示在这张图下面、居中。留空就不显示。"
        onChange={(e) => {
          /* 边打边改：只动 caption 这一个属性，序列化有防抖，逐键不卡 */
          setDraft(e.target.value)
          actions.setImageCaption(editor, target.at, e.target.value)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur()
        }}
      />
      {draft ? (
        <button
          type="button"
          className="zh-imgmenu__btn"
          title="清掉这张图的说明"
          onClick={() => {
            setDraft('')
            actions.setImageCaption(editor, target.at, '')
            setTarget({ ...target, caption: '' })
          }}
        >
          ✕
        </button>
      ) : null}
    </div>
  )
}
