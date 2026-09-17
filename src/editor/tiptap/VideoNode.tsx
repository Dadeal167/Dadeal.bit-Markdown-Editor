import { Node, mergeAttributes } from '@tiptap/core'
import { NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react'
import type { NodeViewProps } from '@tiptap/react'

/** B 站播放器地址：**必须显式写 https**（见下面 normalizeEmbedSrc 的说明） */
const BILI_PLAYER = 'https://player.bilibili.com/player.html'

/**
 * 把地址里的"协议相对写法"补成 https。
 *
 * ⚠️ 这是踩过的坑：以前生成的是 `//player.bilibili.com/player.html?...`，
 * 在开发服务器（http://）下没问题，但**双击打开的那个单文件 HTML 是 file:// 协议**，
 * 浏览器会把协议相对地址解析成 `file://player.bilibili.com/...` —— 视频永远是一块白框，
 * 用户看到的就是"插入视频失败"。而且老文档里存的就是这种写法，所以**读回来时也要补**。
 */
export function normalizeEmbedSrc(src: string): string {
  const s = String(src ?? '').trim()
  if (!s) return s
  if (s.startsWith('//')) return 'https:' + s
  // 历史遗留：真的有人把 file://player... 存进过文档（在双击版里误存）
  if (s.startsWith('file://player.bilibili.com')) return 'https://' + s.slice('file://'.length)
  return s
}

/** 从一段文字里挑出链接（手机分享出来的常常带标题，比如「【标题-哔哩哔哩】 https://b23.tv/xxx」） */
function pickUrl(raw: string): string {
  const m = /https?:\/\/[^\s，。、）)】]+/i.exec(raw)
  return m ? m[0] : raw.trim()
}

export type VideoParse =
  | { ok: true; src: string; kind: 'bilibili' | 'youtube' }
  /** 认得出来是怎么回事，但没法直接嵌（比如手机分享的短链要联网才能跳转） */
  | { ok: false; reason: 'short-link' | 'unknown'; hint: string }

/**
 * 把用户粘贴的东西解析成可嵌入的播放地址。
 * 认得出的写法（都是实测用户会粘贴的）：
 *   · B 站：BV 号（带不带网址都行）、av 号、手机分享短链 b23.tv、
 *     已经是播放器的地址（?aid= / ?bvid=）
 *   · YouTube：watch?v=（v 在参数中间也行）、youtu.be、embed、shorts、live、m.youtube.com
 * 认不出时给出**能照做的提示**，而不是干巴巴一句"认不出来"。
 */
export function explainVideoInput(input: string): VideoParse {
  const raw = String(input ?? '').trim()
  if (!raw) return { ok: false, reason: 'unknown', hint: '粘贴 B 站或 YouTube 的视频链接' }
  const url = pickUrl(raw)

  // 手机 App 分享出来的是 b23.tv 短链：跳转要联网，离线（双击版）解析不了 —— 教用户怎么办
  if (/(?:^|\/\/|\.)b23\.tv\//i.test(url)) {
    return {
      ok: false,
      reason: 'short-link',
      hint: '这是手机分享的短链（b23.tv）。用浏览器打开它，把地址栏里带 BV 号的完整链接复制过来就行',
    }
  }

  // 已经是播放器地址：?aid=123 / ?bvid=BV...
  const aid = /[?&]aid=(\d+)/i.exec(url) ?? /(?:^|[^\w])av(\d+)/i.exec(url)
  if (aid) return { ok: true, src: `${BILI_PLAYER}?aid=${aid[1]}&autoplay=0`, kind: 'bilibili' }

  const bv = /(bv[0-9a-z]{10})/i.exec(url)
  if (bv) {
    // BV 号区分大小写：把前缀统一成大写的 BV，其余原样保留
    const id = 'BV' + bv[1].slice(2)
    return { ok: true, src: `${BILI_PLAYER}?bvid=${id}&autoplay=0`, kind: 'bilibili' }
  }

  const yt =
    /(?:youtube\.com\/(?:watch\?[^#\s]*?[?&]?v=|embed\/|shorts\/|live\/|v\/)|youtu\.be\/)([\w-]{11})/i.exec(url)
  if (yt) return { ok: true, src: `https://www.youtube.com/embed/${yt[1]}`, kind: 'youtube' }

  return {
    ok: false,
    reason: 'unknown',
    hint: '这个链接没认出来：支持 bilibili.com 的 BV/av 号、youtu.be 或 youtube.com/watch?v=… 链接',
  }
}

/** 老接口：只要结果，不管原因（工具栏插入、测试都在用） */
export function toEmbedUrl(input: string): { src: string; kind: 'bilibili' | 'youtube' } | null {
  const r = explainVideoInput(input)
  return r.ok ? { src: r.src, kind: r.kind } : null
}

function VideoView({ node, selected }: NodeViewProps) {
  // 老文档里可能存着 `//player...`（甚至 file://player...），显示前统一补成 https
  const src = normalizeEmbedSrc(String(node.attrs.src ?? ''))
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
        // 读回来时补协议：老文档存的是 `//player...`，不补的话双击版里永远是白框
        parseHTML: (el: HTMLElement) => normalizeEmbedSrc(el.getAttribute('data-video-src') ?? ''),
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
