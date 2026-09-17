import { useCallback, useEffect, useRef, useState } from 'react'
import type { Editor } from '@tiptap/core'
import { useEscapeClose } from './useEscapeClose'
import { exportZhihuMarkdown } from './saveFormats'
import { loadImageBedConfig, saveImageBedConfig, type ImageBedConfig } from './imageBed'

/** 默认图床仓库（用户自己的公开仓库，图片放这里换公开网址） */
const DEFAULT_BED_REPO = 'Dadeal167/Dadeal.bit-ImageBed'

interface Props {
  open: boolean
  editor: Editor | null
  title: string
  onClose(): void
}

const TOKEN_KEY = 'md-editor-zhihu-v1'
const ADDR_KEY = 'md-editor-zhihu-addr-v1'
const DEFAULT_ADDR = 'http://127.0.0.1:5174'

interface Result {
  ok: boolean
  saved?: boolean
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

/** 图片：把 base64 留在 HTML 里交给助手处理（助手会用剪贴板贴图，让知乎自己托管） */
function prepareZhihuHtml(html: string): { html: string; images: number; videos: number } {
  const images = imageCountOf(html)
  const videos = (html.match(/data-video-src=/g) ?? []).length
  return { html, images, videos }
}

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
export default function ZhihuModal({ open, editor, title, onClose }: Props) {
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
  /** 图床设置（不用助手时，编辑器直接用 GitHub 令牌上传） */
  const [bed, setBed] = useState<ImageBedConfig>(() => {
    const saved = loadImageBedConfig()
    return saved.repo ? saved : { repo: DEFAULT_BED_REPO, token: saved.token }
  })
  const [bedOpen, setBedOpen] = useState(false)
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

  useEffect(() => {
    if (!open) return
    setResult(null)
    setPhase('')
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
  }, [open, probe])

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
    const out = await exportZhihuMarkdown(editor, title, { onPhase: setPhase })
    setPhase('')
    setBusy(false)
    setExportMsg(out)
  }

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
      setLoginMsg('连不上助手，先确认「启动知乎助手.bat」的窗口还开着')
    }
  }

  const upload = async () => {
    if (!editor) return
    const { html, images: hasImages, videos } = prepareZhihuHtml(editor.getHTML())

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
                ? '正在贴图片（第一张会比较慢，要等知乎托管）…'
                : '正在插入公式…'
              : hasImages
                ? '正在等知乎存草稿（有图片时可能要几分钟，别关窗口）…'
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
          `这篇有 ${imageCountOf(html)} 张图片：上传时助手会打开一个浏览器窗口（贴图要用系统剪贴板，也会暂时占用你的剪贴板）`,
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
          : '连不上助手。请先双击「启动知乎助手.bat」并保持那个窗口开着，然后把窗口里显示的令牌填到上面。',
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
                · 公式换成知乎认的写法，导入后是**可编辑的公式节点**；本机图片会自动上传到你的图床、
                换成公开网址（这样知乎导入能把图一起带过去）
              </div>
              <div>
                · 拿不到公开网址时（助手没开、也没填图床令牌）**不会给你文件**，会直接告诉你先开哪一个 ——
                免得又拿到一份"图片进不去"的 .md
              </div>
              <div>· 标题、加粗、列表、引用、代码块、表格都照常带过去；标题要单独填，点「复制标题」</div>
              <div>
                · 给知乎看的那份里，公式在别的软件里是一个指向知乎的链接，别的软件抓不到就显示"加载图片失败"
                —— 那是它们的限制，**不影响知乎导入**（知乎读的是标签里的 LaTeX 原文）
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
                      : '还没配置完整：没配置时导出仍可用，只是本机图片会留在文件里 + 每张一行提示'}
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="zh-zhihu__or">或者：让本机助手直接存到知乎草稿箱</div>

          <div className={`zh-zhihu__state zh-zhihu__state--${assistantUp === null ? 'wait' : assistantUp ? 'ok' : 'bad'}`}>
            {assistantUp === null
              ? '正在检查助手…'
              : assistantUp
                ? '✅ 助手已连接'
                : '❌ 没检测到助手：先双击项目里的「启动知乎助手.bat」，并保持窗口开着'}
            {assistantUp && (
              <button type="button" className="zh-zhihu__login" onClick={openLogin}>
                登录知乎 / 检查登录
              </button>
            )}
          </div>
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
          <button type="button" className="zh-zhihu__recheck" onClick={() => probe(addr, token)}>
            重新检测助手
          </button>

          <div className="zh-zhihu__tips">
            <div>· 存的是一篇**草稿**，你可以在知乎草稿箱里继续改，确认没问题再自己发布</div>
            <div>· 同一个文档重复上传会**更新同一篇草稿**，不会在草稿箱里堆一堆</div>
            <div>· 公式会原样变成知乎的公式节点（可再编辑）；文字颜色、标题、列表、引用、代码块、表格都能带过去</div>
            <div>· 图片也可以：会自动用剪贴板贴进去，由知乎自己托管（有图时会弹出一个浏览器窗口）</div>
          </div>

          {phase && (
            <div className="zh-zhihu__phase">
              ⏳ {phase}（纯文字约 40 秒；有图片时要等知乎上传，可能几分钟，请别关窗口）
            </div>
          )}

          {result && (
            <div className={`zh-zhihu__result zh-zhihu__result--${result.ok ? 'ok' : 'bad'}`}>
              {result.ok ? (
                <>
                  <div>✅ 已存进知乎草稿箱：{result.title}</div>
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
            title={assistantUp === false ? '还没检测到助手：确认「启动知乎助手.bat」的窗口开着、令牌填对了' : ''}
            onClick={upload}
          >
            {busy ? '正在上传…' : '存到草稿箱'}
          </button>
        </div>
      </div>
    </div>
  )
}
