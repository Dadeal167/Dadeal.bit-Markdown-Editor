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
import { SearchHighlight } from './search'
import type { Node as PMNode } from '@tiptap/pm/model'
import { convertRawMath, escapeNonMathDollars } from './math/rawMathText'
import { protectMathSpans, recoverEscapedMath, stripLeakedMarks } from './tiptap/mathMarkdown'
import { repairLatex } from './math/latexRepair'
import { looksLikeFormula, stripExporterHeader } from './zhihuMarkdown'
import { MarkdownTable } from './tiptap/tableMarkdown'
import { MAX_IMAGE_FILE, getMarkdown, prepareImageDataUrl, setMarkdown } from './editorActions'

interface MarkdownStorage {
  parser?: { parse: (content: string, options?: { inline?: boolean }) => string }
}

/**
 * 复制成**纯文本**时，公式要写成 `$…$`，不能凭空消失。
 *
 * 为什么必须在这里修：ProseMirror 的默认纯文本序列化是
 *     slice.content.textBetween(0, slice.content.size, "\n\n")
 * 而 `textBetween` 对**没有 leafText 的原子节点**贡献空字符串 ——
 * `mathInline` / `mathBlock` / 图片都是原子节点，于是复制出来的纯文本里公式整个不见
 * （实测：`前面文字  后面文字`，连 `$` 都不剩）。粘到微信 / 记事本 / 聊天窗口
 * （只认纯文本的地方）公式就丢了。
 *
 * 为什么不在节点 spec 上加 `leafText`（更直觉的位置）：**TipTap 会静默丢弃它**，
 * 实测 schema 里根本没有 `leafText` 这个键，加了等于没加（复制结果一个字都没变）。
 * 所以只能走 ProseMirror 的 view prop。
 *
 * 只动「纯文本」这一份表示：`text/html` 那条路由节点的 renderHTML 负责，
 * 公式仍是带 data-latex 的真节点，粘回本编辑器不会退化成源码。
 */
function clipboardTextSerializer(slice: { content: PMNode }): string {
  const leaf = (node: PMNode): string => {
    const attrs = (node.attrs ?? {}) as Record<string, unknown>
    if (node.type.name === 'mathInline') {
      const latex = String(attrs.latex ?? '')
      return latex ? `$${latex}$` : ''
    }
    if (node.type.name === 'mathBlock') {
      const latex = String(attrs.latex ?? '')
      return latex ? `$$\n${latex}\n$$` : ''
    }
    /* 图片等其它原子节点：退回 alt / src，至少不是一片空白 */
    return String(attrs.alt ?? attrs.src ?? '')
  }
  /* 这里用结构类型而不是 PMNode：`PMNode['content']` 会被解析成 DOM 的 Node
     （两者同名，PMNode 是由 @tiptap/pm 重新导出的），拿不到 textBetween 的签名 */
  const content = slice.content as unknown as {
    size: number
    textBetween: (from: number, to: number, blockSep: string, leaf: (n: PMNode) => string) => string
  }
  /* 最后过一道"标记字符守卫"：用户实测 Ctrl+C 粘到记事本时，公式定界符曾变成
     U+0002（内部标记）—— 显示成豆腐块 □、或干脆不可见。见 mathMarkdown.stripLeakedMarks。 */
  return stripLeakedMarks(content.textBetween(0, content.size, '\n\n', leaf), 'copy')
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
      // 搜索高亮：也是 decoration，搜完不会在文档里留下任何痕迹
      SearchHighlight,
    ],
    // ⚠️ 初始内容**不能**交给 content: 直接解析 —— 那会绕过公式保护，
    //    $…$ 里的 \{ \} \% \# 会被 Markdown 的转义规则吃掉（实测：$\left \{ x \right \}$
    //    存盘再打开就变成 $\left { x \right }$，公式坏掉；重开几次越坏越多）。
    //    真正的载入在下面的 onCreate 里走 setMarkdown()（和「打开 .md」同一条路）。
    content: '',
    // Markdown 输入开关：TipTap 的输入规则只在建插件时读取这个选项，
    // 运行时改不了，所以切换开关时靠下面的 deps 重建编辑器（内容经 initialMarkdown 无缝衔接）
    enableInputRules: markdownInput,
    enablePasteRules: markdownInput,
    editorProps: {
      attributes: {
        class: 'zh-prose',
        spellcheck: 'false',
      },
      /**
       * 复制成**纯文本**时，公式要写成 `$…$`，不能凭空消失。
       *
       * 为什么必须在这里修：ProseMirror 的默认纯文本序列化是
       *     slice.content.textBetween(0, slice.content.size, "\n\n")
       * 而 `textBetween` 对**没有 leafText 的原子节点**贡献空字符串 ——
       * `mathInline` / `mathBlock` / 图片都是原子节点，于是复制出来的纯文本里
       * 公式整个不见（实测：`前面文字  后面文字`，连 `$` 都不剩）。
       * 粘到微信 / 记事本 / 聊天窗口（只认纯文本的地方）公式就丢了。
       *
       * 为什么不在节点 spec 上加 `leafText`（更直觉的位置）：**TipTap 会静默丢弃它**，
       * 实测 schema 里根本没有 `leafText` 这个键，加了等于没加。所以只能走 view prop。
       *
       * 只动「纯文本」这一份表示：`text/html` 那条路由 renderHTML 负责，
       * 公式仍是带 data-latex 的真节点，粘回本编辑器不会退化成源码。
       */
      clipboardTextSerializer: clipboardTextSerializer as never,
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
              // 免得粘一段"原价 $100，现价 $60"也变成公式。
              // 顺序：escapeNonMathDollars（裸 $ → \$）→ recoverEscapedMath（把
              // "被转义过的公式原文" \$\frac…\$ 恢复成正常公式）→ protectMathSpans（上占位符）。
              // 中间那步和「打开 .md」那条路**共用同一个函数** —— 否则会出现
              // "打开能救回来、粘贴救不回来"的不一致（踩过）。
              const { md, spans } = protectMathSpans(
                recoverEscapedMath(escapeNonMathDollars(stripExporterHeader(text)), looksLikeFormula),
              )
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
      /* 初始文档走 setMarkdown（= 打开 .md 那条路）：先把公式换成占位符再交给 Markdown 解析，
         解析完再还原成公式节点，顺手把坏写法修好。
         以前这里是 `content: initialMarkdown` 直接解析 —— 于是每次打开编辑器，
         公式里的 \{ \} \% \# 都会被 Markdown 的转义规则吃掉一层，越开越坏（用户报的正是这个）。 */
      if (initialMarkdown) setMarkdown(instance, initialMarkdown)
      onReady?.(instance)
    },
    onDestroy() {
      // 切换 Markdown 输入开关会重建编辑器：销毁时立刻清掉引用，
      // 否则重建的空档里点到工具栏按钮就会拿到已销毁的实例（报 reading 'commands'）
      editorRef.current = null
    },
    onUpdate({ editor: instance }) {
      editorRef.current = instance
      /* ⚠️ 必须交**收尾后**的 Markdown（editorActions.getMarkdown），不能给
         storage.markdown.getMarkdown() 的原始输出 —— 原始输出里公式定界符还是
         内部标记 U+0002/U+0003（finalizeMarkdown 还没跑）。这个值会进 mdRef →
         1.2 秒后被自动保存写进存储：正常关页时 beforeunload 会用收尾版盖住，
         但**崩溃 / 强杀 / 断电**时不会 —— 于是下次打开正文里全是"豆腐块" □，
         公式退化成纯文本，再存盘反斜杠又被转义成 \\（用户 copy-test.txt 取证：
         U+0002 出现 332 次 = 那篇文档正好 332 个 $，就是这条路漏出去的）。
         getMarkdown 里的公式修复有缓存（latexRepair），逐键调用不卡。 */
      onUpdate(getMarkdown(instance))
    },
  }, [markdownInput])

  return editor
}
