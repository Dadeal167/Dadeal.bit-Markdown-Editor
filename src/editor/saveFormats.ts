/**
 * 「导出知乎用 .md」的唯一实现（工具栏「保存」菜单、右下角按钮、「知乎」面板都用这一份）。
 *
 * 为什么只留这一个 Markdown 出口（用户明确要求）：
 *   · 「保存 .md」那种"公式 `$…$` + 图片内嵌"的文件，自己打开没问题，
 *     但拿去知乎导入**图片全丢**（知乎只认图片网址）—— 用户连着踩了两次。
 *   · 所以现在只保留一个 md 出口：公式换成知乎认的写法，图片**先上传换成公开网址**再写进文件。
 *   · 拿不到公开网址时**不产出文件**，直接告诉用户怎么开（助手 / 图床令牌），
 *     绝不再给一个"图片显示不出来"的文件。
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

/** 把 data: 图片按顺序换成网址，返回换成功几个 */
function swapImageUrls(md: string, urls: string[]): { md: string; swapped: number } {
  let i = 0
  let swapped = 0
  const next = md.replace(/(!\[[^\]]*\]\()(data:[^)\s]+)(\))/g, (whole, a: string, _src: string, c: string) => {
    const u = urls[i]
    i += 1
    if (u) {
      swapped += 1
      return `${a}${u}${c}`
    }
    return whole
  })
  return { md: next, swapped }
}

const HOW_TO = [
  '二选一，然后重新点一次「保存 → 导出知乎用 .md」：',
  '① 双击「启动知乎助手.bat」，保持窗口开着（编辑器会自动认出它，不用填令牌）；',
  '② 或者在「知乎」面板 →「图床设置」里填一次 GitHub 令牌（不用助手，分享版也能用）。',
].join('\n')

function noUploadPath(localCount: number, failure: string): ExportOutcome {
  return {
    ok: false,
    text:
      `这篇有 ${localCount} 张本机图片，现在拿不到公开网址（知乎只认图片网址，内嵌图片导入后会丢），` +
      `所以先不导出。\n${HOW_TO}` +
      (failure ? `\n上次失败原因：${failure}` : ''),
  }
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
  } else if (bed.repo.trim() && bed.token.trim()) {
    opts.onPhase?.(`正在把 ${localCount} 张图片传到图床（用你的 GitHub 令牌）…`)
    const r = await uploadToImageBed(bed, dataSrcs)
    urls = r.urls
    note = r.warnings.join('；')
    failure = r.error ?? ''
  } else {
    opts.onPhase?.('')
    return noUploadPath(localCount, '')
  }

  if (!urls.some(Boolean)) {
    opts.onPhase?.('')
    return noUploadPath(localCount, failure)
  }

  const r = swapImageUrls(md, urls)
  opts.onPhase?.('')
  if (r.swapped !== localCount) {
    // 只成功一部分：剩下的图没网址，导入知乎会缺图 —— 同样不产出文件
    return {
      ok: false,
      text:
        `${r.swapped}/${localCount} 张图片上传成功了，还有 ${localCount - r.swapped} 张没成功` +
        (failure ? `（${failure}）` : '') +
        `，缺图的文件没意义，所以先不导出。\n${HOW_TO}`,
    }
  }
  return finish(r.md, r.swapped, note)
}
