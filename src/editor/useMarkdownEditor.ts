import { useCallback, useRef } from 'react'
import { useEditor } from '@tiptap/react'
import type { Editor } from '@tiptap/core'
import { DOMParser as PMDOMParser } from '@tiptap/pm/model'
import StarterKit from '@tiptap/starter-kit'
import { CharacterCount, Placeholder } from '@tiptap/extensions'
import { TableKit } from '@tiptap/extension-table'
import { SafeImage } from './tiptap/SafeImage'
import { CodeBlockLowlight } from '@tiptap/extension-code-block-lowlight'
import { ReactNodeViewRenderer } from '@tiptap/react'
import CodeBlockView from './CodeBlockView'
import { createLowlight, common } from 'lowlight'
import { Markdown } from 'tiptap-markdown'
import { MathBlock, MathInline } from './tiptap/MathNode'
import { VideoEmbed } from './tiptap/VideoNode'
import { TextColor } from './tiptap/TextColor'
import { DimColorFix } from './readableColors'
import { convertRawMath, escapeNonMathDollars } from './math/rawMathText'
import { protectMathSpans } from './tiptap/mathMarkdown'
import { repairLatex } from './math/latexRepair'
import { MarkdownTable } from './tiptap/tableMarkdown'
import { MAX_IMAGE_FILE, prepareImageDataUrl } from './editorActions'

interface MarkdownStorage {
  parser?: { parse: (content: string, options?: { inline?: boolean }) => string }
}

const lowlight = createLowlight(common)

/** 代码块 + 语言选择器（语言长在代码块自己头上；导出的是文档本身，不含这行 UI） */
const CodeBlockWithLang = CodeBlockLowlight.extend({
  addNodeView() {
    return ReactNodeViewRenderer(CodeBlockView)
  },
}).configure({ lowlight })

interface Options {
  initialMarkdown: string
  /** Markdown 输入开关：开=输入 "# "、"- " 这类语法会自动转换；关=原样输入 */
  markdownInput: boolean
  onUpdate(markdown: string): void
  onReady?(editor: Editor): void
}

export function useMarkdownEditor({ initialMarkdown, markdownInput, onUpdate, onReady }: Options) {
  const editorRef = useRef<Editor | null>(null)

  const insertImageFiles = useCallback(async (files: File[]) => {
    let failed = 0
    for (const file of files) {
      if (file.size > MAX_IMAGE_FILE) {
        window.alert('图片超过 12MB，先压缩一下再插入吧')
        continue
      }
      // 每一轮都重新取一次实例：等图片解码的这会儿，编辑器可能已经被重建了
      // （切「Markdown 输入」开关就会重建），拿旧的实例去插入是插不进去的
      const editor = editorRef.current
      if (!editor || editor.isDestroyed) {
        failed += 1
        continue
      }
      try {
        // 大图自动缩放到长边 1600px 再内嵌，避免 Markdown 体积失控
        const dataUrl = await prepareImageDataUrl(file)
        editor.chain().focus().setImage({ src: dataUrl, alt: file.name }).run()
      } catch {
        // 单张读不出来就跳过这一张，别把后面几张一起丢掉（以前是整批静默中断）
        failed += 1
      }
    }
    if (failed > 0) window.alert(`有 ${failed} 张图片没能读进来（已跳过），可以再试一次或换一张`)
  }, [])

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        codeBlock: false,
        heading: { levels: [1, 2, 3] },
        // 链接要能直接点开（用户反馈"输出的网址点不动"）；
        // 想改文字就点到链接旁边用方向键，或再点「链接」按钮
        link: { openOnClick: true, autolink: true, linkOnPaste: true },
      }),
      Placeholder.configure({ placeholder: '请输入正文' }),
      CharacterCount,
      // table 用我们自己的（修过"整格只有公式/图片时导出会丢"的序列化问题）
      TableKit.configure({ table: false }),
      MarkdownTable.configure({ resizable: false }),
      // 图片用我们自己的（修过"数字 alt 会让整篇存不下来"的坑）
      SafeImage.configure({ allowBase64: true }),
      CodeBlockWithLang,
      Markdown.configure({
        html: true,
        tightLists: true,
        linkify: true,
        breaks: false,
        // 粘贴跟随「Markdown 输入」开关：开着时把粘进来的 Markdown 直接转成排版好的正文
        // （学生从 ChatGPT / 别处复制一段带 ## 和 ** 的内容，不该原样堆一屏符号）
        transformPastedText: markdownInput,
        transformCopiedText: false,
      }),
      MathInline,
      MathBlock,
      VideoEmbed,
      TextColor,
      // 深色主题下把"太暗的文字颜色"显示成主题文字色（decoration，不动文档内容）
      DimColorFix,
    ],
    content: initialMarkdown,
    // Markdown 输入开关：TipTap 的输入规则只在建插件时读取这个选项，
    // 运行时改不了，所以切换开关时靠下面的 deps 重建编辑器（内容经 initialMarkdown 无缝衔接）
    enableInputRules: markdownInput,
    enablePasteRules: markdownInput,
    editorProps: {
      attributes: {
        class: 'zh-prose',
        spellcheck: 'false',
      },
      handlePaste(_view, event) {
        const files = Array.from(event.clipboardData?.files ?? []).filter((f) =>
          f.type.startsWith('image/'),
        )
        if (files.length > 0) {
          event.preventDefault()
          void insertImageFiles(files)
          return true
        }

        const html = event.clipboardData?.getData('text/html') ?? ''
        const text = event.clipboardData?.getData('text/plain') ?? ''
        const instance = editorRef.current
        if (!instance) return false

        /* ---- 1) 纯文本粘贴（从记事本 / 别的编辑器复制 Markdown 源码）----
           默认那条路会把 `$a_1$` 解析成 `$a<em>1</em>$`，公式碎成一堆原文。
           这里自己接管：先把公式换成占位符再交给 Markdown 解析器（和「打开」一致）。 */
        if (!html && text.includes('$') && markdownInput) {
          const storage = instance.storage as unknown as { markdown?: MarkdownStorage }
          const parser = storage.markdown?.parser
          if (parser) {
            event.preventDefault()
            try {
              // 只把"看着像公式"的 $…$ 交给公式保护，其余美元号转义成字面 \$，
              // 免得粘一段"原价 $100，现价 $60"也变成公式
              const { md, spans } = protectMathSpans(escapeNonMathDollars(text))
              for (const span of spans) span.latex = repairLatex(span.latex, span.display)
              // 解析出来的是 HTML（公式已经是 data-math-inline 节点）
              const holder = document.createElement('div')
              holder.innerHTML = parser.parse(md, { inline: true })
              // 注意：不能走 commands.insertContent —— tiptap-markdown 把 insertContentAt
              // 改成了"再按 Markdown 解析一遍"，会把刚还原好的公式和美元号重新搅一遍
              const slice = PMDOMParser.fromSchema(instance.schema).parseSlice(holder, {
                preserveWhitespace: true,
                context: instance.state.selection.$from,
              })
              instance.view.dispatch(instance.state.tr.replaceSelection(slice))
            } catch {
              // 出岔子就把原文照常插进去，至少不丢内容
              instance.commands.insertContent(text)
            }
            return true
          }
        }

        /* ---- 2) 富文本粘贴（从网页 / 导出 HTML / Word 复制）----
           那些导出工具的 HTML 里公式本来就是纯文本 `$…$`，这条路不经过
           Markdown 解析，公式会原样留下。粘完扫一遍，把"原文公式"换成公式节点。
           要不要转换交给 convertRawMath 自己判断（它只动"看着像公式"的 `$…$`）——
           这里不再用"必须含 \ ^ _" 预筛，否则 `$x+y$` 这种公式会被漏掉。 */
        if (html || text.includes('$')) {
          window.setTimeout(() => {
            const ed = editorRef.current
            if (ed && !ed.isDestroyed) convertRawMath(ed)
          }, 0)
        }
        return false
      },
      handleDrop(_view, event) {
        const files = Array.from((event as DragEvent).dataTransfer?.files ?? []).filter((f) =>
          f.type.startsWith('image/'),
        )
        if (files.length === 0) return false
        event.preventDefault()
        void insertImageFiles(files)
        return true
      },
    },
    onCreate({ editor: instance }) {
      editorRef.current = instance
      onReady?.(instance)
    },
    onDestroy() {
      // 切换 Markdown 输入开关会重建编辑器：销毁时立刻清掉引用，
      // 否则重建的空档里点到工具栏按钮就会拿到已销毁的实例（报 reading 'commands'）
      editorRef.current = null
    },
    onUpdate({ editor: instance }) {
      editorRef.current = instance
      const storage = instance.storage as unknown as { markdown?: { getMarkdown?: () => string } }
      onUpdate(storage.markdown?.getMarkdown?.() ?? '')
    },
  }, [markdownInput])

  return editor
}
