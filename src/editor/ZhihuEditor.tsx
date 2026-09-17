import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { EditorContent } from '@tiptap/react'
import type { Editor } from '@tiptap/core'
import Toolbar from './Toolbar'
import type { ToolbarHandlers } from './Toolbar'
import StatusBar from './StatusBar'
import MathModal from './MathModal'
import TableModal from './TableModal'
import TableMenu from './TableMenu'
import LinkModal from './LinkModal'
import VideoModal from './VideoModal'
import HelpModal from './HelpModal'
import type { EditorApi, OutlineItem } from './types'
import * as actions from './editorActions'
import SaveMenu from './SaveMenu'
import type { SaveFormat } from './SaveMenu'
import { exportZhihuMarkdown } from './saveFormats'
import { setMathEditHandler } from './mathEvents'
import { useMarkdownEditor } from './useMarkdownEditor'
import DocMenu from './DocMenu'
import ShortcutModal from './ShortcutModal'
import TypographyMenu from './TypographyMenu'
import ZhihuModal from './ZhihuModal'
import { applyTypography, loadTypography, saveTypography, type Typography } from './typography'
import { applyTheme, loadTheme, saveTheme, watchSystemTheme, type Theme } from './theme'
import { useDimColorFix } from './useDimColorFix'
import { loadCustomFonts, type CustomFont } from './customFonts'
import { SHORTCUT_ACTIONS, loadBindings, normalizeEvent, shortcuts } from './shortcuts'
import type { Doc } from './documents'
import {
  DEMO_MD,
  createDoc,
  loadStore,
  onStoreReloaded,
  onStoreWriteFailed,
  onStoreWriteOk,
  saveStore,
  storeBytes,
} from './documents'

const SAVE_DELAY_MS = 1200

interface MathSeed {
  latex: string
  display: boolean
  pos: number | null
}

export default function ZhihuEditor() {
  // 注意：必须用 useState 的惰性初始化。写成 useRef(loadStore()) 的话，
  // loadStore() 会在**每次渲染**都执行一遍——而它内部会读+写整个文档库（含 base64 图片），
  // 等于每敲一个字就 JSON 解析+写回几 MB（实测 3 次输入触发 3 次全量读写）。
  const [boot] = useState(() => loadStore())
  const editorRef = useRef<Editor | null>(null)
  const saveTimer = useRef<number | null>(null)
  const bootDoc = boot.docs.find((d) => d.id === boot.currentId) ?? boot.docs[0]
  const titleRef = useRef(bootDoc.title)
  const mdRef = useRef(bootDoc.md)
  const [docs, setDocs] = useState<Doc[]>(boot.docs)
  const [currentId, setCurrentId] = useState(bootDoc.id)
  const [markdownInput, setMarkdownInput] = useState(true)

  const [title, setTitle] = useState(bootDoc.title)
  const [savedAt, setSavedAt] = useState<number | null>(bootDoc.at || null)
  const [wordCount, setWordCount] = useState(0)
  const [outlineOpen, setOutlineOpen] = useState(false)
  const [outline, setOutline] = useState<OutlineItem[]>([])
  const [mathOpen, setMathOpen] = useState(false)
  const [mathSeed, setMathSeed] = useState<MathSeed>({ latex: '', display: false, pos: null })
  const [tableOpen, setTableOpen] = useState(false)
  const [linkOpen, setLinkOpen] = useState(false)
  const [videoOpen, setVideoOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [docsOpen, setDocsOpen] = useState(false)
  const [zhihuOpen, setZhihuOpen] = useState(false)
  const [typography, setTypography] = useState<Typography>(() => loadTypography())
  const [typographyOpen, setTypographyOpen] = useState(false)
  const [hasSelection, setHasSelection] = useState(false)
  const [saveFailed, setSaveFailed] = useState(false)
  const saveFailedRef = useRef(false)
  const [theme, setTheme] = useState<Theme>(() => loadTheme())
  const [customFonts, setCustomFonts] = useState<CustomFont[]>([])
  /** 文档体检结果：打不开的图片数 / 渲染不出来的公式数 */
  const [issues, setIssues] = useState({ images: 0, math: 0, raw: 0 })
  const [issuesHidden, setIssuesHidden] = useState(false)
  /** 修复完的一句反馈（绿条，几秒后自己消失） */
  const [fixNote, setFixNote] = useState<string | null>(null)
  const fixNoteTimer = useRef<number | null>(null)

  /* ---------- 启动时把用户装的字体重新注册（存在 IndexedDB，关掉再打开还在） ---------- */
  useEffect(() => {
    let alive = true
    loadCustomFonts()
      .then((list) => {
        if (alive) setCustomFonts(list)
      })
      .catch(() => {
        /* 浏览器不支持 IndexedDB 时忽略：只是没有自定义字体 */
      })
    return () => {
      alive = false
    }
  }, [])

  /* ---------- 文档库写失败时的提示 ----------
     文档存在 IndexedDB 里，写它是异步的：失败要等一会儿才知道，没法靠 saveStore 的返回值同步报出来。
     所以这里订阅"写坏了/写好了"：坏了弹一次（之后靠状态栏常驻红字），好了自动恢复。 */
  useEffect(() => {
    onStoreWriteFailed(() => {
      if (saveFailedRef.current) return
      saveFailedRef.current = true
      setSaveFailed(true)
      window.alert(
        '保存失败：浏览器没能把内容写进本地数据库（可能是磁盘空间不够，或者浏览器被设成不保存数据）。\n' +
          '刚改的这一版已经临时存到备用位置；建议先「保存 .md」导出到文件，再排查一下。',
      )
    })
    onStoreWriteOk(() => {
      if (!saveFailedRef.current) return
      saveFailedRef.current = false
      setSaveFailed(false)
    })
    /* IndexedDB 迟到（启动时那 3 秒超时了）：界面先拿 localStorage 那份画出来了，
       等它真的读回来，直接换成它那份（存储层只在"窗口期内没编辑过"时才喊这一声）。 */
    onStoreReloaded((store) => {
      docsRef.current = store.docs
      currentIdRef.current = store.currentId
      setDocs(store.docs)
      setCurrentId(store.currentId)
      const cur = store.docs.find((d) => d.id === store.currentId)
      if (cur) {
        mdRef.current = cur.md
        titleRef.current = cur.title
        const ed = editorRef.current
        if (ed) actions.setMarkdown(ed, cur.md)
      }
    })
    return () => {
      onStoreWriteFailed(null)
      onStoreWriteOk(null)
      onStoreReloaded(null)
    }
  }, [])

  /* ---------- 主题：浅色 / 深色 / 跟随系统 ---------- */  useEffect(() => {
    applyTheme(theme)
    saveTheme(theme)
    // 选"跟随系统"时，系统切换要实时跟着变
    if (theme !== 'system') return
    return watchSystemTheme(() => applyTheme('system'))
  }, [theme])

  /* 深色下把"太暗的文字颜色"显示成近白色（文档里的行内 color 一个字不动，见 readableColors.ts）
     注意：必须放在 editor 创建之后调用（它要发一个空事务让 decoration 重算）—— 见下面 useDimColorFix。 */

  /* ---------- 正文字号 / 字体（作用于整篇，存 localStorage） ---------- */
  useEffect(() => {
    applyTypography(typography)
    saveTypography(typography)
  }, [typography])

  /* ---------- 文档存取 ----------
     注意：onUpdate 是编辑器创建时捕获的闭包，它调用的保存函数必须只依赖 ref，
     否则会拿着过期的 docs/currentId 去写存储，把别的文档覆盖掉。 */
  const docsRef = useRef(docs)
  const currentIdRef = useRef(currentId)

  const writeStore = useCallback((nextDocs: Doc[], nextId: string): boolean => {
    const ok = saveStore({ docs: nextDocs, currentId: nextId })
    if (!ok) return false
    docsRef.current = nextDocs
    currentIdRef.current = nextId
    setDocs(nextDocs)
    setCurrentId(nextId)
    return true
  }, [])

  /** 把当前编辑器内容写回当前文档并落盘 */
  const persistDraft = useCallback(
    (md?: string) => {
      const value = md ?? mdRef.current
      const at = Date.now()
      const next = docsRef.current.map((d) =>
        d.id === currentIdRef.current ? { ...d, title: titleRef.current, md: value, at } : d,
      )
      const bytes = storeBytes({ docs: next, currentId: currentIdRef.current })
      if (!writeStore(next, currentIdRef.current)) {
        // 只弹一次，之后靠状态栏的常驻提醒（否则每打几个字就弹一次，没法用）
        if (!saveFailedRef.current) {
          saveFailedRef.current = true
          setSaveFailed(true)
          const tooBig = bytes > 4.5 * 1024 * 1024
          window.alert(
            tooBig
              ? '保存失败：浏览器存储写不进去了（可能是磁盘空间不够，或者浏览器被设成不保存数据）。建议先「保存 .md」把这篇导出，再删掉一些大图片。'
              : '保存失败：浏览器存储不可用（可能是隐私模式或存储被禁用）。建议用「保存 .md」保存到文件。',
          )
        }
        return
      }
      if (saveFailedRef.current) {
        saveFailedRef.current = false
        setSaveFailed(false)
      }
      setSavedAt(at)
    },
    [writeStore],
  )

  const scheduleSave = useCallback(() => {
    if (saveTimer.current !== null) window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => persistDraft(), SAVE_DELAY_MS)
  }, [persistDraft])

  /* ---------- 文档体检：图片打不开 / 公式渲染不出来 ---------- */
  const flash = useCallback((text: string) => {
    setFixNote(text)
    if (fixNoteTimer.current !== null) window.clearTimeout(fixNoteTimer.current)
    fixNoteTimer.current = window.setTimeout(() => setFixNote(null), 9000)
  }, [])

  const scanIssues = useCallback(() => {
    const ed = editorRef.current
    if (!ed || ed.isDestroyed) return
    setIssues({
      images: actions.collectBrokenImages(ed).length,
      math: actions.countBrokenMath(ed),
      raw: actions.countRawMath(ed),
    })
  }, [])

  /** 「更多 → 检查图片与公式」：重新体检一次并把提示条显示出来 */
  const checkDocument = useCallback(() => {
    const ed = editorRef.current
    if (!ed) return
    const images = actions.collectBrokenImages(ed).length
    const math = actions.countBrokenMath(ed)
    const raw = actions.countRawMath(ed)
    setIssues({ images, math, raw })
    setIssuesHidden(false)
    if (!images && !math && !raw) flash('检查完了：这篇文档里的图片和公式都正常 ✅')
  }, [flash])

  /** 选导出文件夹（或直接选图片）把打不开的图片嵌进文档 */
  const repairImages = useCallback(
    (fromFolder: boolean, done?: () => void) => {
      actions.pickFiles({ accept: 'image/*', multiple: true, directory: fromFolder }, async (files) => {
        const ed = editorRef.current
        if (!ed) {
          done?.()
          return
        }
        // 这段是异步的（要读文件、压缩），出错不能让界面停在"什么也没发生"
        let r: Awaited<ReturnType<typeof actions.embedImages>>
        try {
          r = await actions.embedImages(ed, files)
        } catch (e) {
          flash('图片没能读进来：' + String(e).slice(0, 80))
          done?.()
          return
        }
        const left = actions.collectBrokenImages(ed).length
        setIssues((v) => ({ ...v, images: left }))
        if (r.fixed) {
          scheduleSave()
          flash(
            `已把 ${r.fixed} 张图片嵌进文档 ✅` +
              (left ? `，还有 ${left} 张没找到（${r.missing.slice(0, 3).join('、')}）` : ''),
          )
        } else if (r.missing.length) {
          flash('选中的文件里没找到这些图片。试试点「选导出文件夹」，选那个装着 assets 文件夹的目录')
        } else {
          flash('这篇文档里没有需要修复的图片')
        }
        // 修完（或没修成）都通知一声：知乎面板要重新体检，才知道现在能不能传
        done?.()
      })
    },
    [flash, scheduleSave],
  )

  /** 把写法坏了的公式一次性修好 */
  const fixMath = useCallback(() => {
    const ed = editorRef.current
    if (!ed) return
    const fixed = actions.repairAllMath(ed)
    scanIssues()
    if (fixed) {
      scheduleSave()
      flash(`已修好 ${fixed} 个公式的写法问题 ✅`)
    } else {
      flash('这些公式的写法自动修不了，点一下红框里的公式可以手动改')
    }
  }, [flash, scanIssues, scheduleSave])

  /** 把正文里"还是原文的 $…$"换成真正的公式（粘贴网页内容后常见） */
  const fixRawMath = useCallback(() => {
    const ed = editorRef.current
    if (!ed) return
    const fixed = actions.convertRawMath(ed)
    scanIssues()
    if (fixed) {
      scheduleSave()
      flash(`已把 ${fixed} 处原文公式变成真正的公式 ✅`)
    } else {
      flash('没找到还能转换的原文公式')
    }
  }, [flash, scanIssues, scheduleSave])

  /** 切换文档：先把当前这篇存下来，再载入目标 */
  const switchDoc = useCallback(
    (id: string) => {
      if (id === currentIdRef.current) return
      const ed = editorRef.current
      const currentMd = ed ? actions.getMarkdown(ed) : mdRef.current
      const at = Date.now()
      const nextDocs = docsRef.current.map((d) =>
        d.id === currentIdRef.current ? { ...d, title: titleRef.current, md: currentMd, at } : d,
      )
      const target = nextDocs.find((d) => d.id === id)
      if (!target) return
      if (!writeStore(nextDocs, id)) {
        window.alert('切换失败：文档太大存不下（试试少放几张图片）')
        return
      }
      titleRef.current = target.title
      setTitle(target.title)
      mdRef.current = target.md
      setSavedAt(target.at)
      if (ed) {
        actions.setMarkdown(ed, target.md)
        scanIssues()
      }
    },
    [scanIssues, writeStore],
  )

  /** 新建一篇空文档并切过去（示例内容只留给第一次打开时的第一篇） */
  const createDocument = useCallback(() => {
    const ed = editorRef.current
    const currentMd = ed ? actions.getMarkdown(ed) : mdRef.current
    const at = Date.now()
    const saved = docsRef.current.map((d) =>
      d.id === currentIdRef.current ? { ...d, title: titleRef.current, md: currentMd, at } : d,
    )
    const fresh = createDoc('', '')
    if (!writeStore([fresh, ...saved], fresh.id)) {
      window.alert('新建失败：文档太大存不下（试试少放几张图片）')
      return
    }
    titleRef.current = ''
    setTitle('')
    mdRef.current = ''
    setSavedAt(fresh.at)
    if (ed) {
      actions.setMarkdown(ed, '')
      scanIssues()
    }
    requestAnimationFrame(() => editorRef.current?.commands.focus('start'))
  }, [scanIssues, writeStore])

  /** 删除一篇文档；删掉的是当前这篇就切到第一篇 */
  const deleteDocument = useCallback(
    (id: string) => {
      const nextDocs = docsRef.current.filter((d) => d.id !== id)
      if (nextDocs.length === 0) return
      const nextId = id === currentIdRef.current ? nextDocs[0].id : currentIdRef.current
      // 先落盘、成功了再改界面与 ref：否则写入失败时界面已经切走、
      // 而 currentIdRef 还指着被删的那篇，下一次自动保存会把内容写进"已删除"的文档
      if (!writeStore(nextDocs, nextId)) {
        window.alert('删除失败：写入存储出错')
        return
      }
      if (id === currentIdRef.current) {
        const target = nextDocs[0]
        titleRef.current = target.title
        setTitle(target.title)
        mdRef.current = target.md
        setSavedAt(target.at)
        const ed = editorRef.current
        if (ed) {
          actions.setMarkdown(ed, target.md)
          scanIssues()
        }
      }
    },
    [scanIssues, writeStore],
  )

  const refreshDerived = useCallback((ed: Editor) => {
    const storage = ed.storage as unknown as { characterCount?: { characters: () => number } }
    setWordCount(storage.characterCount?.characters?.() ?? 0)
    setOutline(actions.getOutline(ed))
  }, [])

  /* ---------- 启动器带过来的助手配置（#zhihu-token=…&zhihu-addr=…） ----------
     「开始使用.bat」启动助手之后，会把令牌通过地址栏 hash 带进来（hash 不会发给任何服务器），
     这里存成面板用的那份配置，然后**立刻把 hash 抹掉** —— 免得令牌留在地址栏和浏览历史里。
     这样用户一次都不用粘贴令牌。
     注意：如果编辑器已经开着，再点一次启动器只是"同页跳 hash"，React 不会重挂载，
     所以除了首次渲染，还要监听 hashchange。 */
  const applyLaunchConfig = useCallback(() => {
    const hash = window.location.hash
    if (!hash || (!hash.includes('zhihu-token') && !hash.includes('zhihu-addr'))) return
    const params = new URLSearchParams(hash.replace(/^#/, ''))
    const token = params.get('zhihu-token')
    const addr = params.get('zhihu-addr')
    try {
      if (token) localStorage.setItem('md-editor-zhihu-v1', token)
      if (addr) localStorage.setItem('md-editor-zhihu-addr-v1', addr)
    } catch {
      /* 隐私模式存不下：这次仍可用（面板里会读到内存里的旧值） */
    }
    try {
      history.replaceState(null, '', window.location.pathname + window.location.search)
    } catch {
      /* 抹不掉也无所谓 */
    }
    flash('助手已经帮你连上了（令牌自动填好，不用手粘）')
  }, [flash])

  useEffect(() => {
    applyLaunchConfig()
    window.addEventListener('hashchange', applyLaunchConfig)
    return () => window.removeEventListener('hashchange', applyLaunchConfig)
  }, [applyLaunchConfig])

  /* ---------- 内核 ---------- */
  const editor = useMarkdownEditor({
    initialMarkdown: mdRef.current,    markdownInput,
    onReady: (ed) => {
      editorRef.current = ed
      ;(window as unknown as { __EDITOR__: Editor }).__EDITOR__ = ed
      // 供调试与测试脚本使用：取"应用真正会保存的那份 Markdown"
      // （底层 storage.markdown.getMarkdown() 拿到的还是内部标记，测试里别用它）
      ;(window as unknown as { __MD__: () => string }).__MD__ = () => actions.getMarkdown(ed)
      refreshDerived(ed)
      // 打开时先救一遍"还是原文的公式"：旧文档里粘坏的公式（字面 $…$ ）存盘时
      // 被转义过，重开就会停在正文里 —— 这里自动转回真公式，用户不用管
      window.setTimeout(() => {
        const ed2 = editorRef.current
        if (ed2 && !ed2.isDestroyed) {
          const fixed = actions.convertRawMath(ed2)
          if (fixed) {
            scheduleSave()
            flash(`打开时自动修好了 ${fixed} 处公式原文 ✅`)
          }
        }
        scanIssues()
      }, 0)
    },
    onUpdate: (markdown) => {
      mdRef.current = markdown
      const ed = editorRef.current
      if (ed) refreshDerived(ed)
      scheduleSave()
    },
  })

  useEffect(() => {
    if (editor) editorRef.current = editor
  }, [editor])

  /* 深色下把"太暗的文字颜色"显示成近白色（文档里的行内 color 一个字不动，见 readableColors.ts） */
  useDimColorFix(theme, editor)

  /* ---------- 选中状态：决定「文字颜色」能不能用 ---------- */
  useEffect(() => {
    if (!editor) return
    const update = () => setHasSelection(!editor.state.selection.empty)
    update()
    editor.on('selectionUpdate', update)
    editor.on('transaction', update)
    return () => {
      editor.off('selectionUpdate', update)
      editor.off('transaction', update)
    }
  }, [editor])

  /** 给选中文字上色；没选中就返回 false（面板会提示先选中） */
  const applyTextColor = useCallback(
    (color: string) => {
      const ed = editorRef.current
      if (!ed || ed.state.selection.empty) return false
      ed.chain().focus().setTextColor(color).run()
      scheduleSave()
      return true
    },
    [scheduleSave],
  )

  const clearTextColor = useCallback(() => {
    const ed = editorRef.current
    if (!ed || ed.state.selection.empty) return false
    ed.chain().focus().unsetTextColor().run()
    scheduleSave()
    return true
  }, [scheduleSave])

  /* ---------- 公式节点被点击 → 打开弹窗编辑 ---------- */
  useEffect(() => {
    setMathEditHandler((req) => {
      setMathSeed({ latex: req.latex, display: req.display, pos: req.pos })
      setMathOpen(true)
    })
    return () => setMathEditHandler(null)
  }, [])

  useEffect(() => {
    const flush = () => {
      if (saveTimer.current !== null) window.clearTimeout(saveTimer.current)
      const ed = editorRef.current
      persistDraft(ed ? actions.getMarkdown(ed) : mdRef.current)
    }
    window.addEventListener('beforeunload', flush)
    return () => {
      window.removeEventListener('beforeunload', flush)
      if (saveTimer.current !== null) window.clearTimeout(saveTimer.current)
    }
  }, [persistDraft])

  useEffect(() => {
    if (!editor) return
    refreshDerived(editor)
  }, [editor, refreshDerived])

  // 打开大纲时按当前文档重新生成，避免用到上一次编辑缓存的旧列表
  useEffect(() => {
    if (!outlineOpen) return
    const instance = editorRef.current
    if (instance) setOutline(actions.getOutline(instance))
  }, [outlineOpen, editor])

  const currentMarkdown = useCallback(() => {
    const ed = editorRef.current
    return ed ? actions.getMarkdown(ed) : mdRef.current
  }, [])

  /* ---------- 文件操作 ---------- */
  const openMarkdownFile = useCallback(() => {
    actions.pickFile('.md,.markdown,.txt,text/markdown,text/plain', async (file) => {
      // 防止把图片/压缩包当文本读进来（会把整篇文档变成乱码）
      const looksText = /\.(md|markdown|txt)$/i.test(file.name) || file.type.startsWith('text/')
      if (!looksText) {
        window.alert('这个文件不是 Markdown 文本，请选择 .md 文件')
        return
      }
      let text: string
      try {
        text = await actions.readFileAsText(file)
      } catch (e) {
        window.alert('这个文件读不出来：' + String(e).slice(0, 80))
        return
      }
      if (text.includes('\u0000')) {
        window.alert('这个文件不是纯文本（可能是图片或压缩包），请选择 .md 文件')
        return
      }
      // 打开的文件作为一篇新文档加进来（不覆盖正在写的那篇）
      const ed = editorRef.current
      const currentMd = ed ? actions.getMarkdown(ed) : mdRef.current
      const at = Date.now()
      const saved = docsRef.current.map((d) =>
        d.id === currentIdRef.current ? { ...d, title: titleRef.current, md: currentMd, at } : d,
      )
      const name = file.name.replace(/\.(md|markdown|txt)$/i, '')
      const imported = { ...createDoc(name, text), md: text }
      if (!writeStore([imported, ...saved], imported.id)) {
        window.alert('打开失败：文档太大存不下（试试少放几张图片）')
        return
      }
      titleRef.current = name
      setTitle(name)
      mdRef.current = text
      setSavedAt(imported.at)
      if (ed) {
        const { fixedMath } = actions.setMarkdown(ed, text)
        scanIssues()
        scheduleSave()
        if (fixedMath) flash(`导入时自动修好了 ${fixedMath} 个公式的写法问题`)
      }
    })
  }, [flash, scanIssues, scheduleSave, writeStore])

  /** 纯 .md 存档（备份 / 用别的软件读）。
   *  注意：图片是内嵌的，**拿去知乎导入会丢图** —— 它在「保存」菜单的最后一项，
   *  标签和说明里都写着"别拿去知乎导入"；每次存完再提醒一句，免得又选错。 */
  const saveMarkdownFile = useCallback(() => {
    const md = currentMarkdown()
    const name = (titleRef.current.trim() || '文档') + '.md'
    actions.downloadText(name, md, 'text/markdown;charset=utf-8')
    persistDraft(md)
    flash(`已存一份「${name}」（图片内嵌，自己看 / 备份用）。要发知乎请用「保存 → 导出知乎用 .md」。`)
  }, [currentMarkdown, flash, persistDraft])

  const exportHtmlFile = useCallback(() => {
    const ed = editorRef.current
    if (!ed) return
    const name = (titleRef.current.trim() || '文档') + '.html'
    actions.downloadText(
      name,
      actions.buildStandaloneHtml(titleRef.current, actions.buildExportBody(ed), typography),
      'text/html;charset=utf-8',
    )
  }, [typography])

  /** 「保存」按钮（工具栏和右下角那个都是它）点开选格式后走这里
   *  三种"图片一定显示得出来"的格式 + 一份纯 .md 备份（知乎用 .md / 网页 / PDF / 纯 .md） */
  const saveAs = useCallback(
    async (format: SaveFormat) => {
      const ed = editorRef.current
      if (!ed) return
      if (format === 'html') {
        exportHtmlFile()
        return
      }
      if (format === 'pdf') {
        window.print()
        return
      }
      if (format === 'plain') {
        saveMarkdownFile()
        return
      }
      // 知乎用 .md：可能要先上传图片，过程中给提示；拿不到网址时它自己会拦住并说明怎么办
      flash('正在准备给知乎的 .md（图片会自动上传换网址）…')
      try {
        const out = await exportZhihuMarkdown(ed, titleRef.current, { onPhase: (t) => t && flash(t) })
        flash(out.text)
        if (out.ok) scheduleSave()
      } catch (e) {
        flash('导出出错：' + String(e).slice(0, 120))
      }
    },
    [exportHtmlFile, flash, saveMarkdownFile, scheduleSave],
  )

  /* ---------- 视图：Markdown 输入开关（开=语法自动转换，关=原样输入） ---------- */
  const toggleMarkdownInput = useCallback(() => {
    // 先把当前内容落到 mdRef，编辑器重建时用它续上
    const ed = editorRef.current
    if (ed) mdRef.current = actions.getMarkdown(ed)
    setMarkdownInput((v) => !v)
  }, [])

  const api: EditorApi = useMemo(() => {
    const ed = () => editorRef.current
    const live = (): Editor | null => {
      const instance = editorRef.current
      return instance && !instance.isDestroyed ? instance : null
    }
    const run = (fn: (e: Editor) => void) => () => {
      const instance = live()
      if (instance) fn(instance)
    }
    return {
      editor: editorRef.current,
      /** 工具栏按钮点完把焦点交还编辑器（必须取当前实例，不能用快照） */
      focus: () => live()?.commands.focus(),
      undo: run(actions.undo),
      redo: run(actions.redo),
      clearFormat: run(actions.clearFormat),
      toggleBold: run(actions.toggleBold),
      toggleItalic: run(actions.toggleItalic),
      setHeading: (level) => run((e) => actions.setHeading(e, level))(),
      setParagraph: run(actions.setParagraph),
      toggleList: run(actions.toggleList),
      toggleOrderedList: run(actions.toggleOrderedList),
      toggleQuote: run(actions.toggleQuote),
      insertHr: run(actions.insertHr),
      toggleCodeBlock: run(actions.toggleCodeBlock),
      pickImage: () => {
        actions.pickFile('image/*', async (file) => {
          const instance = ed()
          if (!instance) return
          if (file.size > actions.MAX_IMAGE_FILE) {
            window.alert('图片超过 12MB，先压缩一下再插入吧')
            return
          }
          try {
            const url = await actions.prepareImageDataUrl(file)
            actions.insertImage(instance, url, file.name)
          } catch (e) {
            // 读不出来要说一声，别让用户以为"点了没反应"
            window.alert('这张图片没能读进来：' + String(e).slice(0, 80))
          }
        })
      },
      openVideo: () => setVideoOpen(true),
      insertVideo: (url) => {
        const instance = ed()
        if (!instance) return false
        return actions.insertVideo(instance, url)
      },
      openLink: () => setLinkOpen(true),
      insertLink: (text, url) => run((e) => actions.insertLink(e, text, url))(),
      openMath: () => {
        setMathSeed({ latex: '', display: false, pos: null })
        setMathOpen(true)
      },
      openTable: () => setTableOpen(true),
      insertTable: (rows, cols) => run((e) => actions.insertTable(e, rows, cols))(),
      openMarkdownFile,
      saveMarkdownFile,
      exportHtmlFile,
      exportPdf: () => actions.printDocument(),
      toggleMarkdownInput,
      toggleOutline: () => setOutlineOpen((v) => !v),
      toggleFullscreen: () => actions.toggleFullscreen(),
      theme,
      setTheme,
      resetCurrentDoc: () => {
        // 会连着标题一起覆盖，必须先问一句（正文能撤销，标题撤不回来）
        if (!window.confirm('把当前文档的正文和标题都换回示例内容？这一步不方便撤销。')) return
        const instance = ed()
        if (instance) actions.setMarkdown(instance, DEMO_MD)
        mdRef.current = DEMO_MD
        titleRef.current = ''
        setTitle('')
        persistDraft(DEMO_MD)
      },
      getMarkdown: currentMarkdown,
    }
  }, [
    currentMarkdown,
    exportHtmlFile,
    editor,
    openMarkdownFile,
    persistDraft,
    saveMarkdownFile,
    // theme 必须在这里：菜单里的对号靠 api.theme 判断，
    // 漏了它就会出现"切到深色、勾还留在浅色/跟随系统"（实测踩过）
    theme,
    toggleMarkdownInput,
  ])

  /* ---------- 快捷键：动作注册 + 全局拦截 ----------
     统一在 window 捕获阶段处理，这样焦点在标题、工具栏里也生效；
     同时能"吞掉"被改掉的 TipTap 内置键位（否则改了键旧键还会触发）。 */
  useEffect(() => {
    shortcuts.applyBindings(loadBindings())
  }, [])

  useEffect(() => {
    shortcuts.setHandlers({
      undo: () => api.undo(),
      redo: () => api.redo(),
      bold: () => api.toggleBold(),
      italic: () => api.toggleItalic(),
      clearFormat: () => api.clearFormat(),
      h1: () => api.setHeading(1),
      h2: () => api.setHeading(2),
      h3: () => api.setHeading(3),
      paragraph: () => api.setParagraph(),
      bulletList: () => api.toggleList(),
      orderedList: () => api.toggleOrderedList(),
      quote: () => api.toggleQuote(),
      codeBlock: () => api.toggleCodeBlock(),
      hr: () => api.insertHr(),
      formula: () => api.openMath(),
      table: () => api.openTable(),
      link: () => api.openLink(),
      image: () => api.pickImage(),
      video: () => api.openVideo(),
      save: () => api.saveMarkdownFile(),
      open: () => api.openMarkdownFile(),
      exportPdf: () => api.exportPdf(),
      exportHtml: () => api.exportHtmlFile(),
      newDoc: () => createDocument(),
      docs: () => setDocsOpen(true),
      markdownInput: () => api.toggleMarkdownInput(),
      outline: () => api.toggleOutline(),
      fullscreen: () => api.toggleFullscreen(),
      shortcuts: () => setShortcutsOpen(true),
    })
  })

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // 设置面板自己在录制；其它弹窗开着时也不抢键
      if (shortcutsOpen) return
      if (document.querySelector('.zh-modal-mask')) return
      const key = normalizeEvent(e)
      if (!key) return

      const id = shortcuts.match(key)
      if (id) {
        const action = SHORTCUT_ACTIONS.find((a) => a.id === id)
        const target = e.target as HTMLElement | null
        const inPlainInput =
          !!target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')
        // 在标题框里按 Ctrl+B 不该去加粗正文
        if (action?.group === '编辑' && inPlainInput) return
        e.preventDefault()
        e.stopPropagation()
        shortcuts.run(id)
        return
      }

      // 已被改掉的旧默认键：吞掉，避免 TipTap 内置键位照旧触发
      if (shortcuts.isStaleDefault(key)) {
        e.preventDefault()
        e.stopPropagation()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [shortcutsOpen])

  const handlers: ToolbarHandlers = useMemo(
    () => ({
      openFormula: () => {
        setMathSeed({ latex: '', display: false, pos: null })
        setMathOpen(true)
      },
      openTable: () => setTableOpen(true),
      openLink: () => setLinkOpen(true),
      openVideo: () => setVideoOpen(true),
      openHelp: () => setHelpOpen(true),
      openShortcuts: () => setShortcutsOpen(true),
      openZhihu: () => setZhihuOpen(true),
      pickImage: () => api.pickImage(),
      checkDocument,
    }),
    [api, checkDocument],
  )

  const confirmMath = useCallback(
    (latex: string, display: boolean) => {
      const ed = editorRef.current
      if (!ed) return
      if (mathSeed.pos !== null) actions.updateMathAt(ed, mathSeed.pos, latex)
      else if (display) actions.insertMathBlock(ed, latex)
      else actions.insertMathInline(ed, latex)
      scheduleSave()
    },
    [mathSeed.pos, scheduleSave],
  )

  return (
    <div className="editor-page">
      <Toolbar
        api={api}
        handlers={handlers}
        extraLeading={
          <DocMenu
            docs={docs}
            currentId={currentId}
            open={docsOpen}
            onOpenChange={setDocsOpen}
            onSwitch={switchDoc}
            onCreate={createDocument}
            onDelete={deleteDocument}
          />
        }
        typographyMenu={
          <TypographyMenu
            open={typographyOpen}
            onOpenChange={setTypographyOpen}
            typography={typography}
            onChange={setTypography}
            onColor={applyTextColor}
            onClearColor={clearTextColor}
            hasSelection={hasSelection}
            customFonts={customFonts}
            onCustomFontsChange={setCustomFonts}
          />
        }
        saveMenu={<SaveMenu onPick={saveAs} />}
      />

      {/* 文档体检提示条：图片打不开 / 公式渲染不出来时自己浮出来 */}
      {fixNote ? (
        <div className="zh-fixbar zh-fixbar--ok">
          <span className="zh-fixbar__text">{fixNote}</span>
          <span className="zh-fixbar__spacer" />
          <button type="button" className="zh-fixbar__close" title="知道了" onClick={() => setFixNote(null)}>
            ✕
          </button>
        </div>
      ) : (
        (issues.images > 0 || issues.math > 0 || issues.raw > 0) &&
        !issuesHidden && (
          <div className="zh-fixbar">
            {issues.images > 0 && (
              <>
                <span className="zh-fixbar__text">
                  🖼 有 <b>{issues.images}</b> 张图片打不开：源文件里写的是 assets/… 这种相对路径，
                  而单独打开的网页读不到旁边的文件夹
                </span>
                <button
                  type="button"
                  className="zh-pill zh-pill--primary"
                  title="修复图片：选导出文件夹"
                  onClick={() => repairImages(true)}
                >
                  选导出文件夹修复
                </button>
                <button
                  type="button"
                  className="zh-pill"
                  title="修复图片：手动选图片"
                  onClick={() => repairImages(false)}
                >
                  手动选图片
                </button>
              </>
            )}
            {issues.math > 0 && (
              <>
                <span className="zh-fixbar__text">
                  ✏️ 有 <b>{issues.math}</b> 个公式没能渲染出来（源文件里的写法有问题）
                </span>
                <button type="button" className="zh-pill" title="一键修复公式" onClick={fixMath}>
                  一键修复公式
                </button>
              </>
            )}
            {issues.raw > 0 && (
              <>
                <span className="zh-fixbar__text">
                  📄 有 <b>{issues.raw}</b> 处公式还是原文（粘贴进来的 `$…$` 没被识别成公式）
                </span>
                <button type="button" className="zh-pill zh-pill--primary" title="把原文公式转成公式" onClick={fixRawMath}>
                  转成公式
                </button>
              </>
            )}
            <span className="zh-fixbar__spacer" />
            <button
              type="button"
              className="zh-fixbar__close"
              title="先不管"
              onClick={() => setIssuesHidden(true)}
            >
              ✕
            </button>
          </div>
        )
      )}

      <div className="editor-shell">
        <div className="editor-card">          <input
            className="zh-title"
            value={title}
            maxLength={100}
            placeholder="请输入标题（最多 100 个字）"
            onChange={(e) => {
              titleRef.current = e.target.value
              setTitle(e.target.value)
              scheduleSave()
            }}
          />
          <div className="zh-editor-body">
            <EditorContent editor={editor} />
          </div>
        </div>

        {/* 光标进表格时，表格上方浮出加行 / 加列 / 删除等操作 */}
        <TableMenu editor={editor} />

        {outlineOpen && (
          <aside className="zh-outline">
            <div className="zh-outline__head">
              <span>大纲</span>
              <button type="button" className="zh-outline__close" onClick={() => setOutlineOpen(false)}>
                ✕
              </button>
            </div>
            {outline.length === 0 ? (
              <div className="zh-outline__empty">还没有标题</div>
            ) : (
              outline.map((item) => (
                <button
                  key={`${item.pos}-${item.text}`}
                  type="button"
                  className={`zh-outline__item zh-outline__item--h${item.level}`}
                  onClick={() => {
                    const ed = editorRef.current
                    if (ed) actions.gotoPos(ed, item.pos)
                  }}
                >
                  {item.text}
                </button>
              ))
            )}
          </aside>
        )}
      </div>

      <StatusBar
        wordCount={wordCount}
        markdownInput={markdownInput}
        savedAt={savedAt}
        outlineOpen={outlineOpen}
        saveFailed={saveFailed}
        onToggleMarkdownInput={toggleMarkdownInput}
        onExport={saveAs}
      />

      <MathModal
        open={mathOpen}
        initialLatex={mathSeed.latex}
        initialDisplay={mathSeed.display}
        onClose={() => setMathOpen(false)}
        onConfirm={confirmMath}
      />
      <TableModal
        open={tableOpen}
        onClose={() => setTableOpen(false)}
        onConfirm={(rows, cols) => api.insertTable(rows, cols)}
      />
      <LinkModal
        open={linkOpen}
        onClose={() => setLinkOpen(false)}
        onConfirm={(text, url) => api.insertLink(text, url)}
      />
      <VideoModal
        open={videoOpen}
        onClose={() => setVideoOpen(false)}
        onConfirm={(url) => {
          if (!api.insertVideo(url)) window.alert('这个视频链接暂时认不出来，支持 B 站或 YouTube 链接')
        }}
      />
      <HelpModal
        open={helpOpen}
        onClose={() => setHelpOpen(false)}
        onOpenShortcuts={() => {
          setHelpOpen(false)
          setShortcutsOpen(true)
        }}
      />
      <ShortcutModal open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
      <ZhihuModal
        open={zhihuOpen}
        editor={editor}
        title={title}
        onClose={() => setZhihuOpen(false)}
        onRepairImages={(done) => repairImages(true, done)}
      />
    </div>
  )
}
