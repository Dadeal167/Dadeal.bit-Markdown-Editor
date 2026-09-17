import { Node, mergeAttributes } from '@tiptap/core'
import { NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react'
import type { NodeViewProps } from '@tiptap/react'

/** 把 B 站 / YouTube 链接转成可嵌入的播放地址 */
export function toEmbedUrl(input: string): { src: string; kind: 'bilibili' | 'youtube' } | null {
  const url = input.trim()
  if (!url) return null
  const bv = /(BV[0-9A-Za-z]{10})/.exec(url)
  if (bv) return { src: `//player.bilibili.com/player.html?bvid=${bv[1]}&autoplay=0`, kind: 'bilibili' }
  const av = /av(\d+)/i.exec(url)
  if (av) return { src: `//player.bilibili.com/player.html?aid=${av[1]}&autoplay=0`, kind: 'bilibili' }
  const yt = /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([\w-]{11})/.exec(url)
  if (yt) return { src: `https://www.youtube.com/embed/${yt[1]}`, kind: 'youtube' }
  return null
}

function VideoView({ node, selected }: NodeViewProps) {
  const src = String(node.attrs.src ?? '')
  const kind = String(node.attrs.kind ?? '')
  return (
    <NodeViewWrapper
      as="div"
      className={`video-node${selected ? ' video-node--selected' : ''}`}
      data-video-src={src}
      data-video-kind={kind}
    >
      <div className="video-node__frame" contentEditable={false}>
        <iframe src={src} allowFullScreen title="嵌入视频" loading="lazy" />
      </div>
      <div className="video-node__caption">{kind === 'bilibili' ? 'B 站视频' : 'YouTube 视频'}</div>
    </NodeViewWrapper>
  )
}

export const VideoEmbed = Node.create({
  name: 'videoEmbed',
  group: 'block',
  atom: true,
  draggable: true,

  addAttributes() {
    return {
      src: {
        default: '',
        parseHTML: (el: HTMLElement) => el.getAttribute('data-video-src') ?? '',
        renderHTML: (attrs: Record<string, unknown>) => ({ 'data-video-src': attrs.src }),
      },
      kind: {
        default: 'bilibili',
        parseHTML: (el: HTMLElement) => el.getAttribute('data-video-kind') ?? 'bilibili',
        renderHTML: (attrs: Record<string, unknown>) => ({ 'data-video-kind': attrs.kind }),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-video-src]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes)]
  },

  addNodeView() {
    return ReactNodeViewRenderer(VideoView)
  },

  addStorage() {
    return {
      markdown: {
        // 以 HTML 形式落盘，tiptap-markdown 的 html 选项会原样保留，回读时由 parseHTML 接管
        serialize(
          state: { write: (s: string) => void; closeBlock: (n: unknown) => void },
          node: { attrs: { src: string; kind: string } },
        ) {
          state.write(`<div data-video-src="${node.attrs.src}" data-video-kind="${node.attrs.kind}"></div>`)
          state.closeBlock(node)
        },
      },
    }
  },
})
