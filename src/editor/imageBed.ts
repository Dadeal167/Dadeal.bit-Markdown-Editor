/**
 * 图床上传（不用助手也能用）
 *
 * 为什么需要：知乎的「导入 Markdown」只认图片网址，读不了内嵌图片。
 * 助手（本机进程）能把图片提交进图床仓库，但如果用户没开助手、或者用的是分享版，
 * 编辑器就得自己传 —— 用**用户自己的 GitHub 令牌**直接调 GitHub 接口：
 *   PUT https://api.github.com/repos/<仓库>/contents/images/<文件>
 * 然后把 jsDelivr 的公开网址写进 .md，知乎导入时就能把图抓回去。
 *
 * 实测（file:// 页面，Origin 为 null）：带令牌的 GET 返回 200、PUT 返回 201、
 * 公开地址几秒后能取回图片 —— CORS 和预检都没问题。
 *
 * 安全说明：令牌只存在本机浏览器的 localStorage 里，只发给 api.github.com，
 * 不会写进导出的文件、也不会发给任何其它地方。建议用 fine-grained 令牌、
 * 只勾选图床这一个仓库的 Contents: Read and write。
 */

export interface ImageBedConfig {
  /** 仓库，形如 用户名/仓库名 */
  repo: string
  /** GitHub 令牌（fine-grained，只给这个仓库的 Contents 读写即可） */
  token: string
}

export const IMAGE_BED_KEY = 'md-editor-imagebed-v1'

/** jsDelivr 镜像顺序：实测 gcore / testingcf 国内能通，cdn / fastly 会走 301 不通 */
export const BED_HOSTS = ['gcore.jsdelivr.net', 'testingcf.jsdelivr.net', 'cdn.jsdelivr.net']

export function loadImageBedConfig(): ImageBedConfig {
  try {
    const raw = localStorage.getItem(IMAGE_BED_KEY)
    if (raw) {
      const j = JSON.parse(raw) as Partial<ImageBedConfig>
      return { repo: String(j.repo ?? ''), token: String(j.token ?? '') }
    }
  } catch {
    /* 隐私模式读不到就用空配置 */
  }
  return { repo: '', token: '' }
}

export function saveImageBedConfig(cfg: ImageBedConfig): void {
  try {
    localStorage.setItem(IMAGE_BED_KEY, JSON.stringify({ repo: cfg.repo.trim(), token: cfg.token.trim() }))
  } catch {
    /* 存不下也不影响本次使用 */
  }
}

/** 数据地址 → 文件名（按内容哈希，同一张图不会重复上传） */
function fileNameFor(dataUrl: string): { name: string; base64: string } | null {
  const m = /^data:(image\/[a-z+]+);base64,([A-Za-z0-9+/=]+)$/i.exec(dataUrl.trim())
  if (!m) return null
  const ext = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' }[
    m[1].toLowerCase()
  ] ?? 'png'
  // 用图片内容的简单哈希当文件名（不是加密用途，只为去重）
  let h1 = 0x811c9dc5
  const b64 = m[2]
  for (let i = 0; i < b64.length; i += 1) {
    h1 ^= b64.charCodeAt(i)
    h1 = Math.imul(h1, 0x01000193) >>> 0
  }
  let h2 = 0x811c9dc5
  for (let i = b64.length - 1; i >= 0; i -= 1) {
    h2 ^= b64.charCodeAt(i)
    h2 = Math.imul(h2, 0x01000193) >>> 0
  }
  return { name: `${h1.toString(16).padStart(8, '0')}${h2.toString(16).padStart(8, '0')}.${ext}`, base64: b64 }
}

/** 那个公开地址通不通（新推的文件 jsDelivr 要几秒才分发到） */
async function urlAlive(url: string, tries = 3): Promise<boolean> {
  for (let i = 0; i < tries; i += 1) {
    try {
      const r = await fetch(url, { redirect: 'follow' })
      if (r.ok) {
        await r.arrayBuffer()
        return true
      }
    } catch {
      /* 继续等 */
    }
    await new Promise((r) => setTimeout(r, 2000))
  }
  return false
}

/** 挑一个当前网络能打开的镜像地址 */
async function pickUrl(file: string, repo: string, branch: string): Promise<{ url: string; verified: boolean }> {
  const urls = BED_HOSTS.map((h) => `https://${h}/gh/${repo}@${branch}/${file}`)
  for (const u of urls) {
    if (await urlAlive(u)) return { url: u, verified: true }
  }
  return { url: urls[0], verified: false }
}

function friendlyError(status: number, detail: string): string {
  if (status === 401) return '令牌无效或过期了：重新生成一个填进来'
  if (status === 403) return '令牌权限不够：这个令牌要勾选该仓库的 Contents 读写权限'
  if (status === 404) return '找不到这个仓库：检查仓库名（用户名/仓库名），以及令牌有没有勾选它'
  if (status === 429) return 'GitHub 限流了（一次传太多图）：等一两分钟再试'
  if (status === 422) return 'GitHub 拒绝了这次上传：可能是文件已存在或太大'
  if (status >= 500) return `GitHub 那边出错了（${status}），多半是临时的，稍后重试`
  return `GitHub 返回 ${status}：${detail.slice(0, 120)}`
}

/** 值得重试的错误：网络断了、限流、GitHub 5xx —— 而 401/403/404 是配置问题，重试没用 */
const worthRetry = (status: number) => status === 429 || status >= 500
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export interface BedUploadResult {
  urls: string[]
  warnings: string[]
  error?: string
}

/**
 * 把一批图片传到图床，返回与传入顺序一一对应的网址（失败的为空字符串）。
 *
 * 容错（都是实测过的坑）：
 *   · **逐张重试**：网络断/限流/GitHub 5xx 各试 3 次（每次多等一会儿）；401/403/404 是配置问题，不重试
 *   · **一张失败不拖累整批**：失败的先记下来继续传后面的（最后按"缺图的加提示行"给文件）
 *   · 同一张图重复上传：文件名就是内容哈希，GitHub 回 422 也算成功
 *   · 配置类错误（令牌/仓库不对）直接停下并说清原因，省得白试 20 次
 *
 * @param branch 图床仓库的分支（默认 main）
 */
export async function uploadToImageBed(
  cfg: ImageBedConfig,
  images: string[],
  branch = 'main',
): Promise<BedUploadResult> {
  const repo = cfg.repo.trim().replace(/^https?:\/\/github\.com\//i, '').replace(/\.git$/i, '')
  const token = cfg.token.trim()
  const warnings: string[] = []
  if (!repo || !repo.includes('/')) return { urls: [], warnings, error: '图床仓库没填（形如 用户名/仓库名）' }
  if (!token) return { urls: [], warnings, error: '还没填 GitHub 令牌' }

  const headers = {
    authorization: `Bearer ${token}`,
    accept: 'application/vnd.github+json',
    'content-type': 'application/json',
  }
  const out: string[] = []
  let firstUrl = ''
  let firstError = ''

  for (const [i, src] of images.entries()) {
    const file = fileNameFor(src)
    if (!file) {
      warnings.push(`第 ${i + 1} 张不是可上传的图片，跳过`)
      out.push('')
      continue
    }
    const path = `images/${file.name}`
    let ok = false
    for (let attempt = 1; attempt <= 3 && !ok; attempt += 1) {
      try {
        const res = await fetch(`https://api.github.com/repos/${repo}/contents/${path}`, {
          method: 'PUT',
          headers,
          body: JSON.stringify({ message: `add image ${file.name} from editor`, content: file.base64, branch }),
        })
        if (res.ok) {
          const json = (await res.json()) as { content?: { path?: string } }
          const picked = await pickUrl(json.content?.path ?? path, repo, branch)
          if (!picked.verified) warnings.push('图片已上传，但公开地址暂时打不开（cdn 分发要几秒），稍后可重试')
          firstUrl = picked.url
          out.push(picked.url)
          ok = true
          break
        }
        const body = await res.text()
        // 已存在（同一张图传过）也算成功：文件名就是内容哈希
        if (res.status === 422 || /already exists/i.test(body)) {
          const picked = firstUrl && out.every((u) => u === firstUrl) ? { url: firstUrl, verified: true } : await pickUrl(path, repo, branch)
          firstUrl = firstUrl || picked.url
          out.push(picked.url)
          ok = true
          break
        }
        const msg = friendlyError(res.status, body)
        firstError = firstError || msg
        // 配置类问题（令牌、仓库）重试也没用：直接停，把原因带回去
        if (!worthRetry(res.status)) {
          warnings.push(`第 ${i + 1} 张没传上去：${msg}`)
          return { urls: out, warnings, error: firstError }
        }
        if (attempt < 3) await sleep(1500 * attempt)
        else warnings.push(`第 ${i + 1} 张没传上去（试了 3 次）：${msg}`)
      } catch (e) {
        const msg = '连不上 GitHub（国内网络经常抽风）：' + String(e).slice(0, 80)
        firstError = firstError || msg
        if (attempt < 3) await sleep(1500 * attempt)
        else warnings.push(`第 ${i + 1} 张没传上去（试了 3 次）：${msg}`)
      }
    }
    if (!ok) out.push('')
  }
  return { urls: out, warnings, error: out.every((u) => !u) ? firstError : undefined }
}
