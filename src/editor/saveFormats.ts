/**
 * 「导出知乎用 .md」的唯一实现（工具栏「保存」菜单、右下角按钮、「知乎」面板都用这一份）。
 *
 * 这个出口做两件事：
 *   · 公式换成知乎认的写法（`$…$` 知乎的导入不认，会变成一堆乱码）
 *   · 本机图片先上传换成公开网址（知乎只认图片网址，内嵌 base64 会被丢掉）
 *
 * 图片换不到网址时**照样出文件**（用户 2026-09 定：硬拦住"先不导出"太不近人情），
 * 但那几张图上面会各加一行提示，反馈里也说清"会丢、需要手动补"，并推荐改用「存到草稿箱」——
 * 那条路图片直接由知乎托管，压根不需要图床。
 */
import type { Editor } from '@tiptap/core'
import { downloadText, getMarkdown } from './editorActions'
import { mdToZhihuMarkdown } from './zhihuMarkdown'
import { loadImageBedConfig, uploadToImageBed } from './imageBed'

export const ZHIHU_ADDR_KEY = 'md-editor-zhihu-addr-v1'
export const ZHIHU_TOKEN_KEY = 'md-editor-zhihu-v1'
export const DEFAULT_ZHIHU_ADDR = 'http://127.0.0.1:5174'

export interface ExportOutcome {
  ok: boolean
  text: string
}

function readZhihuConfig(): { addr: string; token: string } {
  try {
    return {
      addr: localStorage.getItem(ZHIHU_ADDR_KEY) ?? DEFAULT_ZHIHU_ADDR,
      token: localStorage.getItem(ZHIHU_TOKEN_KEY) ?? '',
    }
  } catch {
    return { addr: DEFAULT_ZHIHU_ADDR, token: '' }
  }
}

/** 助手在不在（很快的超时，别让导出卡住） */
async function assistantAlive(addr: string, token: string): Promise<boolean> {
  try {
    const ctrl = new AbortController()
    const t = window.setTimeout(() => ctrl.abort(), 1500)
    const r = await fetch(`${addr}/status`, { headers: { 'x-dadealbit-token': token }, signal: ctrl.signal })
    window.clearTimeout(t)
    const j = (await r.json().catch(() => null)) as { ok?: boolean } | null
    return r.ok && j?.ok === true
  } catch {
    return false
  }
}

const HOW_TO = [
  '想让图片也跟过去，二选一（然后重新导出一次）：',
  '① 双击助手包里的「开始使用.bat」（助手包在 GitHub Releases 里；手动那条老路是「启动知乎助手.bat」），编辑器和助手会自动接上；',
  '② 或者在「知乎」面板 →「图床设置」里填一次 GitHub 令牌（不用助手，分享版也能用）。',
  '另外：发知乎其实可以直接用「存到草稿箱」，图片由知乎自己托管，连图床都不用配。',
].join('\n')

/** 换不到公开网址的图片：保留图片本身，但在它上面加一行提示（文件照给，缺图是明摆着的） */
const NO_URL_HINT =
  '> 🖼️ 这张图没能换成公开网址（知乎导入时抓不到它）：在知乎里手动把它拖进去，或者按下面两条路重新导出一次'

/** 把 data: 图片按顺序换成网址；换不到的上面加一行提示 */
function swapImageUrls(md: string, urls: string[]): { md: string; swapped: number; hinted: number } {
  let i = 0
  let swapped = 0
  let hinted = 0
  const next = md.replace(/(!\[[^\]]*\]\()(data:[^)\s]+)(\))/g, (whole, a: string, _src: string, c: string) => {
    const u = urls[i]
    i += 1
    if (u) {
      swapped += 1
      return `${a}${u}${c}`
    }
    hinted += 1
    return `${NO_URL_HINT}\n\n${whole}`
  })
  return { md: next, swapped, hinted }
}

/** 导出「给知乎导入用的 .md」：公式换成知乎公式标记，本机图片先上传换成公开网址 */
export async function exportZhihuMarkdown(
  editor: Editor,
  title: string,
  opts: { onPhase?(text: string): void } = {},
): Promise<ExportOutcome> {
  const raw = getMarkdown(editor)
  const first = mdToZhihuMarkdown(raw)
  const name = (title.trim() || '未命名文档') + '.md'
  const md = first.md

  const dataSrcs = [...md.matchAll(/!\[[^\]]*\]\((data:[^)\s]+)\)/g)].map((m) => m[1])
  const localCount = dataSrcs.length

  /** 出文件 */
  const finish = (out: string, swapped: number, note: string): ExportOutcome => {
    downloadText(name, out, 'text/markdown;charset=utf-8')
    return {
      ok: true,
      text:
        `已导出「${name}」：公式 ${first.formulas} 个已转成知乎认的写法，` +
        (swapped ? `${swapped} 张本机图片已上传图床、换成公开网址 —— 知乎导入时会自己把图抓回去。` : '') +
        (note ? `（${note}）` : '') +
        '接下来：知乎 → 写文章 → 右上角「导入」→ 选这个文件。',
    }
  }

  if (localCount === 0) {
    opts.onPhase?.('')
    return finish(md, 0, '')
  }

  const { addr, token } = readZhihuConfig()
  const bed = loadImageBedConfig()
  const viaAssistant = await assistantAlive(addr, token)

  let urls: string[] = []
  let note = ''
  let failure = ''
  const bedReady = !!(bed.repo.trim() && bed.token.trim())
  if (viaAssistant) {
    opts.onPhase?.(`正在把 ${localCount} 张图片传到图床…`)
    try {
      const res = await fetch(`${addr}/upload-images`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-dadealbit-token': token },
        body: JSON.stringify({ images: dataSrcs }),
      })
      const json = (await res.json()) as { urls?: string[]; warnings?: string[]; error?: string }
      urls = json.urls ?? []
      note = json.warnings?.join('；') ?? ''
      failure = json.error ?? ''
    } catch {
      failure = '连不上助手'
    }
    /* 助手那条路走的是 git push，国内网络会抽风（实测重试十几次才成功过）。
       如果用户填过令牌，就换"直传 GitHub 接口"再试一次 —— 两条路互为备份。 */
    if (!urls.some(Boolean) && bedReady) {
      opts.onPhase?.('助手那条路没成，改用你的 GitHub 令牌直接传…')
      const r = await uploadToImageBed(bed, dataSrcs)
      if (r.urls.some(Boolean)) {
        urls = r.urls
        note = [note, ...r.warnings].filter(Boolean).join('；')
        failure = ''
      } else {
        failure = [failure, r.error].filter(Boolean).join('；')
      }
    }
  } else if (bedReady) {
    opts.onPhase?.(`正在把 ${localCount} 张图片传到图床（用你的 GitHub 令牌）…`)
    const r = await uploadToImageBed(bed, dataSrcs)
    urls = r.urls
    note = r.warnings.join('；')
    failure = r.error ?? ''
  } else {
    failure = failure || '助手没开，也没填图床令牌'
  }

  const r = swapImageUrls(md, urls)
  opts.onPhase?.('')
  if (r.hinted === 0) return finish(r.md, r.swapped, note)

  /* 有图换不到网址：**照样出文件**（用户 2026-09 的决定，之前是"先不导出"）——
     图片留在文件里、每张上面加一行提示，缺图是明摆着的；另外给两条出路 + 推荐走草稿箱。
     这样"只想先存个文件"的人不会被硬拦住，也不会以为图已经跟着过去了。 */
  downloadText(name, r.md, 'text/markdown;charset=utf-8')
  return {
    ok: false,
    text:
      `已导出「${name}」，但还有 ${r.hinted} 张本机图片没换成公开网址` +
      (failure ? `（${failure}）` : '') +
      `，文件在那几张图上面各加了一行提示 —— 知乎导入时会丢这几张图，需要手动补，` +
      `或者发知乎干脆改用「存到草稿箱」（图片由知乎自己托管，不用图床）。` +
      (r.swapped ? `\n其中 ${r.swapped} 张已经换好网址，那几张没问题。` : '') +
      `\n${HOW_TO}`,
  }
}
