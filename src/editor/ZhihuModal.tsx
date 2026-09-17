import { useCallback, useEffect, useRef, useState } from 'react'
import type { Editor } from '@tiptap/core'
import { useEscapeClose } from './useEscapeClose'
import { exportZhihuMarkdown } from './saveFormats'
import { loadImageBedConfig, saveImageBedConfig, type ImageBedConfig } from './imageBed'
import { localImageBlockText, zhihuImageStats, type ZhihuImageStats } from './zhihuImages'

/** 默认图床仓库（用户自己的公开仓库，图片放这里换公开网址） */
const DEFAULT_BED_REPO = 'Dadeal167/Dadeal.bit-ImageBed'

interface Props {
  open: boolean
  editor: Editor | null
  title: string
  onClose(): void
  /** 点「选图片文件夹修复」：父组件走修复流程（选文件夹 → 按文件名嵌进文档），完了回调 done() 让面板重新体检 */
  onRepairImages?: (done: () => void) => void
}

const TOKEN_KEY = 'md-editor-zhihu-v1'
const ADDR_KEY = 'md-editor-zhihu-addr-v1'
const DEFAULT_ADDR = 'http://127.0.0.1:5174'

interface Result {
  ok: boolean
  saved?: boolean
  /** 这次是"更新了同名的旧草稿"（true）还是"新建了一篇"（false） */
  reusedDraft?: boolean
  /** 失败时助手存下来的现场目录（截图 + 页面 + 日志），发出去就能定位问题 */
  failureDir?: string | null
  title?: string
  previewText?: string
  formulasInserted?: number
  formulasFailed?: number
  formulasInDraft?: number
  imagesInserted?: number
  imagesFailed?: number
  imagesExpected?: number
  imagesInDraft?: number
  warnings?: string[]
  error?: string
  needLogin?: boolean
}

/** 自检结果：助手拿一篇临时草稿把正文 / 公式 / 图片 / 表格各跑一遍 */
interface SelfCheckResult {
  ok: boolean
  steps?: { name: string; ok: boolean; detail?: string }[]
  summary?: string
  note?: string
  error?: string
  title?: string
}

/** 图片：把 base64 留在 HTML 里交给助手处理（助手整篇一次粘过去，知乎自己接管托管） */
function prepareZhihuHtml(html: string): { html: string; images: number; videos: number } {
  const images = imageCountOf(html)
  const videos = (html.match(/data-video-src=/g) ?? []).length
  return { html, images, videos }
}

/** 内嵌 data: 图片的张数（这些知乎会接手托管） */
const imageCountOf = (html: string) => (html.match(/<img[^>]*src="data:/g) ?? []).length
/** 正文是不是真的空的（只去看 HTML 里的文字） */
function looksEmpty(html: string): boolean {
  const text = html
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .trim()
  const hasMedia = /<img|data-video-src|data-latex/.test(html)
  return text.length === 0 && !hasMedia
}

/** 「存到知乎草稿箱」：通过本机助手（scripts/zhihu-assistant.mjs）驱动你已登录的知乎写作页 */
export default function ZhihuModal({ open, editor, title, onClose, onRepairImages }: Props) {
  /** 导出 .md 的反馈（和助手上传的 result 分开，互不干扰） */
  const [exportMsg, setExportMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [addr, setAddr] = useState(() => {
    try {
      return localStorage.getItem(ADDR_KEY) ?? DEFAULT_ADDR
    } catch {
      return DEFAULT_ADDR
    }
  })
  const [token, setToken] = useState(() => {
    try {
      return localStorage.getItem(TOKEN_KEY) ?? ''
    } catch {
      return ''
    }
  })
  const [busy, setBusy] = useState(false)
  const [phase, setPhase] = useState('')
  const [result, setResult] = useState<Result | null>(null)
  const [assistantUp, setAssistantUp] = useState<boolean | null>(null)
  const [loginMsg, setLoginMsg] = useState<string | null>(null)
  const [selfChecking, setSelfChecking] = useState(false)
  const [selfCheck, setSelfCheck] = useState<SelfCheckResult | null>(null)
  /** 图床设置（不用助手时，编辑器直接用 GitHub 令牌上传） */
  const [bed, setBed] = useState<ImageBedConfig>(() => {
    const saved = loadImageBedConfig()
    return saved.repo ? saved : { repo: DEFAULT_BED_REPO, token: saved.token }
  })
  const [bedOpen, setBedOpen] = useState(false)
  /** 推送前的图片体检：本地路径的图片知乎拿不到，必须当场拦下来（见 zhihuImages.ts） */
  const [imgCheck, setImgCheck] = useState<ZhihuImageStats | null>(null)
  const timer = useRef<number | null>(null)
  const probeSeq = useRef(0)
  const abortRef = useRef<AbortController | null>(null)

  // 上传中不让 Esc 关掉面板（否则进度和结果都看不到，用户会以为没在跑）
  useEscapeClose(open && !busy, onClose)

  /* 探测助手（打开时、改地址时、令牌失焦时都会重测）
     - 令牌走请求头，不放 URL（避免留在日志/历史里）
     - 用序号丢弃过期响应：先发的慢响应不能覆盖后发的快响应 */
  const probe = useCallback((nextAddr: string, nextToken: string) => {
    const seq = ++probeSeq.current
    setAssistantUp(null)
    fetch(`${nextAddr}/status`, { method: 'GET', headers: { 'x-dadealbit-token': nextToken } })
      .then(async (r) => {
        const j = (await r.json().catch(() => null)) as { ok?: boolean } | null
        if (seq === probeSeq.current) setAssistantUp(r.ok && j?.ok === true)
      })
      .catch(() => {
        if (seq === probeSeq.current) setAssistantUp(false)
      })
  }, [])

  /** 图片体检：本地相对路径的图片知乎读不到，推送前必须拦住（面板打开时 / 修复完 / 推送前各查一次） */
  const recheckImages = useCallback(() => {
    setImgCheck(editor ? zhihuImageStats(editor.getHTML()) : null)
  }, [editor])

  useEffect(() => {
    if (!open) return
    setResult(null)
    setPhase('')
    recheckImages()
    // 每次打开面板都重新读一遍配置：启动器可能刚把令牌写进 localStorage（见 ZhihuEditor 里的
    // 「#zhihu-token=…」处理），而面板是在编辑器第一次渲染时就挂载的，不重读会拿着旧值。
    let nextAddr = DEFAULT_ADDR
    let nextToken = ''
    try {
      nextAddr = localStorage.getItem(ADDR_KEY) || DEFAULT_ADDR
      nextToken = localStorage.getItem(TOKEN_KEY) || ''
    } catch {
      /* 读不到就用默认值 */
    }
    setAddr(nextAddr)
    setToken(nextToken)
    probe(nextAddr, nextToken)
    // 依赖里**不要**放 addr / token：`save()` 只在失焦时才写 localStorage，
    // 一旦 addr 进了依赖，打字 → 重跑本效果 → 从 localStorage 读回旧值 → 把刚打的字改回去，
    // 地址栏会变成完全打不进字（audit:zhihu 逮到过这个）。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, probe, recheckImages])

  useEffect(() => {
    return () => {
      if (timer.current) window.clearInterval(timer.current)
      abortRef.current?.abort()
    }
  }, [])

  if (!open) return null

  const save = () => {
    try {
      localStorage.setItem(TOKEN_KEY, token)
      localStorage.setItem(ADDR_KEY, addr)
    } catch {
      /* 存不下就算了 */
    }
  }

  /** 导出「给知乎导入用的 .md」
   *  实现放在 saveFormats.ts —— 工具栏「保存」菜单、右下角按钮、这个面板用的是同一份逻辑，
   *  省得三处行为不一致（用户就因为"保存 .md 直接拿去知乎导入"踩过坑）。 */
  const exportZhihuMd = async () => {
    if (!editor) return
    save()
    setBusy(true)
    setExportMsg(null)
    // ⚠️ 必须 try/finally：中间任何一步抛错（序列化、非网络类异常）都要把 busy 放回去，
    // 否则按钮永久 disabled、面板关掉再开也没用，只能刷新页面
    try {
      const out = await exportZhihuMarkdown(editor, title, { onPhase: setPhase })
      setExportMsg(out)
    } catch (e) {
      setExportMsg({ ok: false, text: '导出失败：' + String(e).slice(0, 120) })
    } finally {
      setPhase('')
      setBusy(false)
    }
  }

  /** 自检：让助手拿一篇临时草稿真跑一遍（正文 / 公式 / 图片 / 表格），给一句人话结论 */
  const runSelfCheckNow = async () => {
    save()
    setSelfChecking(true)
    setSelfCheck(null)
    try {
      const ctrl = new AbortController()
      // 注意别用 `const timer`：外面已经有一个叫 timer 的 ref，同名会把它遮住，
      // 关面板时就清不掉这个 180 秒的超时了（自检/请求还会继续跑）
      const timeoutId = window.setTimeout(() => ctrl.abort(), 180000)
      const res = await fetch(`${addr}/selfcheck`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-dadealbit-token': token },
        body: '{}',
        signal: ctrl.signal,
      })
      window.clearTimeout(timeoutId)
      const json = (await res.json()) as SelfCheckResult
      setSelfCheck(json)
      probe(addr, token)
    } catch (e) {
      setSelfCheck({ ok: false, error: '连不上助手或自检超时：' + String(e).slice(0, 120) })
    } finally {
      setSelfChecking(false)
    }
  }

  /** 双击打开的 HTML 时，算出"同文件夹里的启动器"完整路径 ——
   *  浏览器不允许网页自己拉起本地程序（实测：file:// 页面点 .bat 链接只会跳过去、不会执行），
   *  所以「复制路径」这个按钮得有个值可复制。
   *
   *  ⚠️ 但**不要把它打印在界面上**：那串东西又长又技术、还带着用户名（用户提过这个），
   *  而且分享版根本没有这个文件 —— 显出来只会让人去找一个不存在的东西。 */
  const launcherPath = (() => {
    try {
      if (location.protocol !== 'file:') return ''
      const p = decodeURIComponent(location.pathname).replace(/^\//, '').replace(/\//g, '\\')
      const dir = p.slice(0, p.lastIndexOf('\\'))
      return dir ? `${dir}\\开始使用.bat` : ''
    } catch {
      return ''
    }
  })()

  /** 复制标题（知乎导入不带标题，需要在知乎里单独填） */
  const copyTitle = async () => {
    const t = title.trim() || '未命名文档'
    try {
      await navigator.clipboard.writeText(t)
      setExportMsg({ ok: true, text: `标题已复制：${t} —— 去知乎标题栏粘一下就行` })
    } catch {
      setExportMsg({ ok: false, text: `没能自动复制，标题是：${t}（手动选中复制一下）` })
    }
  }

  /** 打开一个浏览器窗口让你登录知乎（登录一次即可，助手会记住） */  const openLogin = async () => {
    save()
    setLoginMsg('正在打开浏览器窗口…')
    try {
      const res = await fetch(`${addr}/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-dadealbit-token': token },
        body: JSON.stringify({}),
      })
      const json = (await res.json()) as { ok?: boolean; loggedIn?: boolean; hint?: string; error?: string }
      setLoginMsg(json.hint ?? json.error ?? (json.loggedIn ? '已经登录了' : '请在弹出的窗口里扫码登录'))
    } catch {
      setLoginMsg('连不上助手：先双击助手包里的「开始使用.bat」（它会在后台把助手拉起来）')
    }
  }

  const upload = async () => {
    if (!editor) return
    const { html, images: hasImages, videos } = prepareZhihuHtml(editor.getHTML())

    // 本地路径的图片知乎拿不到：传过去只会得到「图片导入失败，请重新上传」，所以在这里就拦住
    // （助手那边也会拦一道，见 scripts/zhihu-assistant.mjs —— 两边都堵，才不会被绕过）
    const stats = zhihuImageStats(html)
    setImgCheck(stats)
    if (stats.local > 0) {
      setResult({ ok: false, error: localImageBlockText(stats) })
      return
    }

    // 空正文直接拦住：助手会先清空知乎草稿，空内容等于把草稿清掉
    if (looksEmpty(html)) {
      setResult({
        ok: false,
        error: '正文是空的，先写点东西再传。助手上传前会清空知乎上那篇草稿，空内容会把它清掉，所以这里直接拦住了。',
      })
      return
    }

    save()
    setBusy(true)
    setResult(null)
    // 先给个进度提示（一次上传大约要 40 秒：填内容 + 插公式 + 等自动保存 + 刷新校验）
    let seconds = 0
    setPhase('正在连接助手…')
    timer.current = window.setInterval(() => {
      seconds += 2
      setPhase(
        seconds < 8
          ? '正在打开知乎写作页…'
          : seconds < 20
            ? '正在填入标题与正文…'
            : seconds < 34
              ? hasImages
                ? '正在一张张贴图片（走剪贴板真粘贴，每张几秒；会占着你的剪贴板）…'
                : '正在插入公式…'
              : hasImages
                ? '正在等知乎存草稿（图片多时要一两分钟，别关助手那个浏览器窗口）…'
                : '正在等知乎自动保存并校验…',
      )
    }, 2000)

    // 有图片时整篇要几分钟，超时给足；超时后明确告诉用户"可能还在跑"
    const controller = new AbortController()
    abortRef.current = controller
    const timeoutMs = hasImages ? 12 * 60 * 1000 : 5 * 60 * 1000
    const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs)

    try {
      const res = await fetch(`${addr}/draft`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-dadealbit-token': token },
        body: JSON.stringify({ title: title.trim() || '未命名文档', html }),
        signal: controller.signal,
      })
      const json = (await res.json()) as Result
      const extra: string[] = []
      if (imageCountOf(html) > 0) {
        extra.push(
          `这篇有 ${imageCountOf(html)} 张图片：知乎收到后要自己重新托管一遍，图片多的时候最后那几秒会稍慢`,
        )
      }
      if (videos > 0) extra.push(`有 ${videos} 个视频没有同步（知乎这边只放了原始链接，需要的话手动补一下）`)
      if (!json.ok && !json.error) {
        json.error = '没成功：可能是内容没存住或部分内容漏了，请到知乎草稿箱看一眼这篇。'
      }
      json.warnings = [...(json.warnings ?? []), ...extra]
      setResult(json)
    } catch (e) {
      const aborted = (e as Error)?.name === 'AbortError'
      setResult({
        ok: false,
        error: aborted
          ? `等了 ${Math.round(timeoutMs / 60000)} 分钟还没结果。助手可能还在传（草稿箱里可能已经有了），可以先去知乎看一眼；如果一直没有，说明卡住了，重开一次助手再试。`
          : '连不上助手。先双击助手包里的「开始使用.bat」——它会在后台启动助手并把令牌自动填好；手动那条路是「启动知乎助手.bat」，窗口里会打印令牌。',
      })
    } finally {
      window.clearTimeout(timeoutId)
      abortRef.current = null
      if (timer.current) window.clearInterval(timer.current)
      timer.current = null
      setBusy(false)
      setPhase('')
    }
  }

  return (
    <div
      className="zh-modal-mask"
      onMouseDown={(e) => {
        // 上传中不允许点遮罩关闭：否则进度和结果都看不到，用户会以为没在跑
        if (e.target === e.currentTarget && !busy) onClose()
      }}
    >
      <div className="zh-modal zh-modal--zhihu" role="dialog" aria-modal="true" aria-label="存到知乎草稿箱">
        <div className="zh-modal__head">
          <span>
            存到知乎草稿箱
            <span className="zh-modal__sub">只存草稿，不会发布</span>
          </span>
          <button type="button" className="zh-modal__close" onClick={onClose} aria-label="关闭">
            ✕
          </button>
        </div>

        <div className="zh-modal__body">
          {/* 推荐路线：导出 .md，用知乎自带的「导入 Markdown」 */}
          <div className="zh-zhihu__export">
            <div className="zh-zhihu__export-title">推荐：导出 .md，用知乎自带的「导入」</div>
            <ol className="zh-zhihu__export-steps">
              <li>点下面的「导出知乎 .md」，文件会存到浏览器的下载文件夹</li>
              <li>打开知乎 → 写文章 → 编辑器右上角「导入」→ 选这个文件</li>
              <li>标题要单独填，点「复制标题」粘过去即可</li>
            </ol>
            <div className="zh-zhihu__export-btns">
              <button type="button" className="zh-pill zh-pill--primary" onClick={exportZhihuMd}>
                导出知乎 .md
              </button>
              <button type="button" className="zh-pill" onClick={copyTitle}>
                复制标题
              </button>
            </div>
            <div className="zh-zhihu__tips">
              <div>
                · 这条路是"要一份能带走的 .md"用的（发给同学、传别的平台、以后重新导入知乎）。
                公式换成知乎认的写法；本机图片会上传到你的图床换成公开网址
              </div>
              <div>
                · 只想发知乎的话，直接点下面的「存到草稿箱」更省事：正文 / 公式 / 图片一次过去，
                图片由知乎自己托管，不用图床、也不用在知乎里手动导入
              </div>
              <div>
                · 拿不到公开网址时（助手没开、也没填图床令牌）文件照样给，但那几张图上面会各加一行
                `&gt; 🖼️` 提示 —— 知乎导入时会丢这几张，需要手动补
              </div>
              <div>· 标题、加粗、列表、引用、代码块、表格都照常带过去；标题要单独填，点「复制标题」</div>
              <div>
                · 给知乎看的那份里，公式在别的软件里是一个指向知乎的链接，别的软件抓不到就显示"加载图片失败"
                —— 那是它们的限制，不影响知乎导入（知乎读的是标签里的 LaTeX 原文）
              </div>
            </div>
            {exportMsg && (
              <div className={`zh-zhihu__result zh-zhihu__result--${exportMsg.ok ? 'ok' : 'bad'}`}>{exportMsg.text}</div>
            )}

            {/* 图床设置：不开助手也能把图片换成公开网址（编辑器直接用你的 GitHub 令牌上传） */}
            <div className="zh-zhihu__bed">
              <button
                type="button"
                className="zh-zhihu__bed-toggle"
                onClick={() => setBedOpen((v) => !v)}
                aria-expanded={bedOpen}
              >
                {bedOpen ? '▾' : '▸'} 图床设置（不开助手也能让图片进知乎）
                <span className={`zh-zhihu__bed-dot${bed.repo && bed.token ? ' zh-zhihu__bed-dot--on' : ''}`} />
              </button>
              {bedOpen && (
                <div className="zh-zhihu__bed-body">
                  <div className="zh-zhihu__tips">
                    <div>
                      · 开了助手时不用管这里：导出时图片会自动上传（助手走的是本机 git，不需要令牌）
                    </div>
                    <div>
                      · 没开助手 / 用的是分享版：在这里填一次「图床仓库 + GitHub 令牌」，
                      以后导出「导出知乎 .md」时图片会由编辑器直接传上去、换成公开网址，知乎导入就能把图带过去
                    </div>
                    <div>
                      · 令牌只存在这台电脑的浏览器里，只发给 api.github.com；建议用 fine-grained 令牌，
                      只勾选图床这一个仓库的 <b>Contents: Read and write</b>
                    </div>
                  </div>
                  <label className="zh-zhihu__field">
                    <span>图床仓库</span>
                    <input
                      type="text"
                      value={bed.repo}
                      placeholder={DEFAULT_BED_REPO}
                      onChange={(e) => setBed({ ...bed, repo: e.target.value })}
                      onBlur={() => saveImageBedConfig(bed)}
                    />
                  </label>
                  <label className="zh-zhihu__field">
                    <span>GitHub 令牌</span>
                    <input
                      type="password"
                      value={bed.token}
                      placeholder="粘贴 GitHub 令牌（只勾选图床仓库的 Contents 读写）"
                      onChange={(e) => setBed({ ...bed, token: e.target.value })}
                      onBlur={() => saveImageBedConfig(bed)}
                    />
                  </label>
                  <div className="zh-zhihu__bed-actions">
                    <button
                      type="button"
                      className="zh-pill"
                      onClick={() => {
                        saveImageBedConfig(bed)
                        setExportMsg({
                          ok: true,
                          text: '图床设置已保存（存在这台电脑的浏览器里）。现在导出「导出知乎 .md」时，本机图片会自动上传换成公开网址。',
                        })
                      }}
                    >
                      保存图床设置
                    </button>
                    {bed.token && (
                      <button
                        type="button"
                        className="zh-pill"
                        onClick={() => {
                          const cleared = { ...bed, token: '' }
                          setBed(cleared)
                          saveImageBedConfig(cleared)
                          setExportMsg({ ok: true, text: '令牌已清掉（图床设置里的仓库名还留着）。' })
                        }}
                      >
                        清掉令牌
                      </button>
                    )}
                  </div>
                  <div className="zh-zhihu__msg">
                    {bed.repo && bed.token
                      ? `已配置：${bed.repo}（不开助手也能上传）`
                      : '还没配置完整：不配也能导出，只是本机图片换不到网址，会在每张图上面加一行提示'}
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="zh-zhihu__or">或者（推荐）：让本机助手直接存到知乎草稿箱 —— 不用图床</div>

          <div className={`zh-zhihu__state zh-zhihu__state--${assistantUp === null ? 'wait' : assistantUp ? 'ok' : 'bad'}`}>
            {assistantUp === null
              ? '正在检查助手…'
              : assistantUp
                ? '✅ 助手已连接'
                : '❌ 没检测到助手 —— 双击下面这个文件就能启动它'}
            {assistantUp && (
              <button type="button" className="zh-zhihu__login" onClick={openLogin}>
                登录知乎 / 检查登录
              </button>
            )}
          </div>
          {assistantUp === false && (
            <div className="zh-zhihu__msg">
              {/* 不打印绝对路径（又长又带用户名，而且分享版里根本没这个文件）——
                  只说"双击哪个文件"，需要完整路径时点按钮复制到剪贴板 */}
              <div>
                <b>没检测到助手。</b>要开箱即用（不弹黑窗口、带便携 Node）：
                去 GitHub Releases 下载「<b>知乎助手包</b>」，解压后双击里面的
                <b>「开始使用.bat」</b>。
              </div>
              <div>
                已经 clone 了仓库的话：先 <code>pnpm install</code>，再双击仓库根目录的
                <b>「启动知乎助手.bat」</b>（它需要本机已装 Node）。
              </div>
              <div>
                想以后再也不用管：助手包/自用包里双击一次
                「安装助手自启 autostart-on.bat」，之后开机它就在后台静默跑着。
              </div>
              <div className="zh-zhihu__row">
                {launcherPath && (
                  <button
                    type="button"
                    className="zh-zhihu__recheck"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(launcherPath)
                        setExportMsg({ ok: true, text: '路径已复制到剪贴板（界面上不显示，免得暴露你的用户名路径）。' })
                      } catch {
                        setExportMsg({ ok: false, text: '复制失败：可以手动在文件管理器里找到你放 HTML 的那个文件夹。' })
                      }
                    }}
                  >
                    复制本机路径
                  </button>
                )}
                <button type="button" className="zh-zhihu__recheck" onClick={() => probe(addr, token)}>
                  我已经启动了，重新检测
                </button>
              </div>
              <div>
                完全没有助手也行：在上面「图床设置」里填一次 GitHub 令牌，
                「保存」时导出 <b>知乎用 .md</b>，再到知乎写文章页用「导入文档」。
              </div>
              <div>
                （浏览器不允许网页自己启动本地程序，所以启动助手这步得你双击一下。）
              </div>
            </div>
          )}
          {loginMsg && <div className="zh-zhihu__msg">{loginMsg}</div>}

          <label className="zh-zhihu__field">
            <span>助手地址</span>
            <input
              type="text"
              value={addr}
              placeholder={DEFAULT_ADDR}
              onChange={(e) => setAddr(e.target.value)}
              onBlur={save}
            />
          </label>

          <label className="zh-zhihu__field">
            <span>助手令牌</span>
            <input
              type="text"
              value={token}
              placeholder="粘贴助手窗口里显示的令牌（启动时会自动复制到剪贴板）"
              onChange={(e) => setToken(e.target.value)}
              onBlur={() => {
                save()
                probe(addr, token)
              }}
            />
          </label>
          <div className="zh-zhihu__row">
            <button type="button" className="zh-zhihu__recheck" onClick={() => probe(addr, token)}>
              重新检测助手
            </button>
            <button
              type="button"
              className="zh-zhihu__recheck"
              onClick={runSelfCheckNow}
              disabled={selfChecking}
              title="拿一篇临时草稿真跑一遍：正文 / 公式 / 图片 / 表格能不能存进知乎"
            >
              {selfChecking ? '正在自检…（约半分钟）' : '检查一下能不能用（自检）'}
            </button>
          </div>

          {selfCheck && (
            <div className={`zh-zhihu__result zh-zhihu__result--${selfCheck.ok ? 'ok' : 'bad'}`}>
              <div>{selfCheck.summary ?? selfCheck.error ?? '自检没通过'}</div>
              <ul className="zh-zhihu__warn">
                {selfCheck.steps?.map((s) => (
                  <li key={s.name}>
                    {s.ok ? '✅' : '❌'} {s.name}
                    {s.detail ? `（${s.detail}）` : ''}
                  </li>
                ))}
              </ul>
              {selfCheck.note && <div className="zh-zhihu__dim">{selfCheck.note}</div>}
              {!selfCheck.ok && (
                <div className="zh-zhihu__row">
                  <button
                    type="button"
                    className="zh-zhihu__recheck"
                    onClick={async () => {
                      try {
                        const r = await fetch(`${addr}/snapshot`, {
                          method: 'POST',
                          headers: { 'content-type': 'application/json', 'x-dadealbit-token': token },
                          body: '{}',
                        }).then((x) => x.json())
                        setExportMsg(
                          r?.ok
                            ? { ok: true, text: `现场已存到：${r.failureDir}（把整个文件夹发给开发者即可）` }
                            : { ok: false, text: '存现场失败：' + (r?.error ?? '看助手窗口的日志') },
                        )
                      } catch (e) {
                        setExportMsg({ ok: false, text: '存现场失败：' + String(e).slice(0, 100) })
                      }
                    }}
                  >
                    把现场存下来（截图 + 页面 + 日志）
                  </button>
                </div>
              )}
            </div>
          )}

          <div className="zh-zhihu__tips">
            <div>· 存的是草稿，你可以在知乎草稿箱里继续改，确认没问题再自己发布；同名的会更新那一篇，不会越攒越多</div>
            <div>· 公式会原样变成知乎的公式节点（可再编辑）；文字颜色、标题、列表、引用、代码块、表格都能带过去</div>
            <div>· 正文（含公式）一次交完；<b>图片是一张张"真粘贴"进去的</b>（等同你自己复制粘贴一张图），
              位置会自动对上原文里该在的地方</div>
            <div>· 有图片时：助手会弹出一个浏览器窗口，期间**会占用你的剪贴板**（每张图约 5–10 秒），推完就还给你；
              全程走的是你本机的知乎登录态，只存草稿</div>
            <div>· 心里没底就点「检查一下能不能用（自检）」：它会拿一篇临时草稿（标题「Dadealbit 自检（可删）」）
              把正文 / 公式 / 图片 / 表格各跑一遍，通过再发真稿子</div>
          </div>

          {/* 本地路径的图片：知乎读不到，传过去只会是「图片导入失败」——所以在按钮上面就摆明 */}
          {imgCheck && imgCheck.local > 0 && (
            <div className="zh-zhihu__result zh-zhihu__result--bad zh-zhihu__imgwarn">
              <div>
                🖼 有 <b>{imgCheck.local}</b> 张图片还是本地路径
                {imgCheck.localNames.length ? `（${imgCheck.localNames.join('、')}${imgCheck.local > imgCheck.localNames.length ? ' 等' : ''}）` : ''}
                ：知乎读不到你电脑上的文件，这样传过去，草稿里只会显示「图片导入失败，请重新上传」。
              </div>
              <div className="zh-zhihu__row">
                {onRepairImages && (
                  <button type="button" className="zh-zhihu__recheck" onClick={() => onRepairImages(recheckImages)}>
                    选图片文件夹修复
                  </button>
                )}
                <button type="button" className="zh-zhihu__recheck" onClick={recheckImages}>
                  重新检查
                </button>
              </div>
              <div className="zh-zhihu__dim">
                点「选图片文件夹修复」，选那个装着 assets 的文件夹（例如「知乎导出_文章名」），
                编辑器会按文件名把图片嵌进文档 —— 嵌进去以后再传，图片由知乎自己托管。
              </div>
            </div>
          )}

          {phase && (
            <div className="zh-zhihu__phase">
              ⏳ {phase}（一般十几秒；图片多的时候知乎要多花几秒做托管，请别关窗口）
            </div>
          )}

          {result && (
            <div className={`zh-zhihu__result zh-zhihu__result--${result.ok ? 'ok' : 'bad'}`}>
              {result.ok ? (
                <>
                  <div>
                    {result.reusedDraft
                      ? `✅ 已更新你之前那篇同名草稿：${result.title}`
                      : `✅ 已存进知乎草稿箱（新建）：${result.title}`}
                  </div>
                  <div className="zh-zhihu__dim">
                    公式 {result.formulasInserted ?? 0} 个
                    {result.formulasFailed ? `（失败 ${result.formulasFailed} 个）` : ''}
                    {typeof result.imagesExpected === 'number' && result.imagesExpected > 0
                      ? ` · 图片 ${result.imagesInDraft ?? 0}/${result.imagesExpected} 张`
                      : ''}
                    {result.previewText ? ` · 草稿开头：${result.previewText.slice(0, 26)}…` : ''}
                  </div>
                </>
              ) : (
                <div>❌ {result.error ?? (result.needLogin ? '知乎没登录，请先点助手窗口里的登录' : '没有成功，请看下面的提示')}</div>
              )}
              {!!result.warnings?.length && (
                <ul className="zh-zhihu__warn">
                  {result.warnings.slice(0, 4).map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              )}
              {result.failureDir && (
                <div className="zh-zhihu__dim">
                  失败现场已经存下来了
                  <button
                    type="button"
                    className="zh-zhihu__recheck"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(String(result.failureDir))
                        setExportMsg({ ok: true, text: '失败现场的文件夹路径已复制到剪贴板。' })
                      } catch {
                        setExportMsg({ ok: false, text: '复制失败，可以到用户目录下的 .dadealbit\\failures 里找。' })
                      }
                    }}
                  >
                    复制路径
                  </button>
                  （里面有截图、当时的页面和日志 —— 把整个文件夹发给开发者，就能直接看出是不是知乎改版了。
                  界面上不直接显示完整路径，免得截图把用户名带出去。）
                </div>
              )}
            </div>
          )}
        </div>

        <div className="zh-modal__footer">
          <button type="button" className="zh-btn-plain" onClick={onClose}>
            关闭
          </button>
          <button
            type="button"
            className="zh-btn-solid"
            disabled={busy || !token.trim()}
            title={assistantUp === false ? '还没检测到助手：先双击助手包里的「开始使用.bat」，或确认助手窗口开着、令牌填对了' : ''}
            onClick={upload}
          >
            {busy ? '正在上传…' : '存到草稿箱'}
          </button>
        </div>
      </div>
    </div>
  )
}
