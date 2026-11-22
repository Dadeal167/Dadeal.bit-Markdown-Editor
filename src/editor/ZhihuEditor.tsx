import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { EditorContent } from '@tiptap/react'
import type { Editor } from '@tiptap/core'
import Toolbar from './Toolbar'
import type { ToolbarHandlers } from './toolbar/toolbarItems'
import StatusBar from './StatusBar'
import MathModal from './MathModal'
import TableModal from './TableModal'
import TableMenu from './TableMenu'
import ImageMenu from './ImageMenu'
import LinkModal from './LinkModal'
import VideoModal from './VideoModal'
import HelpModal from './HelpModal'
import FeedbackModal from './FeedbackModal'
import SearchBox from './SearchBox'
import MarkdownSourceModal from './workspace/MarkdownSourceModal'
import PublicationLayoutModal from './publication/PublicationLayoutModal'
import EditionModal, { EditionBlockPicker, type EditionRequest } from './publication/EditionModal'
import { hasEditionBlocks } from './publication/editions'
import { insertEditionBlock } from './tiptap/EditionBlock'
import { readingModeKey } from './tiptap/ReadingMode'
import WorkspacePanel, { WorkspaceRenameModal } from './workspace/WorkspacePanel'
import DocumentAssetsModal from './workspace/DocumentAssetsModal'
import LocalVideoModal from './workspace/LocalVideoModal'
import { isLocalVideoLink, resolveProjectAsset, type AssetScope } from './workspace/documentAssets'
import { useDocumentWorkspace } from './workspace/useDocumentWorkspace'
import type { WorkspaceSearchResult } from './workspace/workspaceSearch'
import { findMatches, scrollToMatch } from './search'
import { commitWorkspaceRename, headingMatches, normalizeWorkspacePath, renamedWorkspaceLinks, resolveWikiPath,
  workspaceBacklinks, workspaceHeadings, type WorkspaceFile, type WorkspaceRename } from './workspace/documentWorkspace'
import { parseWikiLink, wikiLinkEvent } from './tiptap/WikiLink'
import { packMarkdownAssets, storeClipboardAsset } from './markdownAssets'
import { loadPublicationLayout, printPublicationCss, savePublicationLayout } from './publication/publicationLayout'
import { renderSourcePreview, reviewSource } from './workspace/sourceReview'
import EquationToolsModal from './EquationToolsModal'
import ChapterOutline, { PrintContents } from './ChapterOutline'
import ObjectToolsModal from './ObjectToolsModal'
import ScholarTools, { type ScholarTab } from './ScholarTools'
import VersionCompareModal, { type VersionComparison } from './workspace/VersionCompareModal'
import type { VersionChange } from './workspace/versionChanges'
import { ScholarBibliography } from './tiptap/ScholarNodes'
import ExportPreflightModal from './publication/ExportPreflightModal'
import { checkExport, type ExportReview, type ExportTarget } from './publication/exportPreflight'
import { gotoDocumentNode } from './tiptap/objectReferences'
import { equationNumberingKey, gotoEquation, insertEquationReference } from './math/equationIndex'
import { documentMacros, MACRO_LANGUAGE } from './math/documentMacros'
import { diagramsIn, exportDiagrams, loadDiagram, MERMAID_LANGUAGE, MERMAID_SAMPLE } from './mermaidDiagrams'
import { writingFocusKey } from './tiptap/WritingFocus'
import { sessionMs, sessionStartedAt, totalUsageMs } from './usageTime'
import type { EditorApi, OutlineItem } from './types'
import * as actions from './editorActions'
import SaveMenu from './publication/SaveMenu'
import type { SaveFormat } from './publication/saveOptions'
import { loadLocalMarkdownFiles, storeLocalMarkdownFile } from './docStore'
import {
  localFileMatches, localFilePickers, markdownHash, markdownTypes, projectImportedImages, readLocalMarkdown, serializeLocalMarkdown,
  writeLocalMarkdown, type LocalDirectoryHandle, type LocalFileHandle, type LocalMarkdownFile,
} from './localMarkdownFile'
import { exportZhihuMarkdown } from './saveFormats'
import { setMathEditHandler } from './mathEvents'
import { useMarkdownEditor } from './useMarkdownEditor'
import DocMenu from './DocMenu'
import { mergeDocumentBackup, parseDocumentBackup, serializeDocumentBackup } from './workspace/documentBackup'
import ShortcutModal from './ShortcutModal'
import TypographyMenu from './TypographyMenu'
import ZhihuModal from './ZhihuModal'
import CircleEntry, { circlePassSaved } from '../online/CircleEntry'
import { applyTypography, loadTypography, saveTypography, type Typography } from './typography'
import {
  applyPageBackground,
  loadPageBackground,
  pageBackgroundCss,
  savePageBackground,
  type PageBackground,
} from './pageBackground'
import { applyTheme, loadTheme, saveTheme, watchSystemTheme, type Theme } from './theme'
import EffectPanel from './EffectPanel'
import {
  loadMouseEffectSettings,
  resetMouseEffectSettings,
  saveMouseEffectSettings,
  type MouseEffectSettings,
} from './effects/mouseEffect'
import { stripLeakedMarks } from './tiptap/mathMarkdown'
import { useDimColorFix } from './useDimColorFix'
import { fontEmbedCss, formatSize, loadCustomFonts, type CustomFont } from './customFonts'
import { SHORTCUT_ACTIONS, TOOLBAR_ORB_REVEAL_EVENT, TOOLBAR_TOOLS_EVENT, loadBindings, normalizeEvent, shortcuts } from './shortcuts'
import { buildFormulaDiag, downloadFormulaDiag, withDiag } from './mathDiagnostics'
import type { Doc, DocVersion } from './documents'
import {
  DEMO_MD,
  createDoc,
  captureDocVersion,
  isDocStoreLoading,
  loadStore,
  onStoreReloaded,
  onStoreWriteFailed,
  onStoreWriteOk,
  saveStore,
  storeBytes,
} from './documents'

const SAVE_DELAY_MS = 1200
const LOCAL_FILE_EDITING = __BUILD_MODE__ === 'effect'

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
  const bootDoc = boot.docs.find((d) => d.id === boot.currentId && !d.trashedAt) ?? boot.docs.find((d) => !d.trashedAt) ?? boot.docs[0]
  const titleRef = useRef(bootDoc.title)
  const mdRef = useRef(bootDoc.md)
  const [docs, setDocs] = useState<Doc[]>(boot.docs)
  const [currentId, setCurrentId] = useState(bootDoc.id)
  const [localFiles, setLocalFiles] = useState(() => new Map<string, LocalMarkdownFile>())
  const [localFilesReady, setLocalFilesReady] = useState(!LOCAL_FILE_EDITING)
  const [localConflict, setLocalConflict] = useState<string | null>(null)
  const [localConflictError, setLocalConflictError] = useState('')
  const [localOperation, setLocalOperation] = useState<string | null>(null)
  const [folderDocuments, setFolderDocuments] = useState<{ handle: LocalFileHandle; directory: FileSystemDirectoryHandle }[]>([])
  const localOperationRef = useRef<string | null>(null)
  const [diskStatus, setDiskStatus] = useState<{ id: string; file: LocalMarkdownFile; md: string; saved: boolean }>()
  const [markdownInput, setMarkdownInput] = useState(true)
  const [sourceEdit, setSourceEdit] = useState<{ id: string; initial: string } | null>(null)
  const [localVideo, setLocalVideo] = useState<{ id: string; path: string }>()
  const [assetDocumentId, setAssetDocumentId] = useState<string>()
  const [publication, setPublication] = useState(loadPublicationLayout)
  const [publicationOpen, setPublicationOpen] = useState(false)
  const [renameFile, setRenameFile] = useState<WorkspaceFile>()
  const [workspacePaths, setWorkspacePaths] = useState(() => new Map<string, string>())
  const workspaceNavigation = useRef(false)
  const [autoAssets, setAutoAssets] = useState(() => {
    try { return localStorage.getItem('dadealbit-auto-assets') !== 'off' } catch { return true }
  })
  const [writingFocus, setWritingFocus] = useState(false)
  const [equationToolsOpen, setEquationToolsOpen] = useState(false)
  const [objectToolsOpen, setObjectToolsOpen] = useState(false)
  const [scholarTab, setScholarTab] = useState<ScholarTab | null>(null)
  const [comparison, setComparison] = useState<VersionComparison | null>(null)
  const [compareFeedback, setCompareFeedback] = useState('')
  const [exportReview, setExportReview] = useState<(ExportReview & { resume?: 'docx' | 'pdf' | 'zhihu' }) | null>(null)
  const [editionRequest, setEditionRequest] = useState<EditionRequest | null>(null)
  const [editionBlockPicker, setEditionBlockPicker] = useState(false)
  const [reading, setReading] = useState(false)
  const exportingWord = useRef(false)

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
  /** 「更多 → 使用反馈」（会带上字数与使用时长，不带文档内容） */
  const [feedbackOpen, setFeedbackOpen] = useState(false)
  /** 搜索框（工具栏「搜索」或 Ctrl+F） */
  const [searchOpen, setSearchOpen] = useState(false)
  const [docsOpen, setDocsOpen] = useState(false)
  const [zhihuOpen, setZhihuOpen] = useState(false)
  const [zhihuUnlocked, setZhihuUnlocked] = useState(() => import.meta.env.MODE !== 'online' || circlePassSaved())
  const [typography, setTypography] = useState<Typography>(() => loadTypography())
  const [pageBackground, setPageBackground] = useState<PageBackground>(() => loadPageBackground())
  const [typographyOpen, setTypographyOpen] = useState(false)
  const [hasSelection, setHasSelection] = useState(false)
  const [saveFailed, setSaveFailed] = useState(false)
  const saveFailedRef = useRef(false)
  const [theme, setTheme] = useState<Theme>(() => loadTheme())
  const [effect, setEffect] = useState<MouseEffectSettings>(() => loadMouseEffectSettings())
  const [effectOpen, setEffectOpen] = useState(false)

  /* 鼠标点击特效：启动时按存下来的设置装上（默认「只显点击波纹」+ 淡蓝 + 80% 不透明度） */
  useEffect(() => {
    saveMouseEffectSettings(effect)
  }, [effect])
  const [customFonts, setCustomFonts] = useState<CustomFont[]>([])
  /**
   * 文档体检结果。
   *   math     —— 节点里**存着**坏写法的公式数（能自动修的也算进来，否则修复入口不出现）
   *   mathHard —— 自动修过之后仍然渲染不出来的（只能手动改）
   */
  const [issues, setIssues] = useState({ images: 0, math: 0, mathHard: 0, raw: 0 })
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
        '浏览器未能保存文档。请先导出 Markdown 存档，再检查浏览器存储权限和可用空间。',
      )
    })
    onStoreWriteOk(() => {
      if (!saveFailedRef.current) return
      saveFailedRef.current = false
      setSaveFailed(false)
    })
    return () => {
      onStoreWriteFailed(null)
      onStoreWriteOk(null)
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

  /* ---------- 纸张背景色（作用于整篇，和主题是两件事） ---------- */
  useEffect(() => {
    applyPageBackground(pageBackground)
    savePageBackground(pageBackground)
  }, [pageBackground])

  /* ---------- 文档存取 ----------
     注意：onUpdate 是编辑器创建时捕获的闭包，它调用的保存函数必须只依赖 ref，
     否则会拿着过期的 docs/currentId 去写存储，把别的文档覆盖掉。 */
  const docsRef = useRef(docs)
  const currentIdRef = useRef(currentId)
  const localFile = localFiles.get(currentId)
  const storedMarkdown = docs.find((doc) => doc.id === currentId)?.md

  useEffect(() => {
    if (!LOCAL_FILE_EDITING) return
    let active = true
    void loadLocalMarkdownFiles().then((stored) => {
      if (active) setLocalFiles((current) => new Map([...stored, ...current]))
    }).catch(() => {}).finally(() => {
      if (active) setLocalFilesReady(true)
    })
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (!localFile || storedMarkdown === undefined) return
    let active = true
    void markdownHash(projectImportedImages(storedMarkdown, true)).then((hash) => {
      if (active) setDiskStatus({ id: currentId, file: localFile, md: storedMarkdown, saved: hash === localFile.editorHash })
    }).catch(() => {})
    return () => { active = false }
  }, [currentId, localFile, storedMarkdown])

  const writeStore = useCallback((nextDocs: Doc[], nextId: string, onSaved?: (ok: boolean) => void): boolean => {
    const ok = saveStore({ docs: nextDocs, currentId: nextId }, onSaved)
    if (!ok) return false
    docsRef.current = nextDocs
    currentIdRef.current = nextId
    setDocs(nextDocs)
    setCurrentId(nextId)
    return true
  }, [])

  const withCurrentContent = useCallback((md: string, at: number) => {
    const title = titleRef.current
    return docsRef.current.map((doc) => {
      if (doc.id !== currentIdRef.current || doc.trashedAt || (doc.title === title && doc.md === md)) return doc
      const saved = doc.versions?.[0]
      const history = (doc.title || doc.md) && (!saved || at - saved.at >= 5 * 60_000)
        ? captureDocVersion(doc, doc.at) : doc
      return { ...history, title, md, at }
    })
  }, [])

  /** 把当前编辑器内容写回当前文档并落盘 */
  const persistDraft = useCallback(
    (md?: string) => {
      /* 要落盘的内容一律**现取**，不用 mdRef 里那份可能是旧的：
         useMarkdownEditor 现在把"整篇序列化"攒到打字停下之后才做（那是打字卡顿的根源，
         见那边的实测数据），所以 mdRef 最多可能落后 300ms。定时自动保存（scheduleSave）
         走的就是不带参数的这条调用 —— 要是读 mdRef，用户打完最后一个字就关页/刷新，
         那一下就会丢内容。现取的代价只有一次序列化，而这里本来就是低频路径。 */
      const live = editorRef.current
      const source = md ?? (live && !live.isDestroyed ? actions.getMarkdown(live) : mdRef.current)
      /* 落盘守卫（纵深防御）：写进存储的内容绝不允许带内部标记字符 ——
         真出过一次事故（onUpdate 交来未收尾的序列化结果，崩溃后重开正文全是 □）。
         源头已修（useMarkdownEditor.onUpdate 现在交收尾版），这里是最后一道闸：
         正常内容第一行就原样返回，不花钱。 */
      const value = stripLeakedMarks(source, '自动保存')
      const at = Date.now()
      const next = withCurrentContent(value, at)
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
    [withCurrentContent, writeStore],
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

  const snapshotDocuments = useCallback(() => {
    if (isDocStoreLoading()) throw new Error('文档库仍在加载，请稍后重试。')
    const ed = editorRef.current
    const md = ed?.isInitialized && !ed.isDestroyed ? actions.getMarkdown(ed) : mdRef.current
    return withCurrentContent(md, Date.now())
  }, [withCurrentContent])

  const backupDocuments = useCallback(() => {
    const docs = snapshotDocuments()
    const now = new Date()
    const day = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10)
    actions.downloadText('Dadealbit-文档备份-' + day + '.json', serializeDocumentBackup(docs), 'application/json;charset=utf-8')
    return '已导出 ' + docs.length + ' 篇文档，包含历史版本和回收站。'
  }, [snapshotDocuments])

  const restoreDocuments = useCallback(async (file: File) => {
    const incoming = parseDocumentBackup(await file.text())
    if (!incoming.length) return '备份文件不包含文档。'
    const snapshot = snapshotDocuments()
    const { added, updated, skipped } = mergeDocumentBackup(snapshot, incoming)
    // 重试时也排一次保存，让存储层重试上次未能写入的文档。
    const saved = await new Promise<boolean>((resolve) => {
      writeStore([...added, ...snapshot.map((doc) => updated.get(doc.id) ?? doc)], currentIdRef.current, resolve)
    })
    if (!saved) throw new Error('备份未能保存到浏览器。请保留原文件，稍后重试。')
    const results = []
    if (added.length) results.push('已恢复 ' + added.length + ' 篇')
    if (updated.size) results.push('已合并 ' + updated.size + ' 篇文档的版本历史')
    if (!results.length) return '备份中的文档已存在。'
    if (skipped) results.push('跳过 ' + skipped + ' 篇相同文档')
    return results.join('，') + '。'
  }, [snapshotDocuments, writeStore])

  const scanIssues = useCallback(() => {
    const ed = editorRef.current
    if (!ed || ed.isDestroyed) return
    const math = actions.scanMathIssues(ed)
    setIssues({
      images: actions.collectBrokenImages(ed).length,
      /* math = "需要修的"（存着就坏）；mathHard = "自动修不了的"（只能手动改） */
      math: math.stored,
      mathHard: math.unfixable,
      raw: actions.countRawMath(ed),
    })
  }, [])

  /**
   * 「更多 → 检查图片与公式」会修公式，并提示需要找回的图片。
   *
   * 名字里有"就修"，那就**真的修** —— 以前这一步只 count 不 repair，
   * 而 count 报的又是"修过之后还坏不坏"，于是永远显示 0、点了也什么都不变。
   * 现在：先把能自动修的修掉（并存盘），再报剩下真正修不了的。
   */
  const checkDocument = useCallback(() => {
    const ed = editorRef.current
    if (!ed) return
    /* 整段包进 withDiag：会记下"这次操作前后公式摘要"，用户下次说"点完就坏"就有据可查 */
    const { fixedMath, fixedRaw, images, math } = withDiag(ed, '检查图片与公式', () => {
      const fm = actions.repairAllMath(ed)
      const fr = actions.convertRawMath(ed)
      return {
        fixedMath: fm,
        fixedRaw: fr,
        images: actions.collectBrokenImages(ed).length,
        math: actions.scanMathIssues(ed),
      }
    })
    setIssues({ images, math: math.stored, mathHard: math.unfixable, raw: actions.countRawMath(ed) })
    setIssuesHidden(false)
    if (fixedMath || fixedRaw) scheduleSave()

    const parts: string[] = []
    if (fixedMath) parts.push(`已修复 ${fixedMath} 个公式`)
    if (fixedRaw) parts.push(`已将 ${fixedRaw} 处文本转换为公式`)
    if (math.unfixable) parts.push(`${math.unfixable} 个公式需要手动编辑`)
    if (images && !parts.length) {
      if (fixNoteTimer.current !== null) window.clearTimeout(fixNoteTimer.current)
      setFixNote(null)
    } else {
      if (images) parts.push(`${images} 张图片需要重新导入`)
      flash(parts.length ? parts.join('。') + '。' : '检查完成。未发现图片或公式问题。')
    }
  }, [flash, scheduleSave])

  /**
   * 「更多 → 导出公式诊断」：把出问题的现场存成文件，发给作者就能精确定位。
   *
   * 为什么要有这个入口：用户报过三次"公式坏了"，我每次都拿不到坏样本，
   * 只能靠推理 —— 而**没有数据的推理只会产出"合理的错误"**。
   */
  const exportMathDiag = useCallback(() => {
    const ed = editorRef.current
    const r = downloadFormulaDiag(ed)
    flash(
      `诊断已导出（${r.formulas} 个公式、${r.events} 条操作记录）—— 把下载到的 .json 发给作者即可 ✅`,
    )
  }, [flash])

  /** 选导出文件夹（或直接选图片）把打不开的图片嵌进文档 */
  const repairImages = useCallback(
    (fromFolder: boolean, done?: () => void) => {
      const id = currentIdRef.current
      actions.pickFiles({ accept: 'image/*', multiple: true, directory: fromFolder }, async (files) => {
        const ed = editorRef.current
        if (!ed || currentIdRef.current !== id) {
          done?.()
          return
        }
        // 这段是异步的（要读文件、压缩），出错不能让界面停在"什么也没发生"
        let r: Awaited<ReturnType<typeof actions.embedImages>>
        try {
          r = await actions.embedImages(ed, files, localFiles.has(id), () => currentIdRef.current === id)
        } catch (e) {
          flash('无法读取图片：' + String(e).slice(0, 80))
          done?.()
          return
        }
        if (currentIdRef.current !== id) return
        const left = actions.collectBrokenImages(ed).length
        setIssues((v) => ({ ...v, images: left }))
        if (r.fixed) {
          scheduleSave()
          flash(
            `已把 ${r.fixed} 张图片嵌进文档 ✅` +
              (left ? `，还有 ${left} 张没找到（${r.missing.slice(0, 3).join('、')}）` : ''),
          )
        } else if (r.missing.length) {
          flash('所选文件不包含待修复的图片。请选择包含 assets 的导出文件夹。')
        } else {
          flash('当前文档无待修复的图片。')
        }
        // 修完（或没修成）都通知一声：知乎面板要重新体检，才知道现在能不能传
        done?.()
      })
    },
    [flash, localFiles, scheduleSave],
  )

  /** 把写法坏了的公式一次性修好 */
  const fixMath = useCallback(() => {
    const ed = editorRef.current
    if (!ed) return
    /* withDiag：记下"修之前 / 修之后"的公式摘要 —— 万一修复反而改坏了，诊断包里看得见 */
    const { fixed, left } = withDiag(ed, '一键修复公式', () => {
      const f = actions.repairAllMath(ed)
      return { fixed: f, left: actions.scanMathIssues(ed) }
    })
    setIssues((v) => ({ ...v, math: left.stored, mathHard: left.unfixable }))
    if (fixed) {
      scheduleSave()
      flash(`已修复 ${fixed} 个公式。` + (left.unfixable ? `${left.unfixable} 个公式仍需手动编辑。` : ''))
    } else {
      flash('无法自动修复公式。请编辑标记的公式。')
    }
  }, [flash, scheduleSave])

  /** 把正文里"还是原文的 $…$"换成真正的公式（粘贴网页内容后常见） */
  const fixRawMath = useCallback(() => {
    const ed = editorRef.current
    if (!ed) return
    const fixed = actions.convertRawMath(ed)
    scanIssues()
    if (fixed) {
      scheduleSave()
      flash(`已将 ${fixed} 处文本转换为公式。`)
    } else {
      flash('未找到可转换的公式。')
    }
  }, [flash, scanIssues, scheduleSave])

  /** 切换文档：先把当前这篇存下来，再载入目标 */
  const switchDoc = useCallback(
    (id: string): boolean => {
      if (id === currentIdRef.current) return true
      const ed = editorRef.current
      const currentMd = ed ? actions.getMarkdown(ed) : mdRef.current
      const nextDocs = withCurrentContent(currentMd, Date.now())
      const target = nextDocs.find((d) => d.id === id)
      if (!target || target.trashedAt) return false
      if (!writeStore(nextDocs, id)) {
        window.alert('切换失败：浏览器无法保存文档，请检查可用存储空间。')
        return false
      }
      if (saveTimer.current !== null) window.clearTimeout(saveTimer.current)
      titleRef.current = target.title
      setTitle(target.title)
      mdRef.current = target.md
      setSavedAt(target.at)
      if (ed) {
        actions.setMarkdown(ed, target.md)
        scanIssues()
      }
      return true
    },
    [scanIssues, withCurrentContent, writeStore],
  )

  /** 新建一篇空文档并切过去（示例内容只留给第一次打开时的第一篇） */
  const createDocument = useCallback(() => {
    const ed = editorRef.current
    const currentMd = ed ? actions.getMarkdown(ed) : mdRef.current
    const saved = withCurrentContent(currentMd, Date.now())
    const fresh = createDoc('', '')
    if (!writeStore([fresh, ...saved], fresh.id)) {
      window.alert('新建失败：浏览器无法保存文档，请检查可用存储空间。')
      return
    }
    if (saveTimer.current !== null) window.clearTimeout(saveTimer.current)
    titleRef.current = ''
    setTitle('')
    mdRef.current = ''
    setSavedAt(fresh.at)
    if (ed) {
      actions.setMarkdown(ed, '')
      scanIssues()
    }
    requestAnimationFrame(() => editorRef.current?.commands.focus('start'))
  }, [scanIssues, withCurrentContent, writeStore])

  /** 回收站与文档保存在同一条记录中，移动和恢复都只需要一次写入。 */
  const deleteDocument = useCallback(
    (id: string) => {
      if (isDocStoreLoading()) { flash('文档库正在加载。请稍后重试。'); return }
      const wasCurrent = id === currentIdRef.current
      const snapshot = snapshotDocuments()
      const target = snapshot.find((doc) => doc.id !== id && !doc.trashedAt) ?? createDoc()
      const nextDocs = snapshot.map((doc) => doc.id === id ? { ...doc, trashedAt: Date.now() } : doc)
      if (wasCurrent && !nextDocs.some((doc) => doc.id === target.id)) nextDocs.unshift(target)
      const nextId = wasCurrent ? target.id : currentIdRef.current
      if (!writeStore(nextDocs, nextId)) {
        flash('无法移入回收站。请检查浏览器存储。')
        return
      }
      if (wasCurrent) {
        if (saveTimer.current !== null) window.clearTimeout(saveTimer.current)
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
    [flash, scanIssues, snapshotDocuments, writeStore],
  )

  const restoreTrashedDocument = useCallback((id: string) => {
    if (isDocStoreLoading()) return '文档库正在加载。请稍后重试。'
    const snapshot = snapshotDocuments()
    const next = snapshot.map((doc) => doc.id === id ? { ...doc, trashedAt: undefined } : doc)
    return writeStore(next, currentIdRef.current) ? '文档已恢复。' : '恢复失败。请检查浏览器存储。'
  }, [snapshotDocuments, writeStore])

  const saveVersion = useCallback(() => {
    if (isDocStoreLoading()) return '文档库正在加载。请稍后重试。'
    const snapshot = snapshotDocuments()
    const current = snapshot.find((doc) => doc.id === currentIdRef.current)
    if (!current || (!current.title && !current.md)) return '当前文档没有可保存的内容。'
    const versioned = captureDocVersion(current)
    if (versioned === current) return '当前内容已在版本历史中。'
    const next = snapshot.map((doc) => doc.id === current.id ? versioned : doc)
    return writeStore(next, current.id) ? '已保存版本。' : '版本保存失败。请检查浏览器存储。'
  }, [snapshotDocuments, writeStore])

  const restoreVersion = useCallback((version: DocVersion) => {
    if (isDocStoreLoading()) return '文档库正在加载。请稍后重试。'
    const snapshot = snapshotDocuments()
    const current = snapshot.find((doc) => doc.id === currentIdRef.current)
    if (!current?.versions?.includes(version)) return '版本已不可用。'
    if (current.title === version.title && current.md === version.md) return '该版本与当前内容相同。'
    const restored = { ...captureDocVersion(current), title: version.title, md: version.md, at: Date.now() }
    if (!writeStore(snapshot.map((doc) => doc.id === current.id ? restored : doc), current.id)) {
      return '恢复失败。请检查浏览器存储。'
    }
    if (saveTimer.current !== null) window.clearTimeout(saveTimer.current)
    titleRef.current = restored.title
    mdRef.current = restored.md
    setTitle(restored.title)
    setSavedAt(restored.at)
    const ed = editorRef.current
    if (ed) {
      actions.setMarkdown(ed, restored.md)
      scanIssues()
    }
    return '已恢复版本。恢复前的内容已保留在历史中。'
  }, [scanIssues, snapshotDocuments, writeStore])

  const compareVersion = (version: DocVersion) => {
    const current = snapshotDocuments().find((doc) => doc.id === currentIdRef.current)
    if (!current) return
    setCompareFeedback('')
    setComparison({ id: current.id, version, title: current.title, md: current.md })
    setDocsOpen(false)
  }

  const restoreVersionChange = (change: VersionChange | 'title') => {
    if (!comparison || isDocStoreLoading()) return
    const snapshot = snapshotDocuments()
    const current = snapshot.find((doc) => doc.id === currentIdRef.current)
    if (!current || current.id !== comparison.id || current.title !== comparison.title || current.md !== comparison.md) {
      setCompareFeedback('当前文档已更新。请重新打开版本对比。')
      return
    }
    const title = change === 'title' ? comparison.version.title : current.title
    const md = change === 'title' ? current.md : current.md.slice(0, change.start) + change.oldText + current.md.slice(change.end)
    const next = { ...captureDocVersion(current), title, md, at: Date.now() }
    if (!writeStore(snapshot.map((doc) => doc.id === current.id ? next : doc), current.id)) {
      setCompareFeedback('无法保存恢复结果。请检查浏览器存储。')
      return
    }
    if (saveTimer.current !== null) window.clearTimeout(saveTimer.current)
    titleRef.current = title
    mdRef.current = md
    setTitle(title)
    setSavedAt(next.at)
    const instance = editorRef.current
    if (instance && change !== 'title') {
      actions.setMarkdown(instance, md, true)
      scanIssues()
    }
    setComparison({ ...comparison, title, md: instance ? actions.getMarkdown(instance) : md })
    setCompareFeedback('已恢复选中的内容。恢复前的内容保存在版本历史中。')
  }

  const activeDocs = useMemo(() => docs.filter((doc) => !doc.trashedAt), [docs])

  const refreshDerived = useCallback((ed: Editor) => {
    const storage = ed.storage as unknown as { characterCount?: { characters: () => number } }
    setWordCount(storage.characterCount?.characters?.() ?? 0)
    if (!LOCAL_FILE_EDITING) setOutline(actions.getOutline(ed))
  }, [])

  useEffect(() => {
    // 数据库迟到时，先现取正文和标题，包含还没触发自动保存的输入。
    onStoreReloaded((store, live) => {
      const target = store.docs.find((doc) => doc.id === store.currentId)
      if (!target) return
      if (saveTimer.current !== null) window.clearTimeout(saveTimer.current)
      docsRef.current = store.docs
      currentIdRef.current = target.id
      setDocs(store.docs)
      setCurrentId(target.id)
      mdRef.current = target.md
      titleRef.current = target.title
      setTitle(target.title)
      setSavedAt(target.at)
      const ed = editorRef.current
      if (ed && !ed.isDestroyed && (live?.id !== target.id || live.md !== target.md)) {
        actions.setMarkdown(ed, target.md)
        refreshDerived(ed)
        scanIssues()
      }
    }, () => {
      const id = currentIdRef.current
      const doc = docsRef.current.find((item) => item.id === id)
      if (!doc) return
      const ed = editorRef.current
      const md = ed?.isInitialized && !ed.isDestroyed ? actions.getMarkdown(ed) : mdRef.current
      const title = titleRef.current
      return md === doc.md && title === doc.title ? doc : { ...doc, md, title, at: Date.now() }
    })
    return () => onStoreReloaded(null)
  }, [refreshDerived, scanIssues])

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
    captureImageTarget: LOCAL_FILE_EDITING ? () => {
      const id = currentIdRef.current
      const directory = localFiles.get(id)?.directory
      const isCurrent = () => currentIdRef.current === id
      return { isCurrent, save: autoAssets && directory ? async (url) => {
        try { return await storeClipboardAsset(directory, url) }
        catch {
          if (isCurrent()) flash('无法写入 assets 文件夹。图片已内嵌到文档。')
          return undefined
        }
      } : undefined }
    } : undefined,
    onReady: (ed) => {
      editorRef.current = ed
      ;(window as unknown as { __EDITOR__: Editor }).__EDITOR__ = ed
      // 供调试与测试脚本使用：取"应用真正会保存的那份 Markdown"
      // （底层 storage.markdown.getMarkdown() 拿到的还是内部标记，测试里别用它）
      ;(window as unknown as { __MD__: () => string }).__MD__ = () => actions.getMarkdown(ed)
      /* 公式修复的调试口（给 check:latex-repair-safety 用）：
         那条套件要验"修不好就一个字都不许改"，这只有在函数层面才验得出来 */
      actions.exposeRepairDebugHooks()
      /* 诊断包的调试口：让 check:math-diagnostics 能直接取内容来验
         （只点按钮的话只能验"有没有下载"，验不出内容对不对） */
      ;(window as unknown as { __MATH_DIAG__: () => unknown }).__MATH_DIAG__ = () => buildFormulaDiag(ed)
      refreshDerived(ed)
      // 打开时先救一遍"还是原文的公式"：旧文档里粘坏的公式（字面 $…$ ）存盘时
      // 被转义过，重开就会停在正文里 —— 这里自动转回真公式，用户不用管
      window.setTimeout(() => {
        const ed2 = editorRef.current
        if (ed2 && !ed2.isDestroyed) {
          const fixed = actions.convertRawMath(ed2)
          if (fixed) {
            scheduleSave()
            flash(`已自动将 ${fixed} 处文本转换为公式。`)
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
  useDimColorFix(theme, pageBackground.color, editor)

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
      if (editorRef.current && !editorRef.current.isEditable) return
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
    if (!outlineOpen || LOCAL_FILE_EDITING) return
    const instance = editorRef.current
    if (instance) setOutline(actions.getOutline(instance))
  }, [outlineOpen, editor])

  const currentMarkdown = useCallback(() => {
    const ed = editorRef.current
    return ed ? actions.getMarkdown(ed) : mdRef.current
  }, [])

  const numberEquations = LOCAL_FILE_EDITING && docs.some((doc) => doc.id === currentId && doc.numberEquations)
  const includeContents = LOCAL_FILE_EDITING && docs.some((doc) => doc.id === currentId && doc.exportContents)
  useEffect(() => {
    if (editor && !editor.isDestroyed && LOCAL_FILE_EDITING &&
        equationNumberingKey.getState(editor.state) !== numberEquations) {
      editor.view.dispatch(editor.state.tr.setMeta(equationNumberingKey, numberEquations))
    }
  }, [editor, numberEquations])

  const setDocumentOption = (option: 'numberEquations' | 'exportContents', enabled: boolean) => {
    if (isDocStoreLoading()) {
      flash('文档库仍在加载。请稍后重试。')
      return
    }
    const id = currentIdRef.current
    const next = snapshotDocuments().map((doc) => doc.id === id ? { ...doc, [option]: enabled } : doc)
    if (!writeStore(next, id)) flash('无法保存文档设置。')
  }

  const exportContentsTitle = useCallback(() => LOCAL_FILE_EDITING &&
    docsRef.current.some((doc) => doc.id === currentIdRef.current && doc.exportContents) ? titleRef.current : undefined, [])

  useEffect(() => {
    if (editor && !editor.isDestroyed && LOCAL_FILE_EDITING) {
      editor.view.dispatch(editor.state.tr.setMeta(writingFocusKey, writingFocus))
    }
  }, [editor, writingFocus])

  const openMarkdownSource = useCallback(() => {
    const id = currentIdRef.current
    setSourceEdit({ id, initial: projectImportedImages(currentMarkdown(), localFiles.has(id)) })
  }, [currentMarkdown, localFiles])

  const applyMarkdownSource = (value: string) => {
    const ed = editorRef.current
    const id = currentIdRef.current
    if (!ed || ed.isDestroyed || sourceEdit?.id !== id) return '当前文档已切换。'
    if (value.includes('\u0000')) return '源码中包含无效字符。'
    actions.setMarkdown(ed, value, true)
    persistDraft(actions.getMarkdown(ed))
    scanIssues()
    const directory = localFiles.get(id)?.directory
    if (directory) void importFolderImages(id, directory, assetScope)
    return undefined
  }

  const rememberFile = useCallback((id: string, file: LocalMarkdownFile) => {
    setLocalFiles((current) => new Map(current).set(id, file))
    void storeLocalMarkdownFile(id, file).catch(() => {
      if (currentIdRef.current === id) flash('原文件关联仅保留在本次会话中。')
    })
  }, [flash])

  const loadMarkdownFile = useCallback((filename: string, text: string) => {
    const saved = withCurrentContent(currentMarkdown(), Date.now())
    const name = filename.replace(/\.(md|markdown|txt)$/i, '')
    const imported = createDoc(name, text)
    if (!writeStore([imported, ...saved], imported.id)) {
      flash('无法打开文档。请检查浏览器存储。')
      return null
    }
    if (saveTimer.current !== null) window.clearTimeout(saveTimer.current)
    titleRef.current = name
    setTitle(name)
    mdRef.current = text
    setSavedAt(imported.at)
    const ed = editorRef.current
    if (ed) {
      const { fixedMath } = actions.setMarkdown(ed, text)
      scanIssues()
      scheduleSave()
      if (fixedMath) flash(`已修复 ${fixedMath} 处公式语法。`)
    }
    return imported
  }, [currentMarkdown, flash, scanIssues, scheduleSave, withCurrentContent, writeStore])

  const importFolderImages = useCallback(async (id: string, directory: FileSystemDirectoryHandle, scope?: AssetScope) => {
    const ed = editorRef.current
    const active = () => currentIdRef.current === id && editorRef.current === ed
    if (!ed || !active()) return
    const authorized = scope ?? { root: directory, folder: [] }
    const result = await actions.embedImages(ed, (src) => resolveProjectAsset(authorized, src), true, active)
    if (!active()) return
    scanIssues()
    if (result.fixed) {
      scheduleSave()
      const left = actions.collectBrokenImages(ed).length
      flash(`已导入 ${result.fixed} 张资源图片${left ? `，另有 ${left} 张图片待处理` : ''}。`)
    }
  }, [flash, scanIssues, scheduleSave])

  const openLocalMarkdown = useCallback(async (handle: LocalFileHandle, directory?: FileSystemDirectoryHandle, scope?: AssetScope) => {
    for (const [id, file] of localFiles) {
      if (docsRef.current.some((doc) => doc.id === id && !doc.trashedAt) && await handle.isSameEntry(file.handle)) {
        if (switchDoc(id) && directory) {
          rememberFile(id, { ...file, directory })
          await importFolderImages(id, directory, scope)
        }
        return currentIdRef.current === id ? id : undefined
      }
    }
    if (!directory) {
      for (const file of localFiles.values()) {
        if (file.directory && (await file.directory.resolve(handle).catch(() => null))?.length === 1) {
          directory = file.directory
          break
        }
      }
    }
    const { markdown, source, diskHash } = await readLocalMarkdown(handle)
    const imported = loadMarkdownFile(handle.name, markdown)
    if (!imported) return
    const canonical = currentMarkdown()
    persistDraft(canonical)
    rememberFile(imported.id, { handle, source, diskHash, directory, editorHash: await markdownHash(canonical) })
    if (directory) await importFolderImages(imported.id, directory, scope)
    return imported.id
  }, [currentMarkdown, importFolderImages, loadMarkdownFile, localFiles, persistDraft, rememberFile, switchDoc])

  const workspace = useDocumentWorkspace(LOCAL_FILE_EDITING, flash)
  const workspaceRoot = workspace.root
  const activeWorkspacePath = workspacePaths.get(currentId)
  const activeWorkspaceFile = workspace.files.find((file) => file.path === activeWorkspacePath)
  const assetScope = useMemo<AssetScope | undefined>(() => {
    if (workspaceRoot && activeWorkspacePath) return { root: workspaceRoot, folder: activeWorkspacePath.split('/').slice(0, -1) }
    if (localFile?.directory) return { root: localFile.directory, folder: [] }
  }, [activeWorkspacePath, localFile?.directory, workspaceRoot])
  useEffect(() => {
    if (!workspaceRoot) return
    let active = true
    void Promise.all([...localFiles].map(async ([id, file]) => {
      const parts = await workspaceRoot.resolve(file.handle).catch(() => null)
      return [id, parts?.join('/')] as const
    })).then((entries) => {
      if (active) setWorkspacePaths(new Map(entries.flatMap(([id, path]) => path ? [[id, path]] : [])))
    })
    return () => { active = false }
  }, [localFiles, workspaceRoot])

  const workspaceDrafts = useMemo(() => new Map(docs.flatMap((doc) => {
      const path = workspacePaths.get(doc.id)
      return path && !doc.trashedAt ? [[path, doc] as const] : []
    })), [docs, workspacePaths])
  const backlinks = useMemo(() => workspace.visible && activeWorkspacePath
    ? workspaceBacklinks(workspace.files, activeWorkspacePath, new Map([...workspaceDrafts].map(([path, doc]) => [path, doc.md])))
    : [], [activeWorkspacePath, workspace.files, workspace.visible, workspaceDrafts])

  const openWorkspaceFile = useCallback(async (file: WorkspaceFile, fragment = '') => {
    if (workspaceNavigation.current) return
    workspaceNavigation.current = true
    try {
      const scope = workspaceRoot ? { root: workspaceRoot, folder: file.path.split('/').slice(0, -1) } : undefined
      const id = await openLocalMarkdown(file.handle, file.directory, scope)
      if (!id || currentIdRef.current !== id) return
      setWorkspacePaths((paths) => new Map(paths).set(id, file.path))
      if (fragment) {
        const ed = editorRef.current
        const heading = ed && actions.getOutline(ed).find((item) => headingMatches(item.text, fragment))
        if (ed && heading) actions.gotoPos(ed, heading.pos)
        else flash('目标文档中找不到该标题。')
      }
      return id
    } catch { flash('无法打开工作区文档。') }
    finally { workspaceNavigation.current = false }
  }, [flash, openLocalMarkdown, workspaceRoot])

  const openWorkspaceResult = async (result: WorkspaceSearchResult) => {
    const id = await openWorkspaceFile(result.file)
    const ed = editorRef.current
    if (!id || !ed || currentIdRef.current !== id) return
    if (result.index === null) {
      document.querySelector<HTMLInputElement>('.zh-title')?.focus()
      return
    }
    const matches = findMatches(ed.state.doc, result.query)
    const match = matches[result.index]
    if (match) scrollToMatch(ed, match)
    else flash('文档内容已更新，请刷新工作区后重新检索。')
  }

  useEffect(() => {
    if (!LOCAL_FILE_EDITING) return
    const follow = (event: Event) => {
      const link = parseWikiLink((event as CustomEvent<string>).detail)
      if (!link) return
      if (!link.name) {
        const ed = editorRef.current
        const heading = ed && actions.getOutline(ed).find((item) => headingMatches(item.text, link.fragment))
        if (ed && heading) actions.gotoPos(ed, heading.pos)
        else flash('当前文档中找不到该标题。')
        return
      }
      const path = resolveWikiPath(workspace.files.map((file) => file.path), workspacePaths.get(currentIdRef.current) ?? '', link.name)
      const file = workspace.files.find((item) => item.path === path)
      if (file) void openWorkspaceFile(file, link.fragment)
      else if (workspace.status === 'permission') { workspace.setVisible(true); flash('请先重新连接工作区。') }
      else flash(workspaceRoot ? '找不到唯一的链接目标。可在链接中指定文件夹路径。' : '请打开包含目标文档的本地工作区。')
    }
    window.addEventListener(wikiLinkEvent, follow)
    return () => window.removeEventListener(wikiLinkEvent, follow)
  }, [flash, openWorkspaceFile, workspace.files, workspace.status, workspace.setVisible, workspacePaths, workspaceRoot])

  const previewSource = useCallback(async (value: string) => {
    const ed = editorRef.current
    if (!ed || sourceEdit?.id !== currentIdRef.current) return ''
    return renderSourcePreview(ed, value, assetScope ? (src) => resolveProjectAsset(assetScope, src) : undefined)
  }, [assetScope, sourceEdit])

  const checkSource = useCallback((value: string) => {
    const linked = sourceEdit ? localFiles.get(sourceEdit.id) : undefined
    const sourcePath = sourceEdit ? workspacePaths.get(sourceEdit.id) ?? '' : ''
    const paths = workspace.files.map((file) => file.path)
    const home = sourcePath.slice(0, sourcePath.lastIndexOf('/') + 1)
    return reviewSource(value, async (destination, wiki) => {
      if (wiki) {
        const link = parseWikiLink(destination)
        if (!link || !paths.length && !workspaceRoot) return undefined
        const path = resolveWikiPath(paths, sourcePath, link.name)
        const target = workspace.files.find((file) => file.path === path)
        if (!target) return `找不到唯一的链接目标「${link.name}」。`
        if (!target.source) return `无法读取「${target.path}」。`
        if (link.fragment && !workspaceHeadings(target.path === sourcePath ? value : target.source.markdown)
          .some((heading) => headingMatches(heading.text, link.fragment))) {
          return `「${target.path}」中找不到标题「${link.fragment.slice(1)}」。`
        }
        return undefined
      }
      const directory = sourcePath && workspaceRoot ? workspaceRoot : linked?.directory
      if (!directory) return undefined
      const [raw, fragment] = destination.split('#', 2)
      let decoded: string
      try { decoded = decodeURIComponent(raw.split('?')[0]) } catch { return `链接路径无法解码「${destination}」。` }
      const path = normalizeWorkspacePath(decoded.startsWith('/') ? decoded : home + decoded)
      if (!path) return `无法核对当前授权目录之外的链接「${destination}」。`
      try {
        let folder = directory
        const parts = path.split('/')
        const name = parts.pop()!
        for (const part of parts) folder = await folder.getDirectoryHandle(part)
        let target: FileSystemFileHandle
        try { target = await folder.getFileHandle(name) }
        catch (error) {
          if (!(error instanceof DOMException && error.name === 'TypeMismatchError')) throw error
          await folder.getDirectoryHandle(name)
          return undefined
        }
        if (fragment && /\.(?:md|markdown)$/i.test(name)) {
          const text = path === sourcePath ? value : (await readLocalMarkdown(target as LocalFileHandle)).markdown
          if (!workspaceHeadings(text).some((heading) => headingMatches(heading.text, fragment))) {
            return `「${path}」中找不到标题「${fragment}」。`
          }
        }
      } catch { return `找不到或无法读取本地链接「${destination}」。` }
      return undefined
    })
  }, [localFiles, sourceEdit, workspace.files, workspacePaths, workspaceRoot])

  const renameWorkspaceFile = async (plan: WorkspaceRename) => {
    if (!workspaceRoot || localOperationRef.current || workspaceNavigation.current) throw new Error('有本地操作正在进行。')
    localOperationRef.current = currentIdRef.current
    const editor = editorRef.current
    const editable = editor?.isEditable
    editor?.setEditable(false, false)
    try {
      if (workspaceRoot.requestPermission && await workspaceRoot.requestPermission({ mode: 'readwrite' }) !== 'granted') {
        throw new Error('工作区需要写入权限。')
      }
      const paths = plan.files.map((file) => file.path)
      const byPath = new Map(plan.files.map((file) => [file.path, file]))
      const edits = new Map(plan.edits.map((edit) => [edit.file.path, edit]))
      const changes: { doc: Doc; before: LocalMarkdownFile; path: string; md: string; title: string }[] = []
      const snapshot = snapshotDocuments()
      for (const doc of snapshot) {
        const before = localFiles.get(doc.id)
        if (!before || doc.trashedAt) continue
        const relative = await workspaceRoot.resolve(before.handle).catch(() => null)
        const path = relative?.join('/')
        const indexed = path ? byPath.get(path) : undefined
        if (!path || !indexed) continue
        const next = renamedWorkspaceLinks(doc.md, paths, path, plan.target.path, plan.path)
        if (path !== plan.target.path && !edits.has(path) && !next.changes.length) continue
        if (await markdownHash(projectImportedImages(doc.md, true)) !== before.editorHash || before.diskHash !== indexed.source?.diskHash) {
          throw new Error(`请先保存或同步「${path}」中的编辑，再重新预览。`)
        }
        const title = path === plan.target.path && doc.title === before.handle.name.replace(/\.(?:md|markdown)$/i, '')
          ? plan.filename.replace(/\.(?:md|markdown)$/i, '') : doc.title
        changes.push({ doc, before, path, md: next.markdown, title })
      }
      const newHandle = await commitWorkspaceRename(workspaceRoot, plan)
      const renamed = new Map(changes.map((change) => [change.doc.id, change]))
      const id = currentIdRef.current
      const live = renamed.get(id)
      for (const { doc, before, path, md } of changes) {
        const handle = path === plan.target.path ? newHandle : before.handle
        const indexed = byPath.get(path)!.source!
        const edit = edits.get(path)
        const diskHash = edit ? await markdownHash(serializeLocalMarkdown(edit.markdown, indexed.source)) : indexed.diskHash
        rememberFile(doc.id, { ...before, handle, diskHash, editorHash: await markdownHash(projectImportedImages(md, true)) })
      }
      if (live && editor && !editor.isDestroyed) {
        if (saveTimer.current !== null) window.clearTimeout(saveTimer.current)
        titleRef.current = live.title
        setTitle(live.title)
        actions.setMarkdown(editor, live.md, true)
        mdRef.current = actions.getMarkdown(editor)
        scanIssues()
      }
      const synced = writeStore(docsRef.current.map((doc) => {
        const change = renamed.get(doc.id)
        return change ? { ...doc, md: change.md, title: change.title } : doc
      }), id)
      setRenameFile(undefined)
      await workspace.refresh(workspaceRoot)
      flash(synced ? `已重命名为「${plan.filename}」，并更新文件引用。` : '磁盘文件已重命名。请重新打开工作区文档，同步浏览器草稿。')
    } finally {
      if (editor && !editor.isDestroyed && editable) editor.setEditable(true, false)
      localOperationRef.current = null
    }
  }

  const openDocumentFolder = useCallback((forCurrentDocument = false) => {
    const picker = localFilePickers()
    if (!picker.showDirectoryPicker) {
      if (forCurrentDocument) repairImages(true)
      return
    }
    const id = currentIdRef.current
    const linked = localFiles.get(id)
    void picker.showDirectoryPicker({ mode: forCurrentDocument ? 'read' : 'readwrite' }).then(async (directory) => {
      if (forCurrentDocument && linked) {
        if (currentIdRef.current !== id) return
        if ((await directory.resolve(linked.handle))?.length !== 1) {
          flash('请选择当前 Markdown 文件所在的文件夹。')
          return
        }
        rememberFile(id, { ...linked, directory })
        await importFolderImages(id, directory)
        if (currentIdRef.current === id) setIssuesHidden(false)
        return
      }
      const documents: typeof folderDocuments = []
      const readFolder = async (folder: LocalDirectoryHandle, subfolders: boolean) => {
        for await (const entry of folder.values()) {
          if (entry.kind === 'file' && /\.(?:md|markdown|txt)$/i.test(entry.name)) {
            documents.push({ handle: entry as LocalFileHandle, directory: folder })
          } else if (subfolders && entry.kind === 'directory' && !/^[._]|^assets?$/i.test(entry.name)) {
            await readFolder(entry as LocalDirectoryHandle, false)
          }
        }
      }
      await readFolder(directory, true)
      if (!documents.length) flash('所选文件夹内没有 Markdown 文档。')
      else if (documents.length === 1) await openLocalMarkdown(documents[0].handle, documents[0].directory)
      else setFolderDocuments(documents.sort((a, b) => a.handle.name.localeCompare(b.handle.name, 'zh')))
    }).catch((error: unknown) => {
      if (!(error instanceof DOMException && error.name === 'AbortError')) flash('无法读取文档文件夹。')
    })
  }, [flash, importFolderImages, localFiles, openLocalMarkdown, rememberFile, repairImages])

  /* ---------- 文件操作 ---------- */
  const openMarkdownFile = useCallback(async () => {
    const picker = localFilePickers()
    if (LOCAL_FILE_EDITING && picker.showOpenFilePicker && window.crypto?.subtle) {
      try {
        const [handle] = await picker.showOpenFilePicker({ types: markdownTypes })
        if (!handle) return
        await openLocalMarkdown(handle)
        return
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return
        const fallback = error instanceof DOMException && ['SecurityError', 'NotAllowedError'].includes(error.name)
        if (!fallback) {
          flash(error instanceof TypeError ? '无法读取文件。请选择 UTF-8 编码的 Markdown 文档。' : '无法读取本地文件。')
          return
        }
      }
    }
    actions.pickFile('.md,.markdown,.txt,text/markdown,text/plain', async (file) => {
      const looksText = /\.(md|markdown|txt)$/i.test(file.name) || file.type.startsWith('text/')
      if (!looksText) {
        flash('请选择 Markdown 或纯文本文件。')
        return
      }
      let text: string
      try {
        text = await actions.readFileAsText(file)
      } catch (e) {
        flash('无法读取文件：' + String(e).slice(0, 80))
        return
      }
      if (text.includes('\u0000')) {
        flash('请选择 Markdown 或纯文本文件。')
        return
      }
      loadMarkdownFile(file.name, text)
    })
  }, [flash, loadMarkdownFile, openLocalMarkdown])

  /** 纯 .md 存档（备份 / 用别的软件读）。
   *  注意：图片是内嵌的，**拿去知乎导入会丢图** —— 它在「保存」菜单的最后一项，
   *  标签和说明里都写着"别拿去知乎导入"；每次存完再提醒一句，免得又选错。 */
  const saveMarkdownFile = useCallback(() => {
    const md = currentMarkdown()
    const name = (titleRef.current.trim() || '文档') + '.md'
    actions.downloadText(name, projectImportedImages(md, false), 'text/markdown;charset=utf-8')
    persistDraft(md)
    flash(`已存一份「${name}」（图片内嵌，自己看 / 备份用）。要发知乎请用「保存 → 导出知乎用 .md」。`)
  }, [currentMarkdown, flash, persistDraft])

  const runLocalFileAction = useCallback(async (id: string, action: () => Promise<void>, failure: string) => {
    if (localOperationRef.current) return
    localOperationRef.current = id
    setLocalOperation(id)
    setLocalConflictError('')
    try {
      await action()
    } catch (error) {
      if (currentIdRef.current === id && !(error instanceof DOMException && error.name === 'AbortError')) {
        if (localConflict === id) setLocalConflictError(failure)
        else flash(failure)
      }
    } finally {
      localOperationRef.current = null
      setLocalOperation(null)
    }
  }, [flash, localConflict])

  const saveCurrentFile = useCallback(() => {
    if (!localFilesReady) {
      flash('正在读取本地文件关联。请稍后保存。')
      return
    }
    const id = currentIdRef.current
    const file = localFiles.get(id)
    if (!file) {
      saveMarkdownFile()
      return
    }
    void runLocalFileAction(id, async () => {
      const draft = currentMarkdown()
      const md = projectImportedImages(draft, true)
      persistDraft(draft)
      const editorHash = await markdownHash(md)
      const unchanged = editorHash === file.editorHash
      const requestWrite = async () => {
        if (await file.handle.requestPermission({ mode: 'readwrite' }) === 'granted') return true
        if (currentIdRef.current === id) flash('原文件写入权限未授予。可从「保存」菜单另存 Markdown 副本。')
        return false
      }
      let canWrite = false
      let matches: boolean
      try {
        matches = await localFileMatches(file.handle, file.diskHash)
      } catch (error) {
        if (!(error instanceof DOMException) || error.name !== 'NotAllowedError') throw error
        if (unchanged) {
          if (currentIdRef.current === id) flash('当前没有需要写回的改动。')
          return
        }
        canWrite = await requestWrite()
        if (!canWrite) return
        matches = await localFileMatches(file.handle, file.diskHash)
      }
      if (!matches) {
        setLocalConflict(id)
        return
      }
      if (unchanged) {
        if (currentIdRef.current === id) flash('原文件已是最新版本。')
        return
      }
      if (!canWrite && !await requestWrite()) return
      const text = serializeLocalMarkdown(md, file.source)
      const diskHash = await markdownHash(text)
      if (!await writeLocalMarkdown(file.handle, text, file.diskHash)) {
        setLocalConflict(id)
        return
      }
      rememberFile(id, { ...file, editorHash, diskHash })
      if (workspaceRoot && workspacePaths.has(id)) void workspace.refresh(workspaceRoot)
      setLocalConflict((conflict) => conflict === id ? null : conflict)
      if (currentIdRef.current === id) flash(`已保存到原文件「${file.handle.name}」。`)
    }, '无法保存原文件。请确认文件仍可访问，或另存 Markdown 副本。')
  }, [currentMarkdown, flash, localFiles, localFilesReady, persistDraft, rememberFile, runLocalFileAction, saveMarkdownFile,
    workspace.refresh, workspacePaths, workspaceRoot])

  const saveFileCopy = useCallback(() => {
    const id = currentIdRef.current
    const file = localFiles.get(id)
    if (!file) return
    void runLocalFileAction(id, async () => {
      const md = projectImportedImages(currentMarkdown(), true)
      const picker = localFilePickers()
      const name = file.handle.name.replace(/\.(?:md|markdown|txt)$/i, '') + ' - 副本.md'
      const target = picker.showSaveFilePicker
        ? await picker.showSaveFilePicker({ types: markdownTypes, suggestedName: name }) : null
      if (target && await target.isSameEntry(file.handle)) {
        const message = '请选择与原文件不同的保存位置或文件名。'
        if (localConflict === id) setLocalConflictError(message)
        else flash(message)
        return
      }
      let content: string | ArrayBuffer = serializeLocalMarkdown(md, file.source)
      if (await markdownHash(md) === file.editorHash) {
        try {
          const original = await readLocalMarkdown(file.handle)
          if (original.diskHash === file.diskHash) content = original.bytes
        } catch {
          // 原文件已不可读时，仍可使用编辑器中的内容另存。
        }
      }
      if (target) {
        await writeLocalMarkdown(target, content)
      } else {
        actions.downloadBlob(name, new Blob([content], { type: 'text/markdown;charset=utf-8' }))
      }
      setLocalConflict((conflict) => conflict === id ? null : conflict)
      if (currentIdRef.current === id) flash(target ? `已另存「${target.name}」。` : '已下载 Markdown 副本。')
    }, '无法另存 Markdown 副本。请检查保存位置和写入权限。')
  }, [currentMarkdown, flash, localConflict, localFiles, runLocalFileAction])

  const reloadLocalFile = useCallback(() => {
    const id = currentIdRef.current
    const file = localFiles.get(id)
    if (!file) return
    void runLocalFileAction(id, async () => {
      const { markdown, source, diskHash } = await readLocalMarkdown(file.handle)
      if (currentIdRef.current !== id) return
      const snapshot = snapshotDocuments()
      const previous = snapshot.find((doc) => doc.id === id && !doc.trashedAt)
      if (!previous) return
      const at = Date.now()
      const content = { ...captureDocVersion(previous), md: markdown, at }
      if (!writeStore(snapshot.map((doc) => doc.id === id ? content : doc), id)) {
        setLocalConflictError('无法重新加载。请检查浏览器存储。')
        return
      }
      if (saveTimer.current !== null) window.clearTimeout(saveTimer.current)
      mdRef.current = markdown
      setSavedAt(at)
      const ed = editorRef.current
      if (ed) {
        actions.setMarkdown(ed, markdown)
        scanIssues()
      }
      const canonical = currentMarkdown()
      persistDraft(canonical)
      rememberFile(id, { ...file, source, diskHash, editorHash: await markdownHash(canonical) })
      if (file.directory) await importFolderImages(id, file.directory, assetScope)
      setLocalConflict((conflict) => conflict === id ? null : conflict)
      if (currentIdRef.current === id) flash('已重新加载原文件。加载前的草稿已保留在版本历史中。')
    }, '无法读取原文件。可将当前草稿另存为 Markdown 副本。')
  }, [assetScope, currentMarkdown, flash, importFolderImages, localFiles, persistDraft, rememberFile, runLocalFileAction, scanIssues, snapshotDocuments, writeStore])

  const exportHtmlFile = useCallback(async () => {
    const ed = editorRef.current
    if (!ed) return
    const title = titleRef.current
    const name = (title.trim() || '文档') + '.html'
    const body = actions.buildExportBody(ed, 'document', exportContentsTitle())
    /* 自己装的字体：≤4MB 就**嵌进这份网页**（别人电脑上也是这个字体）；
       超过上限就不嵌，并且**明说** —— 字体悄悄掉包是最容易被当成"导出坏了"的问题 */
    const font = await fontEmbedCss(typography.family)
    const projected = LOCAL_FILE_EDITING ? await exportDiagrams(body, 'html') : { html: body, failed: 0 }
    actions.downloadText(
      name,
      actions.buildStandaloneHtml(title, projected.html, typography, {
        backgroundCss: pageBackgroundCss(pageBackground),
        fontFaceCss: font.css,
      }),
      'text/html;charset=utf-8',
    )
    if (projected.failed) {
      flash(`已导出「${name}」。${projected.failed} 个图表以源码保留。`)
    } else if (font.skipped === 'too-big') {
      flash(
        `已存「${name}」。注意：你装的字体「${font.name}」有 ${formatSize(font.size)}，太大了没嵌进这份网页 —— ` +
          `在没装这个字体的电脑上会显示成默认字体。`,
      )
    } else {
      flash(font.name ? `已存「${name}」（把你装的字体「${font.name}」也嵌进去了）` : `已存「${name}」`)
    }
  }, [typography, pageBackground, flash, exportContentsTitle])

  /** 「保存」按钮（工具栏和右下角那个都是它）点开选格式后走这里
   *  三种"图片一定显示得出来"的格式 + 一份纯 .md 备份（知乎用 .md / 网页 / PDF / 纯 .md） */
  const saveAs = useCallback(
    async (format: SaveFormat) => {
      if (format === 'publication') {
        setPublicationOpen(true)
        return
      }
      if (format === 'local') {
        saveCurrentFile()
        return
      }
      if (format === 'copy') {
        saveFileCopy()
        return
      }
      const ed = editorRef.current
      if (!ed) return
      if (format === 'zip' && LOCAL_FILE_EDITING) {
        flash('正在打包 Markdown 和图片…')
        try {
          const { blob, name, missing } = await packMarkdownAssets(ed, titleRef.current, assetScope)
          actions.downloadBlob(name, blob)
          flash(missing ? `已导出「${name}」。${missing} 张图片未找到，已保留原链接。` : `已导出「${name}」。`)
        } catch { flash('无法生成 Markdown 资源包。') }
        return
      }
      if (format === 'html') {
        await exportHtmlFile()
        return
      }
      if (format === 'pdf') {
        const snapshot = ed.state.doc
        const diagrams = LOCAL_FILE_EDITING ? diagramsIn(snapshot) : []
        if (diagrams.length) {
          await Promise.all(diagrams.map(({ source }) => loadDiagram(source)))
          // 等待图表的 React 节点视图和 SVG 图片同步到打印页面。
          await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
          if (ed.isDestroyed || editorRef.current !== ed || ed.state.doc !== snapshot) {
            flash('文档内容已更新。请重新导出 PDF。')
            return
          }
          await Promise.all([...ed.view.dom.querySelectorAll<HTMLImageElement>('.zh-diagram img')].map((img) => img.decode().catch(() => {})))
          if (ed.isDestroyed || editorRef.current !== ed || ed.state.doc !== snapshot) return
        }
        window.print()
        return
      }
      if (format === 'docx' && LOCAL_FILE_EDITING) {
        if (exportingWord.current) return
        exportingWord.current = true
        const title = titleRef.current.trim()
        const name = (title || '未命名文档') + '.docx'
        flash('正在生成 Word 文档…')
        try {
          const { html, failed } = await exportDiagrams(actions.buildExportBody(ed, 'document', exportContentsTitle()), 'docx')
          const { buildWordDocument } = await import('./publication/exportWord')
          const result = await buildWordDocument(title, html, assetScope ? (src) => resolveProjectAsset(assetScope, src) : undefined, publication)
          actions.downloadBlob(name, result.blob)
          const notices = [
            result.missingImages && `${result.missingImages} 张图片未能嵌入`,
            result.formulaWarnings && `${result.formulaWarnings} 个公式需要核对`,
            result.videos && `${result.videos} 个视频以链接导出`,
            failed && `${failed} 个图表以源码保留`,
          ].filter(Boolean)
          flash(`已导出「${name}」${notices.length ? '。' + notices.join('，') : ''}。`)
        } catch {
          flash('无法生成 Word 文档。请重试。')
        } finally {
          exportingWord.current = false
        }
        return
      }
      if (format === 'plain') {
        saveMarkdownFile()
        return
      }
      // 知乎用 .md：可能要先上传图片，过程中给提示；拿不到网址时它自己会拦住并说明怎么办
      flash('正在准备知乎 Markdown 文件…')
      try {
        const out = await exportZhihuMarkdown(ed, titleRef.current, { onPhase: (t) => t && flash(t) })
        flash(out.text)
        if (out.ok) scheduleSave()
      } catch (e) {
        flash('导出出错：' + String(e).slice(0, 120))
      }
    },
    [assetScope, exportHtmlFile, exportContentsTitle, flash, publication, saveCurrentFile, saveFileCopy, saveMarkdownFile, scheduleSave],
  )

  const reviewExport = useCallback((target: ExportTarget = 'docx') => {
    const instance = editorRef.current
    if (instance && !instance.isDestroyed) setExportReview({ target, issues: checkExport(instance, target) })
  }, [])

  const requestSave = useCallback((format: SaveFormat) => {
    const instance = editorRef.current
    if (LOCAL_FILE_EDITING && instance && !instance.isDestroyed && (format === 'editions' ||
      ((format === 'docx' || format === 'pdf' || format === 'zhihu') && hasEditionBlocks(instance.state.doc)))) {
      setEditionRequest({
        doc: instance.state.doc, title: titleRef.current, format: format === 'editions' ? undefined : format,
        contents: exportContentsTitle() !== undefined, assets: assetScope,
      })
      return
    }
    if (LOCAL_FILE_EDITING && instance && (format === 'docx' || format === 'pdf' || format === 'zhihu')) {
      const issues = checkExport(instance, format)
      if (issues.length) {
        setExportReview({ target: format, issues, resume: format })
        return
      }
    }
    void saveAs(format)
  }, [assetScope, exportContentsTitle, saveAs])

  const toggleReading = useCallback(() => {
    if (localOperation || (editorRef.current && !editorRef.current.isEditable && !reading)) return
    if (!reading) {
      setDocsOpen(false)
      setTypographyOpen(false)
      setEffectOpen(false)
    }
    setReading(!reading)
  }, [localOperation, reading])

  useLayoutEffect(() => {
    if (!reading || !editor || editor.isDestroyed) return
    const wasEditable = editor.isEditable
    editor.view.dispatch(editor.state.tr.setMeta(readingModeKey, true))
    editor.setEditable(false, false)
    return () => {
      if (editor.isDestroyed) return
      editor.view.dispatch(editor.state.tr.setMeta(readingModeKey, false))
      editor.setEditable(wasEditable, false)
    }
  }, [editor, reading])

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
            window.alert('图片大小超过 12 MB。请压缩后重新插入。')
            return
          }
          try {
            const url = await actions.prepareImageDataUrl(file)
            actions.insertImage(instance, url, file.name)
          } catch (e) {
            // 读不出来要说一声，别让用户以为"点了没反应"
            window.alert('无法读取图片：' + String(e).slice(0, 80))
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
      exportPdf: () => requestSave('pdf'),
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
    requestSave,
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
      save: saveCurrentFile,
      open: () => api.openMarkdownFile(),
      exportPdf: () => api.exportPdf(),
      exportHtml: () => api.exportHtmlFile(),
      newDoc: () => createDocument(),
      docs: () => setDocsOpen(true),
      markdownInput: () => api.toggleMarkdownInput(),
      outline: () => api.toggleOutline(),
      fullscreen: () => api.toggleFullscreen(),
      toolbarOrb: () => window.dispatchEvent(new Event(TOOLBAR_ORB_REVEAL_EVENT)),
      tools: () => window.dispatchEvent(new Event(TOOLBAR_TOOLS_EVENT)),
      readingMode: toggleReading,
      shortcuts: () => setShortcutsOpen(true),
    })
  })

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // 设置面板自己在录制；其它弹窗开着时也不抢键
      if (shortcutsOpen) return
      if (document.querySelector('.zh-modal-mask')) return

      const key = normalizeEvent(e)
      const id = key ? shortcuts.match(key) : null
      if (reading && (e.key === 'Escape' || id === 'readingMode')) {
        e.preventDefault()
        e.stopPropagation()
        if (!e.repeat) toggleReading()
        return
      }
      if (reading) return
      if (e.target instanceof HTMLElement && e.target.closest('.zh-command-search') && id !== 'tools') return

      // Ctrl+F / Cmd+F：打开我们自己的搜索
      // （浏览器自带的"查找"在编辑器里找不到公式、代码块这些块内容，也没法把命中滚到视野中间）
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && (e.key === 'f' || e.key === 'F')) {
        e.preventDefault()
        e.stopPropagation()
        setSearchOpen(true)
        return
      }

      if (!key) return

      if (id) {
        const action = SHORTCUT_ACTIONS.find((a) => a.id === id)
        const target = e.target as HTMLElement | null
        const inPlainInput =
          !!target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')
        // 在标题框里按 Ctrl+B 不该去加粗正文
        if (action?.group === '编辑' && inPlainInput) return
        e.preventDefault()
        e.stopPropagation()
        if ((id !== 'readingMode' && id !== 'tools') || !e.repeat) shortcuts.run(id)
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
  }, [reading, shortcutsOpen, toggleReading])

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
      openFeedback: () => setFeedbackOpen(true),
      openSearch: () => setSearchOpen(true),
      openShortcuts: () => setShortcutsOpen(true),
      openZhihu: () => setZhihuOpen(true),
      pickImage: () => api.pickImage(),
      checkDocument,
      openDocumentFolder: LOCAL_FILE_EDITING && localFilePickers().showDirectoryPicker ? () => openDocumentFolder() : undefined,
      openWorkspace: LOCAL_FILE_EDITING && localFilePickers().showDirectoryPicker
        ? () => workspaceRoot ? workspace.setVisible((visible) => !visible) : workspace.choose() : undefined,
      openMarkdownSource: LOCAL_FILE_EDITING ? openMarkdownSource : undefined,
      toggleWritingFocus: LOCAL_FILE_EDITING ? () => setWritingFocus((value) => !value) : undefined,
      toggleReadingMode: LOCAL_FILE_EDITING ? toggleReading : undefined,
      markEditionBlock: LOCAL_FILE_EDITING ? () => setEditionBlockPicker(true) : undefined,
      openEquationTools: LOCAL_FILE_EDITING ? () => setEquationToolsOpen(true) : undefined,
      openObjectTools: LOCAL_FILE_EDITING ? () => setObjectToolsOpen(true) : undefined,
      openAssetManager: LOCAL_FILE_EDITING ? () => setAssetDocumentId(currentIdRef.current) : undefined,
      openScholarTools: LOCAL_FILE_EDITING ? setScholarTab : undefined,
      openMacroDefinitions: LOCAL_FILE_EDITING ? () => {
        const instance = editorRef.current
        if (!instance) return
        const existing = documentMacros(instance.state.doc).positions[0]
        if (existing !== undefined) { actions.gotoPos(instance, existing); return }
        const first = instance.state.doc.firstChild
        const at = first?.type.name === 'heading' ? first.nodeSize : 0
        instance.chain().insertContentAt(at, {
          type: 'codeBlock', attrs: { language: MACRO_LANGUAGE },
          content: [{ type: 'text', text: '\\newcommand{\\RealSet}{\\mathbb{R}}' }],
        }).setTextSelection(at + 1).focus().scrollIntoView().run()
      } : undefined,
      insertMermaidDiagram: LOCAL_FILE_EDITING ? () => {
        editorRef.current?.chain().focus().insertContent({
          type: 'codeBlock', attrs: { language: MERMAID_LANGUAGE },
          content: [{ type: 'text', text: MERMAID_SAMPLE }],
        }).run()
      } : undefined,
      openExportPreflight: LOCAL_FILE_EDITING ? () => reviewExport() : undefined,
      writingFocus,
      exportMathDiag,
    }),
    [api, checkDocument, exportMathDiag, openDocumentFolder, openMarkdownSource, reviewExport, workspace.choose,
      workspace.setVisible, workspaceRoot, writingFocus, toggleReading],
  )

  const confirmMath = useCallback(
    (latex: string, display: boolean) => {
      const ed = editorRef.current
      if (!ed) return
      /* 编辑已有公式时把 `display` 一起传下去 —— 用户在弹窗里把「行内 / 行间」
         切一下，本来就是想换排版（"让这个公式单独占一行"）。
         以前这里不传，于是那个按钮在编辑状态下是摆设（详见 MathNode.updateMathAt）。
         返回值 false = 那个位置上已经不是公式了（位置失效）：这时**当新公式插入**，
         别让用户刚改好的内容凭空消失。 */
      if (mathSeed.pos === null || !actions.updateMathAt(ed, mathSeed.pos, latex, display)) {
        if (display) actions.insertMathBlock(ed, latex)
        else actions.insertMathInline(ed, latex)
      }
      scheduleSave()
    },
    [mathSeed.pos, scheduleSave],
  )

  return (
    <div className="editor-page" data-reading={reading || undefined} data-effect-ui={LOCAL_FILE_EDITING || undefined}>
      {reading && <button className="zh-reading-exit" type="button" onClick={toggleReading} title="退出阅读模式（Esc）">退出阅读模式</button>}
      {LOCAL_FILE_EDITING && publication.preset !== 'default' && <style media="print">{printPublicationCss(publication, title)}</style>}
      <Toolbar
        api={api}
        handlers={handlers}
        panelsOpen={docsOpen || typographyOpen || effectOpen}
        onDismissPanels={() => {
          setDocsOpen(false)
          setTypographyOpen(false)
          setEffectOpen(false)
        }}
        extraLeading={
          <DocMenu
            docs={activeDocs}
            trashed={docs.filter((doc) => doc.trashedAt)}
            currentId={currentId}
            open={docsOpen}
            onOpenChange={setDocsOpen}
            onSwitch={switchDoc}
            onCreate={createDocument}
            onDelete={deleteDocument}
            onRestoreTrashed={restoreTrashedDocument}
            onSaveVersion={saveVersion}
            onRestoreVersion={restoreVersion}
            onCompareVersion={LOCAL_FILE_EDITING ? compareVersion : undefined}
            onBackup={backupDocuments}
            onRestore={restoreDocuments}
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
            pageBackground={pageBackground}
            onPageBackgroundChange={setPageBackground}
          />
        }
        effectPanel={
          // 纯净版构建里这个常量是 true，特效面板（连同特效代码）都不会出现
          __NO_MOUSE_EFFECT__ ? null : (
            <EffectPanel
              documentId={currentId}
              open={effectOpen}
              onOpenChange={setEffectOpen}
              settings={effect}
              onChange={setEffect}
              onReset={() => setEffect(resetMouseEffectSettings())}
            />
          )
        }
        saveMenu={<SaveMenu onPick={requestSave} localFileName={localFile?.handle.name} />}
        onOpenEffects={() => setEffectOpen(true)}
        onSaveAction={requestSave}
        hasLocalFile={Boolean(localFile)}
      />

      {/* 文档体检提示条：图片打不开 / 公式渲染不出来时自己浮出来 */}
      {fixNote ? (
        <div className="zh-fixbar zh-fixbar--ok">
          <span className="zh-fixbar__text" role="status">{fixNote}</span>
          <span className="zh-fixbar__spacer" />
          <button type="button" className="zh-fixbar__close" title="关闭提示" onClick={() => setFixNote(null)}>
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
                  有 <b>{issues.images}</b> 张本地图片待导入。可选择 Markdown 所在的文件夹。
                </span>
                <button
                  type="button"
                  className="zh-pill zh-pill--primary"
                  title="修复图片：选导出文件夹"
                  onClick={() => localFile ? openDocumentFolder(true) : repairImages(true)}
                >
                  加载资源文件夹
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
                  <b>{issues.math}</b> 个公式需要修复
                  {issues.mathHard > 0 && <>，其中 <b>{issues.mathHard}</b> 个需要手动编辑</>}
                </span>
                {issues.math > issues.mathHard && (
                  <button type="button" className="zh-pill zh-pill--primary" title="一键修复公式" onClick={fixMath}>
                    一键修复公式
                  </button>
                )}
              </>
            )}
            {issues.raw > 0 && (
              <>
                <span className="zh-fixbar__text">
                  📄 有 <b>{issues.raw}</b> 处公式文本尚未转换
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
              title="关闭提示"
              onClick={() => setIssuesHidden(true)}
            >
              ✕
            </button>
          </div>
        )
      )}

      <div className={`editor-shell${!reading && workspace.visible && workspaceRoot ? ' editor-shell--workspace' : ''}`}>
        {workspace.visible && workspaceRoot && <WorkspacePanel name={workspaceRoot.name} files={workspace.files}
          editor={editor} drafts={workspaceDrafts} onOpenResult={(result) => void openWorkspaceResult(result)}
          active={activeWorkspaceFile} status={workspace.status} backlinks={backlinks} onOpen={(file) => void openWorkspaceFile(file)}
          onChoose={workspace.choose} onReconnect={workspace.reconnect} onRefresh={() => void workspace.refresh(workspaceRoot)}
          onClose={() => workspace.setVisible(false)} onRename={setRenameFile} autoAssets={autoAssets}
          onAutoAssets={(enabled) => {
            setAutoAssets(enabled)
            try { localStorage.setItem('dadealbit-auto-assets', enabled ? 'on' : 'off') } catch { /* 当前会话仍可使用。 */ }
          }} />}
        <div className="editor-card" data-writing-focus={!reading && writingFocus || undefined}>
          <input
            className="zh-title"
            value={title}
            readOnly={reading}
            maxLength={100}
            placeholder="请输入标题（最多 100 个字）"
            onChange={(e) => {
              if (reading) return
              titleRef.current = e.target.value
              setTitle(e.target.value)
              scheduleSave()
            }}
          />
          {includeContents && editor && <PrintContents editor={editor} title={title} />}
          <div className="zh-editor-body" onClickCapture={(event) => {
            if (!LOCAL_FILE_EDITING || !(event.target instanceof Element)) return
            const path = event.target.closest('.ProseMirror a[href]')?.getAttribute('href')
            if (!path || !isLocalVideoLink(path)) return
            event.preventDefault()
            event.stopPropagation()
            setLocalVideo({ id: currentId, path })
          }}>
            <EditorContent editor={editor} />
            {LOCAL_FILE_EDITING && editor && <ScholarBibliography editor={editor} />}
          </div>
        </div>

        {/* 光标进表格时，表格上方浮出加行 / 加列 / 删除等操作 */}
        {!reading && <TableMenu editor={editor} />}
        {!reading && <ImageMenu editor={editor} />}

        {outlineOpen && LOCAL_FILE_EDITING && editor && <ChapterOutline editor={editor} includeContents={includeContents}
          onContentsChange={(enabled) => setDocumentOption('exportContents', enabled)} onClose={() => setOutlineOpen(false)} />}
        {outlineOpen && !LOCAL_FILE_EDITING && (
          <aside className="zh-outline">
            <div className="zh-outline__head">
              <span>大纲</span>
              <button type="button" className="zh-outline__close" onClick={() => setOutlineOpen(false)}>
                ✕
              </button>
            </div>
            {outline.length === 0 ? (
              <div className="zh-outline__empty">当前文档无标题</div>
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
        localFileName={localFile?.handle.name}
        localFileStatus={localOperation === currentId ? '正在处理本地文件'
          : diskStatus?.file === localFile && diskStatus?.id === currentId && diskStatus.md === storedMarkdown && diskStatus.saved
            ? '已保存到原文件' : '原文件有待保存的改动'}
        onToggleMarkdownInput={toggleMarkdownInput}
        onExport={requestSave}
      />

      {sourceEdit && <MarkdownSourceModal initial={sourceEdit.initial} onPreview={previewSource} onReview={checkSource}
        onApply={applyMarkdownSource} onSave={saveCurrentFile}
        onClose={() => {
          setSourceEdit(null)
          requestAnimationFrame(() => {
            if (!document.querySelector('.zh-modal-mask')) editorRef.current?.commands.focus()
          })
        }} />}

      {assetDocumentId === currentId && editor && !reading && <DocumentAssetsModal key={assetDocumentId}
        editor={editor} scope={assetScope} canApply={() => currentIdRef.current === assetDocumentId}
        onClose={() => setAssetDocumentId(undefined)} onApplied={(count) => {
          setAssetDocumentId(undefined)
          scheduleSave()
          scanIssues()
          flash(`已修复 ${count} 处素材引用。`)
        }} />}
      {localVideo?.id === currentId && <LocalVideoModal key={localVideo.id + ':' + localVideo.path}
        path={localVideo.path} scope={assetScope} onClose={() => setLocalVideo(undefined)} />}
      {renameFile && <WorkspaceRenameModal file={renameFile} files={workspace.files} onCommit={renameWorkspaceFile}
        onClose={() => setRenameFile(undefined)} />}
      {publicationOpen && <PublicationLayoutModal initial={publication} onClose={() => setPublicationOpen(false)} onApply={(layout) => {
        savePublicationLayout(layout)
        setPublication(layout)
        setPublicationOpen(false)
        flash('已更新 Word 与 PDF 的排版设置。')
      }} />}

      {equationToolsOpen && editor && <EquationToolsModal editor={editor} automatic={numberEquations}
        onToggle={(enabled) => setDocumentOption('numberEquations', enabled)} onClose={() => setEquationToolsOpen(false)}
        onJump={(pos) => {
          setEquationToolsOpen(false)
          gotoEquation(editor, pos)
        }}
        onInsert={(pos) => {
          if (!insertEquationReference(editor, pos)) return
          setEquationToolsOpen(false)
          scheduleSave()
        }} />}

      {objectToolsOpen && editor && <ObjectToolsModal editor={editor} onClose={() => setObjectToolsOpen(false)} />}
      {editionBlockPicker && editor && <EditionBlockPicker onClose={() => setEditionBlockPicker(false)} onPick={(kind) => {
        setEditionBlockPicker(false)
        if (!insertEditionBlock(editor, kind)) flash('无法标记所选内容。请选择完整的正文段落。')
      }} />}
      {editionRequest && editor && <EditionModal editor={editor} request={editionRequest} typography={typography}
        publication={publication} onFeedback={flash} onClose={() => setEditionRequest(null)} />}
      {scholarTab && editor && <ScholarTools key={scholarTab} editor={editor} tab={scholarTab} onClose={() => setScholarTab(null)} />}
      {comparison && <VersionCompareModal comparison={comparison} feedback={compareFeedback}
        onRestore={restoreVersionChange} onClose={() => setComparison(null)} />}

      {exportReview && editor && <ExportPreflightModal review={exportReview}
        onTarget={exportReview.resume ? undefined : reviewExport}
        onClose={() => setExportReview(null)}
        onLocate={(pos) => {
          setExportReview(null)
          gotoDocumentNode(editor, pos)
        }}
        onContinue={exportReview.resume ? () => {
          const format = exportReview.resume
          setExportReview(null)
          if (format) {
            if (format === 'pdf') requestAnimationFrame(() => void saveAs(format))
            else void saveAs(format)
          }
        } : undefined} />}

      {folderDocuments.length > 0 && (
        <div className="zh-modal-mask" onKeyDown={(event) => {
          if (event.key === 'Escape') setFolderDocuments([])
        }}>
          <div className="zh-modal" role="dialog" aria-modal="true" aria-label="选择要打开的文档">
            <div className="zh-modal__head">选择要打开的文档</div>
            <div className="zh-modal__body zh-local-documents">
              {folderDocuments.map(({ handle, directory }, index) => (
                <button type="button" className="zh-btn-plain" key={index} autoFocus={index === 0} onClick={() => {
                  setFolderDocuments([])
                  void openLocalMarkdown(handle, directory).catch(() => flash('无法读取本地文档。'))
                }}>{handle.name}</button>
              ))}
            </div>
            <div className="zh-modal__footer">
              <button type="button" className="zh-btn-plain" onClick={() => setFolderDocuments([])}>取消</button>
            </div>
          </div>
        </div>
      )}

      {localConflict === currentId && localFile && (
        <div className="zh-modal-mask" onKeyDown={(event) => {
          if (event.key === 'Escape' && !localOperation) setLocalConflict(null)
        }}>
          <div className="zh-modal" role="alertdialog" aria-modal="true" aria-labelledby="zh-local-conflict-title">
            <div className="zh-modal__head" id="zh-local-conflict-title">原文件已在外部修改</div>
            <div className="zh-modal__body">
              <p>「{localFile.handle.name}」与打开时的内容不同。</p>
              <p>重新加载会把当前草稿保留到版本历史。也可将当前内容另存为副本。</p>
              {localConflictError && <p role="alert">{localConflictError}</p>}
            </div>
            <div className="zh-modal__footer">
              <button type="button" className="zh-btn-plain" autoFocus disabled={!!localOperation} onClick={() => setLocalConflict(null)}>取消</button>
              <button type="button" className="zh-btn-plain" disabled={!!localOperation} onClick={saveFileCopy}>另存副本</button>
              <button type="button" className="zh-btn-solid" disabled={!!localOperation} onClick={reloadLocalFile}>重新加载原文件</button>
            </div>
          </div>
        </div>
      )}

      <MathModal
        open={mathOpen}
        macros={mathOpen && editor ? documentMacros(editor.state.doc).macros : undefined}
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
      <SearchBox editor={editor} open={searchOpen} docs={activeDocs} currentId={currentId} onSwitch={switchDoc}
        onClose={() => setSearchOpen(false)} />
      <FeedbackModal
        open={feedbackOpen}
        onClose={() => setFeedbackOpen(false)}
        wordCount={wordCount}
        sessionMs={sessionMs()}
        totalMs={totalUsageMs(sessionStartedAt())}
      />
      <ShortcutModal open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
      {zhihuOpen && !zhihuUnlocked && (
        <CircleEntry onPass={() => setZhihuUnlocked(true)} onClose={() => setZhihuOpen(false)} />
      )}
      <ZhihuModal
        open={zhihuOpen && zhihuUnlocked}
        editor={editor}
        title={title}
        onClose={() => setZhihuOpen(false)}
        onRepairImages={(done) => repairImages(true, done)}
      />
    </div>
  )
}
