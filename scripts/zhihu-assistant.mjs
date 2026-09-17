/**
 * Dadealbit 知乎助手
 *
 * 作用：把编辑器的内容存进知乎**草稿箱**（只存草稿，代码里没有任何点击「发布」的路径）。
 *
 * 为什么需要它：桌面网页（file://）读不到知乎的登录态、也跨不过 CORS，
 * 「存草稿」只能由一个本机进程驱动你已登录的浏览器来完成。
 *
 * 安全设计：
 *   - 只监听 127.0.0.1，外部网络访问不到
 *   - 所有写操作都要令牌（启动时打印并复制到剪贴板），避免别的网页指挥它往你账号里写东西
 *   - 专用浏览器配置目录（默认 ~/.dadealbit/zhihu-profile），不碰你日常浏览器的数据
 *   - 单一任务队列：同一时刻只跑一个上传，避免两个页面互相打架
 *
 * 用法：
 *   node scripts/zhihu-assistant.mjs [--visible] [--port 5174]
 * 接口：
 *   GET  /status?token=...            助手与登录状态
 *   POST /login   { token }           打开可见浏览器让你扫码登录
 *   POST /draft   { token, title, html }
 *                                     html 里的 <span data-latex="..."> 会被还原成知乎公式
 *   POST /upload-images { token, images: [dataUrl] }
 *                                     把本机图片传到你自己的公开图床仓库，返回 jsDelivr 公开网址
 *                                     （给「导出知乎 .md」用：知乎导入只认图片网址）
 */
import { chromium } from 'playwright-core'
import { createServer } from 'node:http'
import { execFile, execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import { createHash, randomBytes } from 'node:crypto'

/* ---------- 参数 ---------- */
const argv = process.argv.slice(2)
const VISIBLE = argv.includes('--visible')
const portArg = argv.indexOf('--port')
const PORT = portArg >= 0 ? Number(argv[portArg + 1]) : 5174
const tokenArg = argv.indexOf('--token')
const HOME = homedir()
const PROFILE_DIR = resolve(HOME, '.dadealbit', 'zhihu-profile')
const STATE_DIR = resolve(HOME, '.dadealbit')
const TOKEN = tokenArg >= 0 ? String(argv[tokenArg + 1]) : randomBytes(16).toString('hex')
const WRITE_URL = 'https://zhuanlan.zhihu.com/write'

/* 图床：给「导出知乎 .md」把本机图片换成**公开网址**用。
 * 为什么不用知乎自己的图床：它的草稿图片地址是私有的（pic-private + draft_token，
 * 一小时过期、别人访问 403），写进 .md 也没用；直接调它的上传接口一律 403（实测）。
 * 所以用用户自己的公开仓库当图床，网址走 jsDelivr（国内可访问、免费、稳定）。
 * 可用环境变量覆盖：DADEALBIT_IMAGEBED=用户名/仓库名 */
const IMAGE_BED_REPO = process.env.DADEALBIT_IMAGEBED || 'Dadeal167/Dadeal.bit-ImageBed'
const IMAGE_BED_BRANCH = process.env.DADEALBIT_IMAGEBED_BRANCH || 'main'
const IMAGE_BED_DIR = resolve(STATE_DIR, 'image-bed')

mkdirSync(STATE_DIR, { recursive: true })
// 令牌落盘一份，方便脚本/编辑器读取（目录在用户主目录下，只有本机用户可读）
try {
  writeFileSync(resolve(STATE_DIR, 'token.txt'), TOKEN, { encoding: 'utf-8', mode: 0o600 })
} catch {
  /* 写不了就算了，控制台里还有 */
}

/* ---------- 浏览器 ---------- */
let context = null
let busy = false
let contextVisible = null

/** 上次被强杀可能残留 Chromium 的锁文件，导致下次启动直接失败——启动前清掉 */
function clearProfileLocks() {
  for (const name of ['SingletonLock', 'SingletonCookie', 'SingletonSocket', 'lockfile']) {
    try {
      rmSync(resolve(PROFILE_DIR, name), { force: true, recursive: true })
    } catch {
      /* 删不掉就算了 */
    }
  }
}

async function ensureBrowser({ visible = false } = {}) {
  // 需要"有头"时（贴图要用系统剪贴板），已有无头窗口就先关掉重开
  if (context && contextVisible !== visible) {
    await context.close().catch(() => {})
    context = null
  }
  if (context) return context

  const launch = () =>
    chromium.launchPersistentContext(PROFILE_DIR, {
      channel: 'msedge',
      headless: !(visible || VISIBLE),
      viewport: { width: 1440, height: 900 },
    })

  try {
    context = await launch()
  } catch (e) {
    // 常见原因：上次被强制结束，profile 里留了锁。清一次再试。
    log('浏览器启动失败，清理配置锁后重试：' + String(e).slice(0, 100))
    clearProfileLocks()
    try {
      context = await launch()
    } catch (e2) {
      throw new Error(
        '打不开助手专用浏览器（' +
          String(e2).slice(0, 120) +
          '）。可以删掉 ' +
          PROFILE_DIR +
          ' 再重新启动助手并扫码登录一次。',
      )
    }
  }
  contextVisible = visible || VISIBLE
  context.on('close', () => {
    context = null
    contextVisible = null
  })
  return context
}

const log = (...a) => console.log(new Date().toLocaleTimeString(), ...a)

/* ---------- 上传实现 ----------
   已实测的三个关键点（见 NEXT.md 的摸底结论）：
   1. 正文用 document.execCommand('insertHTML') 注入（合成 paste 事件 Draft.js 不认）
   2. 公式要点它的「公式」按钮，往 CodeMirror 里真键盘输入 LaTeX，再点「确认」
   3. 知乎自动保存草稿，不需要（也没有）「保存草稿」按钮；靠等待 + 刷新验证
*/
async function uploadDraft({ title, html }) {
  const parts = splitParts(html)
  const imageParts = parts.filter((p) => p.type === 'image')
  // 有图片就必须用有头窗口：无头 Chromium 读不到系统剪贴板（实测）
  const ctx = await ensureBrowser({ visible: imageParts.length > 0 })
  const page = await ctx.newPage()
  const warnings = []
  const tempFiles = []
  try {
    await page.goto(WRITE_URL, { waitUntil: 'domcontentloaded', timeout: 60000 })
    await page.waitForSelector('.public-DraftEditor-content', { timeout: 40000 })

    // 判断是否登录：未登录会被重定向到登录页
    if (!/zhuanlan\.zhihu\.com\/write/.test(page.url())) {
      return { ok: false, needLogin: true, error: '看起来没有登录，请先点「登录知乎」' }
    }
    await page.waitForTimeout(2500)

    // 标题（知乎限 100 字，超了会被截断导致后续校验对不上，这里先自己截断并提示）
    const titleEl = page.locator('textarea[placeholder*="标题"], input[placeholder*="标题"]').first()
    if ((await titleEl.count()) === 0) {
      return { ok: false, error: '找不到标题输入框（知乎可能改版了）' }
    }
    const rawTitle = title || '未命名文档'
    const safeTitle = [...rawTitle].slice(0, 100).join('')
    if (safeTitle !== rawTitle) warnings.push(`标题超过知乎的 100 字上限，已截断到前 100 字`)
    await titleEl.click()
    await titleEl.fill(safeTitle)
    await page.waitForTimeout(400)

    /* ---------- 清空正文之前：先备份 + 检测冲突 ----------
       知乎是"边编辑边自动保存"，一旦注入中途失败，草稿就会停在半截。
       所以先把现有内容存一份到 ~/.dadealbit/backups/，并在被人在知乎上改过时提示。 */
    const existing = await page.evaluate(() => {
      const t = document.querySelector('textarea[placeholder*="标题"]')?.value ?? ''
      const root = document.querySelector('.public-DraftEditor-content')
      return { title: t, text: (root?.innerText || '').trim().slice(0, 20000) }
    })
    const lastFile = resolve(STATE_DIR, 'last-draft.json')
    let lastWritten = null
    try {
      lastWritten = JSON.parse(readFileSync(lastFile, 'utf-8'))
    } catch {
      /* 首次运行没有记录 */
    }
    if (existing.text) {
      if (lastWritten && lastWritten.title === existing.title && lastWritten.text !== existing.text) {
        warnings.push('这篇草稿在知乎上被改过（可能是你自己改的），这次上传把那些改动覆盖掉了')
      }
      try {
        const backupDir = resolve(STATE_DIR, 'backups')
        mkdirSync(backupDir, { recursive: true })
        const backup = resolve(backupDir, `draft-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
        writeFileSync(backup, JSON.stringify({ ...existing, backedUpAt: new Date().toISOString() }, null, 2), 'utf-8')
        log(`  已备份草稿原有内容 → ${backup}`)
      } catch (e) {
        warnings.push('草稿备份没写成（不影响上传）：' + String(e).slice(0, 60))
      }
    }

    // 清空正文（避免和上一篇草稿内容叠加）
    // 注意：整个注入都依赖"光标在正文里"，所以清完再点一下正文并确认焦点，否则
    // （例如标题刚被填过、焦点还在标题上）内容可能插错地方
    await page.evaluate(() => {
      const el = document.querySelector('.public-DraftEditor-content')
      el?.focus()
      document.execCommand('selectAll')
      document.execCommand('delete')
    })
    await page.locator('.public-DraftEditor-content').click({ position: { x: 40, y: 30 } }).catch(() => {})
    await page.waitForTimeout(600)
    const focusOk = await page.evaluate(() => {
      const el = document.querySelector('.public-DraftEditor-content')
      return !!el && (el === document.activeElement || el.contains(document.activeElement))
    })
    if (!focusOk) {
      warnings.push('光标没能进到正文里，内容可能会插错位置（已继续尝试）')
      await page.evaluate(() => document.querySelector('.public-DraftEditor-content')?.focus())
      await page.waitForTimeout(400)
    }

    /* 正文按公式/图片切成若干段：
       - 文字 + 公式：合并成一段，一次 insertHTML 注入（公式直接写成知乎的 <img eeimg>）
       - 图片：走剪贴板粘贴（要真实 Ctrl+V）
       公式不再一个个开弹窗：一百多个公式的稿子从十几分钟降到一分钟级。
       稳妥起见先插一个"探针公式"看知乎认不认，不认就退回老路（逐个弹窗）。 */
    let formulaDone = 0
    let formulaFailed = 0
    let imageDone = 0
    let imageFailed = 0

    const editorLen = () =>
      page.evaluate(() => (document.querySelector('.public-DraftEditor-content')?.innerText || '').length)

    const insertHtml = async (html) => {
      await page.evaluate((h) => {
        const el = document.querySelector('.public-DraftEditor-content')
        el?.focus()
        document.execCommand('insertHTML', false, h)
      }, html)
    }

    const clearBody = async () => {
      await page.evaluate(() => {
        const el = document.querySelector('.public-DraftEditor-content')
        el?.focus()
        document.execCommand('selectAll')
        document.execCommand('delete')
      })
      await page.locator('.public-DraftEditor-content').click({ position: { x: 40, y: 30 } }).catch(() => {})
      await page.waitForTimeout(250)
    }

    /** 编辑器里有几个公式节点（知乎可能把 eeimg 换成自己的公式节点，所以多认几种） */
    const countFormulas = () =>
      page.evaluate(() => {
        const root = document.querySelector('.public-DraftEditor-content')
        if (!root) return 0
        return root.querySelectorAll('img[eeimg], .ztext-math, [data-tex]').length
      })

    const formulaParts = parts.filter((p) => p.type === 'formula')
    let fastFormula = false
    if (formulaParts.length > 0) {
      await insertHtml(`<p>${formulaImgHtml('\\frac{1}{2}', false)}</p>`)
      await page.waitForTimeout(1200)
      // 顺便把知乎"改造后"的节点原样打出来：万一它不认，日志里就有线索
      const probe = await page.evaluate(() => {
        const root = document.querySelector('.public-DraftEditor-content')
        if (!root) return { formulas: 0, sample: '(没有编辑器)' }
        const hit = root.querySelector('img[eeimg], .ztext-math, [data-tex]')
        return {
          formulas: root.querySelectorAll('img[eeimg], .ztext-math, [data-tex]').length,
          sample: hit ? hit.outerHTML.slice(0, 220) : (root.querySelector('img')?.outerHTML.slice(0, 220) ?? '(没有 img)'),
        }
      })
      fastFormula = probe.formulas > 0
      log(
        fastFormula
          ? `  公式走快速通道：整篇一次注入（共 ${formulaParts.length} 个公式）`
          : '  公式退回老路（逐个开弹窗）：探针公式没被认出来',
      )
      log(`  探针结果：${probe.sample}`)
      if (!fastFormula) warnings.push('这次公式是一个个插的（比较慢）：知乎没认下快速通道的公式标记')
      await clearBody()
    }

    // 攒着连续的文字 + 公式，遇到图片才落地，减少 insertHTML 次数与等待
    let chunk = ''
    const flushChunk = async () => {
      if (!chunk.trim()) {
        chunk = ''
        return
      }
      const before = await editorLen()
      await insertHtml(chunk)
      chunk = ''
      // 注入是同步的，Draft.js 落 DOM 有一点点延迟：短轮询代替固定 sleep
      for (let i = 0; i < 8; i += 1) {
        await page.waitForTimeout(120)
        if ((await editorLen()) > before) break
      }
    }

    for (const [idx, part] of parts.entries()) {
      if (part.type === 'html') {
        chunk += part.value
        continue
      }

      if (part.type === 'formula' && fastFormula) {
        chunk += formulaImgHtml(part.latex, part.display)
        formulaDone += 1
        continue
      }

      if (part.type === 'image') {
        await flushChunk()
        // 粘贴前后比对**图片 src 集合**，不是数个数（草稿里本来就有旧图时，数个数会误判成功）
        const srcOf = () =>
          page.evaluate(() =>
            [...(document.querySelector('.public-DraftEditor-content')?.querySelectorAll('img') ?? [])]
              .map((im) => im.getAttribute('src') || '')
              .filter((s) => /^https?:/.test(s)),
          )
        const beforeSrcs = await srcOf()
        const file = writeTempImage(part.dataUrl, idx)
        if (!file) {
          warnings.push('有张图片格式不认识，跳过了')
          imageFailed += 1
          continue
        }
        tempFiles.push(file)
        let ok = false
        try {
          ok = setClipboardImage(file)
          log(`  已把图片放进剪贴板（${file.split('\\').pop()}）`)
        } catch (e) {
          warnings.push('图片放进剪贴板失败：' + String(e).slice(0, 80))
        }
        if (!ok) {
          imageFailed += 1
          continue
        }
        // 点到正文末尾再粘贴，图片才会落在正确位置。
        // 关键：必须把页面带到前台——窗口在后台时 Chromium 的 Ctrl+V 读不到系统剪贴板（实测）
        await page.bringToFront().catch(() => {})
        await page.waitForTimeout(400)
        await page.evaluate(() => {
          const el = document.querySelector('.public-DraftEditor-content')
          el.focus()
        })
        await page.waitForTimeout(250)
        await page.keyboard.press('Control+v')
        // 上传需要时间，而且**第一张图特别慢**（实测冷启动能超过 60 秒，之后只需几秒），
        // 所以等得久一点；即使没看到也不算失败，最后用"刷新后的草稿"来判定。
        let seen = false
        for (let i = 0; i < 40; i += 1) {
          await page.waitForTimeout(2500)
          const nowSrcs = await srcOf()
          if (nowSrcs.some((s) => !beforeSrcs.includes(s))) {
            seen = true
            break
          }
        }
        if (seen) imageDone += 1
        else {
          // 不直接判失败（知乎可能还在传，最终以刷新后的草稿为准），但要记下来
          warnings.push('有张图片在编辑器里出现得比较慢（已继续，稍后用草稿校验）')
        }
        // 图片是异步上传的，给它一点时间落盘再继续插后面的内容
        await page.waitForTimeout(2000)
        continue
      }

      // 公式（老路：开弹窗敲 LaTeX）
      await flushChunk()
      const hit = await clickToolbar(page, '公式')
      if (!hit.ok) {
        warnings.push(`公式「${part.latex}」插入失败：找不到公式按钮（当时可见按钮：${(hit.seen ?? []).join(' ')}）`)
        formulaFailed += 1
        continue
      }
      await page.waitForTimeout(1500)
      const cm = await page.evaluate(() => {
        const c = document.querySelector('.cm-content')
        if (!c) return null
        const r = c.getBoundingClientRect()
        return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }
      })
      if (!cm) {
        warnings.push(`公式「${part.latex}」插入失败：公式面板里没有输入区`)
        formulaFailed += 1
        await page.keyboard.press('Escape').catch(() => {})
        continue
      }
      await page.mouse.click(cm.x, cm.y)
      await page.waitForTimeout(300)
      await page.keyboard.type(part.latex, { delay: 15 })
      await page.waitForTimeout(900)
      const confirmed = await page.evaluate(() => {
        const b = [...document.querySelectorAll('button')].find((x) => (x.innerText || '').trim() === '确认')
        if (!b) return false
        b.click()
        return true
      })
      await page.waitForTimeout(1200)
      if (confirmed) formulaDone += 1
      else {
        warnings.push(`公式「${part.latex}」没有找到确认按钮`)
        formulaFailed += 1
        await page.keyboard.press('Escape').catch(() => {})
      }
    }
    await flushChunk()

    // 快速通道：插完立刻数一遍，少一个都算失败（最终还会用刷新后的草稿复核）
    if (fastFormula && formulaParts.length > 0) {
      const inEditor = await countFormulas()
      log(`  编辑器里现有 ${inEditor} 个公式（应有 ${formulaParts.length} 个）`)
      if (inEditor < formulaParts.length) {
        const missing = formulaParts.length - inEditor
        formulaFailed += missing
        warnings.push(`有 ${missing} 个公式没进编辑器（知乎可能没认出快速通道的公式）`)
      }
    }

    // 等自动保存：知乎没有保存按钮，靠"刷新后内容还在"来确认。
    // 实测 5 秒不够（标题会先存住、正文还没落盘），所以轮询 + 延长预算。
    const draftTitle = safeTitle
    const readEditor = () =>
      page.evaluate(() => {
        const root = document.querySelector('.public-DraftEditor-content')
        const t = document.body.innerText
        const m = t.match(/(已保存|保存中|保存失败|刚刚|\d+ 分钟前)/g)
        return {
          bodyText: (root?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 80),
          status: m ? [...new Set(m)].join(',') : '',
        }
      })

    let beforeReload = await readEditor()
    for (let i = 0; i < 6 && beforeReload.bodyText; i += 1) {
      // 每轮多等一点，让它把正文也存下去
      await page.waitForTimeout(3000)
      beforeReload = await readEditor()
      if (i >= 1 && /已保存|分钟前/.test(beforeReload.status)) break
    }
    log(`注入后正文长度 ${beforeReload.bodyText.length}，状态「${beforeReload.status}」`)
    if (!beforeReload.bodyText) warnings.push('正文好像是空的：注入可能没生效')

    // 刷新验证（多试几次，给自动保存留足时间）
    let after = { title: '', text: '', formulas: 0, images: 0 }
    // 校验草稿：以"刷新后草稿里有什么"为准。知乎的自动保存是防抖的，
    // 图片又是异步上传，所以这里耐心重试（有图片时给更长的总预算）。
    const attempts = imageParts.length > 0 ? 6 : 3
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      await page.waitForTimeout(attempt === 0 ? 5000 : 8000 + attempt * 4000)
      await page.reload({ waitUntil: 'domcontentloaded' })
      await page.waitForSelector('.public-DraftEditor-content', { timeout: 40000 })
      await page.waitForTimeout(4000)
      after = await page.evaluate(() => {
        const t = document.querySelector('textarea[placeholder*="标题"]')?.value ?? ''
        const root = document.querySelector('.public-DraftEditor-content')
        const imgs = root ? [...root.querySelectorAll('img')] : []
        return {
          title: t,
          text: (root?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 60),
          formulas: root
            ? root.querySelectorAll('[data-tex], .ztext-math, img[eeimg], mjx-container, .katex, [class*="Math"], [class*="math"]').length
            : 0,
          // 公式也是 img（eeimg）：数图片时要把它们排除，否则"图片都在"会被公式图片顶替
          images: imgs.filter((im) => !im.hasAttribute('eeimg') && !/\/equation\?tex=/.test(im.getAttribute('src') || '')).length,
        }
      })
      const okNow =
        after.title === draftTitle &&
        !!after.text &&
        formulaFailed === 0 &&
        (imageParts.length === 0 || after.images >= imageParts.length)
      log(
        `  校验第 ${attempt + 1} 次：标题${after.title === draftTitle ? '✓' : '✗'} 正文${after.text ? '✓' : '✗'} 图片 ${after.images} 张`,
      )
      if (okNow) break
    }
    const saved = after.title === safeTitle
    if (saved && !after.text) warnings.push('刷新后正文是空的（草稿可能没保存成功）')
    // 快速通道的公式要在"刷新后"仍然是公式（知乎有可能把它存成普通图片）
    if (fastFormula && formulaParts.length > 0 && after.formulas < formulaParts.length) {
      warnings.push(`刷新后草稿里只数到 ${after.formulas} 个公式，应该有 ${formulaParts.length} 个（知乎可能没把它们当公式存）`)
    }
    if (imageParts.length > 0 && after.images < imageParts.length) {
      warnings.push(`草稿里只有 ${after.images} 张图片，应该有 ${imageParts.length} 张`)
    }
    if (formulaFailed > 0) warnings.push(`有 ${formulaFailed} 个公式没插进去`)

    // 记下这次写进去的内容，下次上传时用来判断"草稿是否被人在知乎上改过"
    try {
      writeFileSync(
        resolve(STATE_DIR, 'last-draft.json'),
        JSON.stringify({ title: after.title, text: after.text, at: Date.now() }, null, 2),
        'utf-8',
      )
    } catch {
      /* 记不下来就算了 */
    }

    // 成功判定要把公式和图片算进去：少东西就不该报"成功"
    const contentOk =
      saved &&
      !!after.text &&
      formulaFailed === 0 &&
      imageParts.length === after.images
    return {
      ok: contentOk,
      saved,
      title: after.title,
      previewText: after.text,
      textBeforeReload: beforeReload.bodyText,
      formulasInDraft: after.formulas,
      formulasInserted: formulaDone,
      formulasFailed: formulaFailed,
      imagesInserted: imageDone,
      imagesFailed: imageFailed,
      imagesExpected: imageParts.length,
      imagesInDraft: after.images,
      backupsDir: resolve(STATE_DIR, 'backups'),
      warnings,
      draftUrl: WRITE_URL,
    }
  } finally {
    await page.close().catch(() => {})
    // 临时图片用完就删（里面是你的图片内容）
    for (const f of tempFiles) {
      try {
        rmSync(f, { force: true })
      } catch {
        /* 删不掉就算了 */
      }
    }
  }
}

/** 把导出 HTML 按公式 / 图片切成若干段 */
export function splitParts(html) {
  const out = []
  // 公式：行内是 <span data-latex="…">…</span>，块级是 <div data-latex="…" data-math-block>…</div>
  // （以前只认 span，块级公式会当普通文字注入 —— 顺手修掉）
  // 属性顺序不固定，所以整个属性串都抓下来再找 data-math-block
  // 图片：<img src="data:…">
  const re =
    /<(span|div)\b([^>]*data-latex="([^"]*)"[^>]*)>[\s\S]*?<\/\1>|<img[^>]*src="(data:[^"]+)"[^>]*\/?>/g
  let last = 0
  let m
  while ((m = re.exec(html))) {
    if (m.index > last) out.push({ type: 'html', value: html.slice(last, m.index) })
    if (m[3] !== undefined) {
      out.push({
        type: 'formula',
        latex: decodeEntities(m[3]),
        display: /data-math-block/.test(m[2] || ''),
      })
    } else {
      out.push({ type: 'image', dataUrl: decodeEntities(m[4]) })
    }
    last = m.index + m[0].length
  }
  if (last < html.length) out.push({ type: 'html', value: html.slice(last) })
  return out.length ? out : [{ type: 'html', value: html }]
}

/**
 * 知乎的公式标记：编辑器以 eeimg 识别公式、以 alt 读 LaTeX 原文。
 * 有了它就不用一个个开公式弹窗敲 LaTeX —— 这是上传快慢的分水岭。
 */
export function formulaImgHtml(latex, display) {
  const alt = String(latex)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
  return `<img eeimg="${display ? 2 : 1}" src="//www.zhihu.com/equation?tex=${encodeURIComponent(latex)}" alt="${alt}" />`
}

/** 保留旧名字，避免外部引用失效 */
export const splitByFormula = splitParts

function decodeEntities(s) {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
}

/** 粗略去标签，用来判断"这段 HTML 里到底有没有文字" */
function stripTags(s) {
  return String(s ?? '')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
}

/* ---------- 图片：走"剪贴板贴图 + 真实 Ctrl+V" ----------
   已实测：无头模式读不到系统剪贴板，必须用有头窗口；贴完知乎自己会上传并返回托管地址。
   官方媒体云通道需要 MCP 工具（本机尚未配置，配好要重启 Agent），所以这里用用户级做法。 */
function writeTempImage(dataUrl, index) {
  const m = /^data:(image\/[a-z0-9.+-]+);base64,(.*)$/i.exec(dataUrl.trim())
  if (!m) return null
  const ext = m[1].includes('jpeg') ? 'jpg' : m[1].includes('gif') ? 'gif' : m[1].includes('webp') ? 'webp' : 'png'
  const dir = resolve(STATE_DIR, 'tmp')
  mkdirSync(dir, { recursive: true })
  const file = resolve(dir, `paste-${Date.now()}-${index}.${ext}`)
  writeFileSync(file, Buffer.from(m[2], 'base64'))
  return file
}

/** 用 Windows PowerShell 5.1（STA）把图片放进系统剪贴板 */
function setClipboardImage(file) {
  const psFile = resolve(STATE_DIR, 'set-clipboard-image.ps1')
  writeFileSync(
    psFile,
    // 注意：param 必须是脚本的第一条语句，写在 Add-Type 后面会失效（$Path 变空、图片进不去剪贴板）
    [
      'param([string]$Path)',
      '$ErrorActionPreference = "Stop"',
      'Add-Type -AssemblyName System.Windows.Forms',
      'Add-Type -AssemblyName System.Drawing',
      '$img = [System.Drawing.Image]::FromFile($Path)',
      'if (-not $img) { throw "cannot load image" }',
      '[System.Windows.Forms.Clipboard]::SetImage($img)',
      '$img.Dispose()',
      "Write-Output 'ok'",
    ].join('\n'),
    'utf-8',
  )
  const exe = `${process.env.SystemRoot}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`
  const out = execFileSync(exe, ['-STA', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', psFile, file], {
    encoding: 'utf-8',
  })
  return /ok/.test(out)
}

/** 点顶部工具栏上文案等于 kw 的按钮（注意：知乎按钮文案里混了零宽字符 U+200B） */async function clickToolbar(page, kw) {
  const pos = await page.evaluate((k) => {
    const clean = (s) => (s || '').replace(/[\s\u200b\u200c\u200d\ufeff]/g, '')
    const cands = [...document.querySelectorAll('button')]
      .map((b) => ({ b, r: b.getBoundingClientRect(), t: clean(b.innerText || '') }))
      .filter((x) => x.t === k && x.r.width > 0 && x.r.top < 200)
      .sort((a, b) => a.r.top - b.r.top)
    if (!cands.length) {
      return {
        notFound: true,
        seen: [...document.querySelectorAll('button')]
          .map((b) => ({ t: clean(b.innerText || ''), y: Math.round(b.getBoundingClientRect().top) }))
          .filter((x) => x.t && x.y < 200)
          .map((x) => `${x.t}@${x.y}`)
          .slice(0, 40),
      }
    }
    return { x: Math.round(cands[0].r.x + cands[0].r.width / 2), y: Math.round(cands[0].r.y + cands[0].r.height / 2) }
  }, kw)
  if (pos?.notFound) return { ok: false, seen: pos.seen }
  await page.mouse.click(pos.x, pos.y)
  return { ok: true }
}

/* ---------- HTTP 服务 ---------- */
/** 只允许本机页面（file:// 的 Origin 是 null、开发服务器是 127.0.0.1:5173）。仍以令牌为准。 */
const ALLOWED_ORIGINS = new Set(['null', 'http://127.0.0.1:5173', 'http://localhost:5173'])
const cors = (req, res) => {
  const origin = req.headers.origin ?? 'null'
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGINS.has(origin) ? origin : 'null')
  // 必须把自定义头 x-dadealbit-token 列进去，否则浏览器预检会拦掉 POST
  res.setHeader('Access-Control-Allow-Headers', 'content-type, x-dadealbit-token')
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
  res.setHeader('Access-Control-Max-Age', '600')
  res.setHeader('Vary', 'Origin')
}

const MAX_BODY = 20 * 1024 * 1024

/** 读请求体；超限时明确回 413，而不是把连接掐掉让前端以为"助手没开" */
const readBody = (req) =>
  new Promise((resolveBody) => {
    let data = ''
    let done = false
    const finish = (value) => {
      if (!done) {
        done = true
        resolveBody(value)
      }
    }
    req.on('data', (c) => {
      if (done) return
      data += c
      if (data.length > MAX_BODY) {
        finish({ __tooLarge: true })
        req.destroy()
      }
    })
    req.on('end', () => {
      try {
        finish(data ? JSON.parse(data) : {})
      } catch {
        finish({})
      }
    })
    req.on('error', () => finish({}))
  })

/* ---------- 图片上传到图床仓库（给「导出知乎 .md」用） ----------
   本机图片是内嵌 base64，知乎导入读不了；知乎自己的图床又只给私有地址。
   所以把图片提交到用户自己的公开仓库当图床，返回 jsDelivr 的公开网址：
     https://cdn.jsdelivr.net/gh/<用户名>/<仓库>@<分支>/images/<文件名>
   文件按内容哈希命名 → 同一张图重复上传不会产生新文件。 */

let bedChain = Promise.resolve()
const BED_EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' }

function runGit(args, { cwd = IMAGE_BED_DIR, tries = 1, timeout = 120000 } = {}) {
  let last = ''
  for (let i = 1; i <= tries; i += 1) {
    try {
      return execFileSync('git', args, { cwd, encoding: 'utf-8', timeout, stdio: ['ignore', 'pipe', 'pipe'] }).trim()
    } catch (e) {
      last = String(e.stderr ?? e.stdout ?? e).slice(0, 200)
      if (i < tries) execFileSync('powershell', ['-NoProfile', '-Command', `Start-Sleep -Seconds ${4 * i}`], { stdio: 'ignore' })
    }
  }
  throw new Error(`git ${args[0]} 失败：${last}`)
}

/** 准备好图床仓库的本地副本（第一次会 clone） */
function ensureImageBed() {
  if (!existsSync(resolve(IMAGE_BED_DIR, '.git'))) {
    mkdirSync(STATE_DIR, { recursive: true })
    log(`第一次用图床：把 ${IMAGE_BED_REPO} 克隆到本机…`)
    runGit(['clone', `https://github.com/${IMAGE_BED_REPO}.git`, IMAGE_BED_DIR], { cwd: STATE_DIR, tries: 3 })
  }
  // 跟上远端（上次推送失败/别人改过都不怕）
  try {
    runGit(['pull', '--rebase', 'origin', IMAGE_BED_BRANCH], { tries: 2 })
  } catch {
    runGit(['fetch', 'origin', IMAGE_BED_BRANCH], { tries: 3 })
    runGit(['reset', '--hard', `origin/${IMAGE_BED_BRANCH}`], { tries: 1 })
  }
  mkdirSync(resolve(IMAGE_BED_DIR, 'images'), { recursive: true })
}

/** 那个公开地址到底通不通（jsDelivr 刚推上去要几秒才生效） */
async function urlAlive(url, tries = 4) {
  for (let i = 0; i < tries; i += 1) {
    try {
      const r = await fetch(url, { method: 'GET', redirect: 'follow' })
      if (r.ok) {
        await r.arrayBuffer()
        return true
      }
    } catch {
      /* 继续等 */
    }
    await new Promise((r) => setTimeout(r, 2500))
  }
  return false
}

/* jsDelivr 有几个镜像域名，国内可达性不一样（实测：gcore / testingcf 能通，
 * cdn / fastly 这两个走 301 走不通）。按顺序挑第一个能打开的用。 */
const BED_HOSTS = ['gcore.jsdelivr.net', 'testingcf.jsdelivr.net', 'cdn.jsdelivr.net']

/** 生成该图片在各镜像上的地址 */
const bedUrls = (file) => BED_HOSTS.map((h) => `https://${h}/gh/${IMAGE_BED_REPO}@${IMAGE_BED_BRANCH}/images/${file}`)

/** 挑一个当前网络能打开的镜像地址（都打不开就返回第一个 + 警告） */
async function pickBedUrl(file) {
  const urls = bedUrls(file)
  for (const u of urls) {
    if (await urlAlive(u, 3)) return { url: u, verified: true }
  }
  return { url: urls[0], verified: false }
}

/** 上传一批图片，返回 { ok, urls, warnings, added }；urls 与传入顺序一一对应 */
async function uploadImagesToBed({ images }) {
  const decoded = []
  const warnings = []
  for (const [i, item] of images.entries()) {
    const dataUrl = typeof item === 'string' ? item : item?.dataUrl
    const m = /^data:(image\/[a-z+]+);base64,([A-Za-z0-9+/=]+)$/i.exec(String(dataUrl ?? '').trim())
    if (!m) {
      warnings.push(`第 ${i + 1} 张不是可上传的图片（可能是网址或格式不认识），跳过`)
      decoded.push(null)
      continue
    }
    const ext = BED_EXT[m[1].toLowerCase()] ?? 'png'
    const buf = Buffer.from(m[2], 'base64')
    if (buf.length > 12 * 1024 * 1024) {
      warnings.push(`第 ${i + 1} 张超过 12MB，跳过`)
      decoded.push(null)
      continue
    }
    decoded.push({ buf, ext })
  }
  const valid = decoded.filter(Boolean)
  if (!valid.length) return { ok: false, urls: [], warnings, error: '没有可上传的图片' }

  ensureImageBed()
  const names = valid.map((v) => {
    const hash = createHash('sha1').update(v.buf).digest('hex').slice(0, 12)
    return { ...v, name: `${hash}.${v.ext}` }
  })

  const fresh = []
  for (const n of names) {
    const abs = resolve(IMAGE_BED_DIR, 'images', n.name)
    if (!existsSync(abs)) {
      writeFileSync(abs, n.buf)
      fresh.push(n.name)
    }
  }

  let pushed = false
  if (fresh.length) {
    runGit(['add', '--', ...fresh.map((f) => `images/${f}`)], { tries: 1 })
    const staged = runGit(['diff', '--cached', '--name-only'])
    if (staged) {
      runGit([
        '-c', 'user.name=Dadealbit ImageBed',
        '-c', 'user.email=imagebed@users.noreply.github.com',
        'commit', '-m', `add ${fresh.length} image(s) from editor`,
      ], { tries: 1 })
      runGit(['push', 'origin', IMAGE_BED_BRANCH], { tries: 6 })
      pushed = true
    }
  }
  log(`图床：${fresh.length} 张新图已提交${pushed ? '并推送' : '（都已存在，无需推送）'}，共 ${names.length} 张`)

  const urls = names.map((n) => `https://${BED_HOSTS[0]}/gh/${IMAGE_BED_REPO}@${IMAGE_BED_BRANCH}/images/${n.name}`)
  // 抽查第一张：确认公开地址确实能打开，并挑一个当前网络能用的镜像
  const picked = await pickBedUrl(names[0].name)
  if (picked.verified) {
    urls[0] = picked.url
    log(`图床：公开地址可用（${new URL(picked.url).host}）`)
  } else {
    warnings.push('图片已提交，但公开地址暂时打不开（cdn 分发要几秒到几分钟），稍后重试一次即可')
  }

  // 把可能为 null 的位置补上（跳过的那些）
  const out = []
  let k = 0
  for (const d of decoded) out.push(d ? urls[k++] : '')
  return { ok: out.some(Boolean), urls: out, warnings, added: fresh.length, verified: picked.verified }
}

const server = createServer(async (req, res) => {  cors(req, res)
  if (req.method === 'OPTIONS') {
    res.writeHead(204).end()
    return
  }
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`)
  const send = (code, obj) => {
    res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify(obj))
  }

  const body = req.method === 'POST' ? await readBody(req) : {}
  if (body.__tooLarge) {
    send(413, {
      ok: false,
      error: `内容太大（超过 ${Math.round(MAX_BODY / 1024 / 1024)}MB，多半是图片太多）。先把图片压小或分两篇再传。`,
    })
    return
  }
  // 令牌只认请求头：不走 URL 查询参数（会留在日志/历史里）
  const token = req.headers['x-dadealbit-token']
  if (token !== TOKEN) {
    send(401, { ok: false, error: '令牌不对：请看助手窗口里打印的令牌' })
    return
  }

  if (url.pathname === '/status') {
    send(200, {
      ok: true,
      busy,
      profileReady: existsSync(PROFILE_DIR),
      imageBed: IMAGE_BED_REPO,
      note: '登录状态需要真实打开写作页才知道；点「登录知乎」可确认并扫码',
    })
    return
  }

  /* 上传图片到图床，返回公开网址（给「导出知乎 .md」用） */
  if (url.pathname === '/upload-images') {
    if (req.method !== 'POST') {
      send(405, { ok: false, error: '请用 POST' })
      return
    }
    const images = Array.isArray(body.images) ? body.images.slice(0, 80) : []
    if (!images.length) {
      send(400, { ok: false, error: '没有收到图片' })
      return
    }
    // 串行执行：别让两次导出同时动同一个仓库
    const task = bedChain.then(async () => {
      log(`图床：收到 ${images.length} 张图片`)
      try {
        const r = await uploadImagesToBed({ images })
        log(`图床：完成（新提交 ${r.added ?? 0} 张，公开地址${r.verified ? '已验证可用' : '暂未验证'}）`)
        send(200, r)
      } catch (e) {
        log('图床上传出错：' + String(e).slice(0, 160))
        send(500, { ok: false, error: '上传图片失败：' + String(e).slice(0, 240) })
      }
    })
    bedChain = task.catch(() => {})
    await task
    return
  }

  if (url.pathname === '/login') {
    if (busy) {
      send(429, { ok: false, error: '助手正忙，稍后再试' })
      return
    }
    busy = true
    try {
      const ctx = await ensureBrowser({ visible: true })
      const page = ctx.pages()[0] ?? (await ctx.newPage())
      await page.goto(WRITE_URL, { waitUntil: 'domcontentloaded', timeout: 60000 })
      await page.waitForTimeout(2500)
      const loggedIn = /zhuanlan\.zhihu\.com\/write/.test(page.url())
      send(200, {
        ok: true,
        loggedIn,
        hint: loggedIn ? '已经登录，不需要扫码' : '已打开浏览器窗口，请扫码登录（登录一次即可，之后助手会记住）',
      })
    } catch (e) {
      send(500, { ok: false, error: String(e).slice(0, 200) })
    } finally {
      busy = false
    }
    return
  }

  if (url.pathname === '/draft') {
    if (busy) {
      send(429, { ok: false, error: '助手正忙（上一个上传还没结束），请等它跑完再点' })
      return
    }
    // 参数校验：必须是字符串，且**必须有实际内容**——否则会把用户已有的草稿清空
    if (typeof body.title !== 'string' && typeof body.html !== 'string') {
      send(400, { ok: false, error: '缺少 title 或 html' })
      return
    }
    const html = typeof body.html === 'string' ? body.html : ''
    const title = typeof body.title === 'string' ? body.title : ''
    const parts = splitParts(html)
    const hasRealContent = parts.some(
      (p) => p.type === 'image' || p.type === 'formula' || (p.type === 'html' && stripTags(p.value).trim().length > 0),
    )
    if (!hasRealContent) {
      send(400, {
        ok: false,
        error: '这篇没有正文内容（只有空白），已中止——**没有动你知乎上的草稿**。先在编辑器里写点东西再传。',
      })
      return
    }
    busy = true
    log(`开始上传草稿：${title.slice(0, 30)}（${html.length} 字节 HTML，${parts.length} 段）`)
    try {
      const result = await uploadDraft({ title, html })
      log(result.ok ? `上传完成：草稿里已有「${result.title}」` : `上传有问题：${result.error ?? '内容未确认保存'}`)
      send(200, result)
    } catch (e) {
      log('上传出错：' + String(e).slice(0, 160))
      send(500, {
        ok: false,
        error:
          '上传中断了，草稿可能只写了一半：' + String(e).slice(0, 160) + '。请到知乎草稿箱看一下，必要时手动补。',
      })
    } finally {
      busy = false
    }
    return
  }

  send(404, { ok: false, error: '未知接口' })
})

server.listen(PORT, '127.0.0.1', () => {
  const line = '='.repeat(58)
  console.log(`\n${line}`)
  console.log('  Dadealbit 知乎助手已启动')
  console.log(`  地址：http://127.0.0.1:${PORT}（只在本机可访问）`)
  console.log(`  令牌：${TOKEN}`)
  console.log('  ↑ 把上面这行令牌填进编辑器的「知乎助手令牌」里，只需填一次')
  console.log('  ⚠️ 令牌等同于"往你知乎账号写草稿"的权限，别发给别人')
  console.log('  这个窗口要一直开着；关掉它助手就停了。')
  console.log(`${line}\n`)
  // 顺手把令牌放进剪贴板，省得手抄（会覆盖你剪贴板里原有的内容）
  try {
    execFile('powershell', ['-NoProfile', '-Command', `Set-Clipboard -Value '${TOKEN}'`], () => {})
  } catch {
    /* 剪贴板失败无所谓 */
  }
})

server.on('error', (e) => {
  if (e?.code === 'EADDRINUSE') {
    console.error(`\n[x] 端口 ${PORT} 已被占用（可能是另一个助手还在跑）。`)
    console.error('    先关掉那个窗口，或者换个端口启动：')
    console.error(`    node scripts\\zhihu-assistant.mjs --port ${PORT + 1}`)
    console.error(`    （记得在编辑器面板里把「助手地址」也改成 http://127.0.0.1:${PORT + 1}）\n`)
    process.exit(1)
  }
  console.error('\n[x] 助手启动失败：' + String(e).slice(0, 200))
  process.exit(1)
})

/* 关窗口/Ctrl-C 时**不能**把正在跑的上传掐断**——那会把用户草稿留在"清空了、只填一半"的状态。
   所以先停止接收新请求，等当前任务跑完（最多等 90 秒）再退出。 */
let shuttingDown = false
const shutdown = async (signal) => {
  if (shuttingDown) return
  shuttingDown = true
  console.log(`\n收到 ${signal}，正在收尾…`)
  server.close()
  if (busy) {
    console.log('  ⚠️ 有一个上传正在进行：等它写完整篇再退出（最多 90 秒）')
    for (let i = 0; i < 90 && busy; i += 1) await new Promise((r) => setTimeout(r, 1000))
    if (busy) console.log('  ⚠️ 等不及了，现在退出——请到知乎草稿箱检查这篇是否完整')
  }
  await context?.close().catch(() => {})
  console.log('助手已关闭。')
  process.exit(0)
}
process.on('SIGINT', () => shutdown('Ctrl-C'))
process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGHUP', () => shutdown('关闭信号'))
