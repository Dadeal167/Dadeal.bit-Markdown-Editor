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
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import { createHash, randomBytes } from 'node:crypto'
import { deflateSync } from 'node:zlib'

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
/** 文章草稿列表页：用它按标题找回已有草稿（知乎写作页每次打开都是一篇新草稿） */
const DRAFT_LIST_URL = 'https://www.zhihu.com/creator/manage/creation/draft?type=article'

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

/** 用完就把"可见"浏览器关掉（带图推送会开一个窗口，推完不该让它一直杵在桌面上）。
 *  无头上下文留着复用（不占用户视线）；可见的关掉，下次要图时再开（约 2~3 秒）。 */
async function closeVisibleBrowser() {
  if (!context || !contextVisible) return
  await context.close().catch(() => {})
  context = null
  contextVisible = null
}

async function ensureBrowser({ visible = false } = {}) {  // 需要"有头"时（贴图要用系统剪贴板），已有无头窗口就先关掉重开
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

/** 日志 + 环形缓冲（最近 300 行）：出问题时连同截图一起存下来，方便定位"知乎又改了什么" */
const LOG_RING = []
const log = (...a) => {
  const line = `${new Date().toLocaleTimeString()} ${a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')}`
  console.log(...a)
  LOG_RING.push(line)
  if (LOG_RING.length > 300) LOG_RING.shift()
}

/**
 * 失败快照：把"当时页面长什么样 + 日志 + 结果"整包落到 ~/.dadealbit/failures/<时间>/。
 * 为什么要它：知乎是移动靶，出问题时光看一句"没成功"没法判断到底是哪一步变了。
 * 有了截图 + DOM + 日志，下次改版能直接定位，不用再复现一遍。
 * 只保留最近 10 份，免得越攒越多。
 */
async function saveFailureSnapshot(page, info) {
  try {
    const dir = resolve(STATE_DIR, 'failures', new Date().toISOString().replace(/[:.]/g, '-'))
    mkdirSync(dir, { recursive: true })
    if (page) {
      await page.screenshot({ path: resolve(dir, 'screenshot.png'), fullPage: false }).catch(() => {})
      const html = await page.content().catch(() => '')
      writeFileSync(resolve(dir, 'page.html'), String(html).slice(0, 2 * 1024 * 1024), 'utf-8')
      writeFileSync(resolve(dir, 'page-url.txt'), page.url(), 'utf-8')
    }
    writeFileSync(resolve(dir, 'log.txt'), LOG_RING.join('\n') || '(这次没有通过 log() 记录的内容)', 'utf-8')
    writeFileSync(resolve(dir, 'result.json'), JSON.stringify({ ...info, savedAt: new Date().toISOString() }, null, 2), 'utf-8')
    // 只留最近 10 份
    const root = resolve(STATE_DIR, 'failures')
    const dirs = readdirSync(root).sort()
    for (const old of dirs.slice(0, Math.max(0, dirs.length - 10))) {
      rmSync(resolve(root, old), { recursive: true, force: true })
    }
    log(`  已把失败现场存到：${dir}`)
    return dir
  } catch (e) {
    log('  存失败现场时出错（不影响别的）：' + String(e).slice(0, 80))
    return null
  }
}

/* ---------- 上传实现 ----------
   已实测的三个关键点（见 NEXT.md 的摸底结论）：
   1. 正文用**合成的 paste 事件**（自己造 DataTransfer）注入。曾经的写法是
      document.execCommand('insertHTML')：DOM 上立刻看得见，但刷新草稿后正文是空的 ——
      Draft.js 只认"真实的编辑事件"，execCommand('insertHTML') 不触发 beforeinput，
      它内部状态没更新，自动保存就把空正文存下去了（整篇白传）。
      合成 paste 走的是 Draft.js 自己的粘贴处理，标题/加粗/列表/引用/公式都能存住（实测）。
   2. 公式就写成知乎的 <img eeimg>，**跟着正文一起粘**，知乎会把它转成可真编辑的公式节点
      （草稿里是 <span class="FormulaCSR ztext-math isEditable" data-tex="…">）。
      老代码"先粘个探针公式看它认不认，不认就一个个开弹窗敲 LaTeX"那套已经删掉：
      探针只能靠"注入后立刻读 DOM"判断，而合成粘贴后 React 重渲染很慢（实测十几秒都读不到），
      于是永远判"不认"、公式全走慢路，探针本身还会留一段公式在草稿开头。
      现在以**刷新后的草稿**为准：数里面的公式节点，少了就告警。
   3. 知乎自动保存草稿，不需要（也没有）「保存草稿」按钮；靠等待 + 刷新验证
*/
/** 把一段 HTML 合成粘贴进正文（光标先放到末尾）。
 *  为什么不用 execCommand('insertHTML')、为什么不用系统剪贴板：见文件头的说明。 */
async function pasteHtmlInto(page, html) {
  await focusBodyEnd(page)
  await page.evaluate((h) => {
    const el = document.querySelector('.public-DraftEditor-content')
    if (!el) throw new Error('找不到正文编辑区')
    const dt = new DataTransfer()
    dt.setData('text/html', h)
    dt.setData('text/plain', el.innerText || '')
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
  }, html)
}

/* ---------- 自检：拿一篇临时草稿，把"正文/公式/图片/表格能不能过去"真跑一遍 ----------
   起因：知乎改版导致过一次**静默失效**（内容看着粘进去了、刷新后是空的），
   而用户只有在真要发文章的时候才会发现。这个自检把那条链路当场验一遍，给一句人话结论。
   安全性：实测每次打开写作页都是**一篇新的空草稿**，所以自检不会碰用户已有的稿子；
   跑完把这篇临时草稿清空（标题留着「Dadealbit 自检（可删）」，方便用户认出来删掉）。 */
const SELFCHECK_TITLE = 'Dadealbit 自检（可删）'
const SELFCHECK_MARK = '自检探针文字'

/* 自检用的探针图片：故意做成**真实截图的体积**（约 120KB）。
   以前这里是一张 150 字节的小图 —— 那么小的图知乎怎么都能收，于是"图片被知乎接管托管"永远通过；
   而用户拿真实截图（几百 KB）去传时才会遇到「图片导入失败，请重新上传」，自检却报一切正常。
   现在改成运行时生成一张噪声 PNG（噪声压不掉，字节数可控，代码里也不用塞一坨 base64）。 */
const SELFCHECK_IMG_BYTES = 120 * 1024
const CRC_TABLE = (() => {
  const t = new Int32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c
  }
  return t
})()
function crc32(buf) {
  let c = -1
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}
function pngChunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}
/** 造一张约 targetBytes 的 PNG（RGB 噪声图） */
function noisePng(targetBytes) {
  const w = 640
  const h = Math.max(8, Math.ceil(targetBytes / 3 / w))
  const stride = w * 3 + 1
  const raw = Buffer.alloc(stride * h)
  for (let i = 0; i < raw.length; i += 1) raw[i] = (Math.random() * 256) | 0
  for (let y = 0; y < h; y += 1) raw[y * stride] = 0 // 每行的过滤器字节
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8
  ihdr[9] = 2 // 8bit RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw, { level: 0 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}
const SELFCHECK_PNG_BUF = noisePng(SELFCHECK_IMG_BYTES)

async function runSelfCheck() {
  // 图片那条要用系统剪贴板（无头浏览器没有），所以自检也开可见窗口
  const ctx = await ensureBrowser({ visible: true })
  const page = await ctx.newPage()
  const steps = []
  const add = (name, ok, detail = '') => {
    steps.push({ name, ok, detail })
    log(`  自检 ${ok ? '✅' : '❌'} ${name}${detail ? '（' + detail + '）' : ''}`)
  }
  try {
    await page.goto(WRITE_URL, { waitUntil: 'domcontentloaded', timeout: 60000 })
    await page.waitForSelector('.public-DraftEditor-content', { timeout: 40000 })
    if (!/zhuanlan\.zhihu\.com\/write/.test(page.url())) {
      add('打开知乎写作页（登录状态）', false, '被重定向到登录页')
      return { ok: false, steps, error: '知乎没登录：先点「登录知乎 / 检查登录」扫码一次' }
    }
    add('打开知乎写作页（登录状态）', true)
    await page.waitForSelector('textarea[placeholder*="标题"], input[placeholder*="标题"]', { timeout: 20000 })

    // 自检固定用同一篇临时草稿：找到上次那篇就接着用（不然每点一次自检就多一篇，
    // 实测草稿箱里攒了一堆「Dadealbit 自检（可删）」）
    let reused = false
    try {
      reused = await reuseExistingDraft(page, SELFCHECK_TITLE)
    } catch {
      reused = false
    }
    if (reused) {
      // 把那篇彻底清空再用（上次探针留下的公式/表格是原子块，普通清空删不掉）
      await clearEditor(page)
      add('复用上次那篇自检草稿（不再新建）', true, '标题「' + SELFCHECK_TITLE + '」')
    } else {
      add('新建一篇自检草稿', true, '标题「' + SELFCHECK_TITLE + '」')
    }

    // 标一个只有自检才有的标题，方便用户之后认出来删掉
    // ⚠️ 标题框可能是 <textarea> 也可能是 <input>（知乎改过版），只认一种就会 30 秒超时
    //    —— 实测自检按钮就是这么坏掉的，所以这里和正式上传用同一套宽松写法。
    const titleBox = page.locator('textarea[placeholder*="标题"], input[placeholder*="标题"]').first()
    await titleBox.waitFor({ state: 'visible', timeout: 20000 })
    await titleBox.fill(SELFCHECK_TITLE)
    await page.waitForTimeout(300)

    const probe = [
      `<h2>${SELFCHECK_MARK}</h2>`,
      '<p>一段<strong>加粗</strong>的中文。</p>',
      `<p>行内公式 ${formulaImgHtml('\\frac{a}{b}', false)} 后面还有字。</p>`,
      '<table><tr><th>列一</th><th>列二</th></tr><tr><td>甲</td><td>乙</td></tr></table>',
      '<blockquote><p>引用一行</p></blockquote>',
    ].join('')
    await pasteHtmlInto(page, probe)
    await page.waitForTimeout(1500)

    /* 图片单独插：走和正式上传同一条路（剪贴板真粘贴）。
       以前这里是把内嵌 data: 图跟着探针一起粘，实测那条路知乎根本收不下 ——
       于是自检"图片被知乎接管托管"这项**测的不是真实路径**，怎么点都过。 */
    const selfImg = resolve(STATE_DIR, 'tmp', 'selfcheck-probe.png')
    mkdirSync(resolve(STATE_DIR, 'tmp'), { recursive: true })
    writeFileSync(selfImg, SELFCHECK_PNG_BUF)
    const selfVia = await insertImageDirect(page, selfImg)
    add(
      '图片能插进正文（剪贴板真粘贴，和正式上传同一条路）',
      !!selfVia,
      selfVia ? `走的是${selfVia === 'clipboard' ? '剪贴板粘贴' : selfVia}` : '没能插进去',
    )
    await page.waitForTimeout(3000)

    // 判据是"刷新后的草稿里有什么"（唯一可信的那条路）
    const read = () =>
      page.evaluate(() => {
        const root = document.querySelector('.public-DraftEditor-content')
        const imgs = [...(root?.querySelectorAll('img') ?? [])].map((im) => im.getAttribute('src') || '')
        const real = imgs.filter((s) => !/equation\?tex=/.test(s))
        return {
          title: document.querySelector('textarea[placeholder*="标题"]')?.value ?? '',
          text: (root?.innerText || '').replace(/\s+/g, ' ').trim(),
          formulas: root ? root.querySelectorAll('[data-tex], .ztext-math, img[eeimg]').length : 0,
          images: real.length,
          hosted: real.filter((s) => /(zhimg|zhihu)\.com/.test(s)).length,
          tables: root ? root.querySelectorAll('table').length : 0,
        }
      })

    let seen = { title: '', text: '', formulas: 0, images: 0, hosted: 0, tables: 0 }
    for (let i = 0; i < 6; i += 1) {
      await page.waitForTimeout(i === 0 ? 1200 : 4500)
      await page.reload({ waitUntil: 'domcontentloaded' })
      await page
        .waitForFunction(() => (document.querySelector('textarea[placeholder*="标题"]')?.value ?? '').length > 0, { timeout: 20000 })
        .catch(() => {})
      await page.waitForTimeout(700)
      seen = await read()
      if (seen.text.includes(SELFCHECK_MARK) && seen.formulas > 0 && seen.images > 0 && seen.tables > 0) break
    }
    add('正文能粘进去、刷新后还在', seen.text.includes(SELFCHECK_MARK), seen.text ? `读到「${seen.text.slice(0, 26)}…」` : '刷新后正文是空的')
    add('公式变成了知乎的真公式节点', seen.formulas > 0, `数到 ${seen.formulas} 个公式节点`)
    add(
      '图片被知乎接管托管（真实体积）',
      seen.images > 0 && seen.hosted > 0,
      seen.images > 0
        ? `${seen.hosted}/${seen.images} 张拿到知乎地址（探针图 ${Math.round(SELFCHECK_IMG_BYTES / 1024)}KB，和真实截图一个量级）`
        : '图没进去',
    )
    add('表格能过去', seen.tables > 0, `数到 ${seen.tables} 个表格`)

    // 收尾：把这页清干净（复用的是同一篇自检草稿，留着标题方便认、里面不留东西）
    await clearEditor(page)
    await page.waitForTimeout(1200)

    const failed = steps.filter((s) => !s.ok)
    // 自检没过 = 知乎可能改版了：把现场（截图 + DOM + 日志）留下来，方便直接定位
    const failureDir = failed.length ? await saveFailureSnapshot(page, { where: 'selfcheck', steps }) : null
    return {
      ok: failed.length === 0,
      steps,
      failureDir,
      title: SELFCHECK_TITLE,
      summary: failed.length
        ? `有问题：${failed.map((s) => s.name).join('、')} —— 多半是知乎改版了，助手需要更新` +
          (failureDir ? `。失败现场已存到 ${failureDir}（整个文件夹发给开发者即可）` : '（把这句发给开发者即可）')
        : '一切正常：正文 / 公式 / 图片 / 表格都能存进知乎草稿箱，可以放心点「存到草稿箱」。',
    }
  } catch (e) {
    const failureDir = await saveFailureSnapshot(page, { where: 'selfcheck', error: String(e).slice(0, 300) })
    return { ok: false, steps, failureDir, error: String(e).slice(0, 200) }
  } finally {
    await page.close().catch(() => {})
  }
}

/** 把正文清空（真的清干净）。
 *  坑：`execCommand('selectAll') + delete` 能删掉文字，但**删不掉原子块**（表格 / 图片 / 公式节点）——
 *  实测复用草稿时，上上次留下的公式和表格会一直叠加（自检里数出公式 1→2→3）。
 *  所以这里用真键盘 Ctrl+A + Delete 反复清，清完还要"数一遍"确认：文字没了、表格/图片/公式也没了。 */
async function clearEditor(page) {
  const count = () =>
    page.evaluate(() => {
      const root = document.querySelector('.public-DraftEditor-content')
      if (!root) return { text: -1, atoms: -1 }
      return {
        text: (root.innerText || '').replace(/\s+/g, '').length,
        atoms: root.querySelectorAll('table, img, [data-tex], .ztext-math, mjx-container, .katex').length,
      }
    })
  for (let round = 0; round < 5; round += 1) {
    await focusBodyEnd(page)
    await page.keyboard.press('Control+a')
    await page.waitForTimeout(150)
    await page.keyboard.press('Delete')
    await page.waitForTimeout(400)
    let c = await count()
    if (c.text === 0 && c.atoms === 0) return true
    // 键盘没清掉就再补一刀 execCommand（两条都试过才放心）
    await page.evaluate(() => {
      const el = document.querySelector('.public-DraftEditor-content')
      el?.focus()
      document.execCommand('selectAll')
      document.execCommand('delete')
    })
    await page.waitForTimeout(400)
    c = await count()
    if (c.text === 0 && c.atoms === 0) return true
  }
  return false
}

/** 找"标题完全一样"的已有草稿并打开它。
 *  为什么要这一步：实测**知乎每次打开写作页都是一篇全新的空白草稿**（不会接着上一篇），
 *  所以不做这个的话，同一篇文档传几次，草稿箱里就有几篇同名的（实测堆到 53 篇）。
 *  做法：去草稿列表页把 {(标题, 编辑链接)} 抓出来，匹配上就打开 /p/<id>/edit，
 *  后面照旧"填标题 → 清正文 → 粘贴"，自动保存落到的就是那一篇。 */
async function reuseExistingDraft(page, title) {
  const want = String(title).replace(/\s+/g, ' ').trim()
  if (!want) return false
  await page.goto(DRAFT_LIST_URL, { waitUntil: 'domcontentloaded', timeout: 45000 })
  // 列表是前端渲染的：等它出条目（最多 ~20 秒）
  let href = null
  for (let i = 0; i < 10 && !href; i += 1) {
    await page.waitForTimeout(2000)
    href = await page.evaluate((w) => {
      const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim()
      for (const a of document.querySelectorAll('a[href*="/edit"]')) {
        // 标题锚点的文字长这样："标题 编辑于 51 分钟前"，所以按"编辑于"截断
        const t = norm(norm(a.innerText).split('编辑于')[0])
        const h = a.getAttribute('href') || ''
        if (t === w && /zhuanlan\.zhihu\.com\/p\/\d+\/edit/.test(h)) return h
      }
      return null
    }, want)
  }
  if (!href) {
    /* 没找到同名草稿：**必须把页面带回写作页**再返回。
       踩过的坑：这里原来直接 return false，页面就停在"草稿列表页"上 ——
       调用方（自检）接着去列表页找标题框，必然 30 秒超时，自检永远"没通过"。 */
    await page.goto(WRITE_URL, { waitUntil: 'domcontentloaded', timeout: 60000 })
    await page.waitForSelector('.public-DraftEditor-content', { timeout: 40000 })
    return false
  }
  log(`  发现同名草稿，改它而不是新建：${href}`)
  await page.goto(href, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.waitForSelector('.public-DraftEditor-content', { timeout: 40000 })
  await page.waitForTimeout(2500)
  return true
}

/* ---------- 外链图片：先下载成本地字节，再跟着正文一起粘 ----------
   为什么必须这么做（用户实测踩到的）：文档里的图片若是**公开网址**（图床，如
   cdn.jsdelivr.net），粘贴时知乎会试着用它自己的服务器去抓那张图 —— 抓不到就在草稿里
   留一个「图片导入失败，请重新上传」的空位。这类失败特别隐蔽：
     · 图元素在、正文也对，刷新校验"数图片张数"照样通过
     · 用户电脑上（有代理）能打开那个网址，所以怎么试都像是知乎的锅
   而"跟着正文一起粘的内嵌图片"（data:）知乎是**当成内容收下**的，从来不挑网络。
   所以这里先把外链图下载下来转成 data:。知乎自己的图床地址（zhimg.com）不用动。 */
const INLINE_TIMEOUT_MS = 20000
const INLINE_MAX_BYTES = 8 * 1024 * 1024

/* ============================================================
 * 图片：**不走知乎的"导入"通道**，一张张真上传
 *
 * 为什么（用户实测两轮都失败）：只要图片是"跟着 HTML 一起粘进去的"（不管是内嵌 data:
 * 还是外链网址），知乎那边都可能留下「图片导入失败，请重新上传」——这条路我们控制不了。
 * 用户的原话是"能不能直接复制"。所以就照用户手工的做法来：
 *   路线1：把图片喂给知乎自己的上传输入框（等同于点工具栏「图片」→ 选文件）
 *   路线2：把图片写进系统剪贴板，光标放到该在的位置，按真 Ctrl+V（等同于复制粘贴）
 * 两条都试，成功一条就算成；两条都不行才退回"跟着正文粘"的老办法。
 * ============================================================ */

/** 剪贴板贴图要靠 PowerShell 调 Windows Forms —— 这是当年实测能用的那段脚本 */
const SET_CLIPBOARD_PS = `param([string]$Path)
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$img = [System.Drawing.Image]::FromFile($Path)
if (-not $img) { throw "cannot load image" }
[System.Windows.Forms.Clipboard]::SetImage($img)
$img.Dispose()
Write-Output 'ok'
`

/** 把一张图片放进系统剪贴板（会覆盖用户剪贴板里的内容） */
function setClipboardImage(filePath) {
  return new Promise((res) => {
    try {
      const psFile = resolve(STATE_DIR, 'set-clipboard-image.ps1')
      writeFileSync(psFile, SET_CLIPBOARD_PS, 'ascii')
      execFile(
        'powershell',
        ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', psFile, filePath],
        { timeout: 30000 },
        (err, stdout) => res(!err && /ok/i.test(String(stdout))),
      )
    } catch {
      res(false)
    }
  })
}

/** 数一数编辑器里已经有几张"被知乎托管"的图片（用来判断上传有没有成功）
 *  注意：**草稿里的图不一定是 picx.zhimg.com** —— 实测粘贴进去的图是
 *  pic-private 那个域（草稿私有图床），所以判定要用 zhihu 全域，
 *  只认 zhimg 会把成功的图误判成失败。 */
function countHostedImages(page) {
  return page.evaluate(() => {
    const root = document.querySelector('.public-DraftEditor-content')
    return [...(root?.querySelectorAll('img') ?? [])].filter(
      (im) => !im.hasAttribute('eeimg') && /(zhimg|zhihu)\.com/.test(im.getAttribute('src') || ''),
    ).length
  })
}

/** 等到"托管图片数"达到 target，并且**稳住**（每 1 秒看一眼，最多 tries 次）
 *  为什么要"稳"：图片上传是异步的，刚插进去时 DOM 上已经有图了，但知乎那边还在上传；
 *  这时紧接着粘下一段正文，前一张图会被挤掉（实测：3 张只留下 2 张）。 */
async function waitHosted(page, target, tries = 40, settleMs = 0) {
  for (let i = 0; i < tries; i += 1) {
    await page.waitForTimeout(1000)
    if ((await countHostedImages(page).catch(() => 0)) >= target) {
      if (!settleMs) return true
      await page.waitForTimeout(settleMs)
      if ((await countHostedImages(page).catch(() => 0)) >= target) return true
    }
  }
  return false
}

/** 只确保"焦点在正文编辑区里"，**绝不动光标位置**。
 *  为什么单独写一个：图片要插在"标记被删掉的那个位置"。一旦调用 focusBodyEnd
 *  （它 selectNodeContents + collapse(false)，把光标甩到正文末尾），所有图就会全堆到最后 ——
 *  用户看到的现象正是"图都在末尾"（我自己的测试只数了图片个数、没验位置，所以一直没发现）。 */
async function keepEditorFocus(page) {
  await page.evaluate(() => {
    const el = document.querySelector('.public-DraftEditor-content')
    if (!el) return
    if (!el.contains(document.activeElement)) el.focus()
  })
}

/** 触发一次保存并**真的等它存完**（页面右下角状态：保存中 → 已保存/刚刚）。
 *
 *  为什么不能只看状态里有没有「刚刚」：上一次保存留下的"刚刚"会一直在那儿，
 *  一眼看去像是已经存好了，其实这一张图根本没进保存快照 ——
 *  实测表现就是"图插进去了、刷新后草稿里少一张"（甚至 3 张只留 1 张）。 */
async function nudgeAndWaitSaved(page, timeoutMs = 30000) {
  try {
    await keepEditorFocus(page)
    // 敲一个空格再退格：保证内容真的变了一次（Draft.js 收到真实输入事件），从而触发保存
    await page.keyboard.type(' ')
    await page.keyboard.press('Backspace')
  } catch {
    /* 敲不进去也没关系，下面照等 */
  }
  const t0 = Date.now()
  let sawSaving = false
  while (Date.now() - t0 < timeoutMs) {
    const status = await page
      .evaluate(() => (document.body.innerText.match(/(已保存|保存中|保存失败|刚刚|\d+ 分钟前)/g) ?? []).join(','))
      .catch(() => '')
    if (/保存中/.test(status)) sawSaving = true
    if (sawSaving && /已保存|刚刚|分钟前/.test(status)) return true
    // 有的保存太快，看不到「保存中」：给一段固定时间就放行，别死等
    if (!sawSaving && Date.now() - t0 > 8000) return true
    await page.waitForTimeout(1000)
  }
  return false
}

/** 路线2：写进系统剪贴板 + 真 Ctrl+V（实测可行，等同于用户复制一张图再粘到正文里） */
async function pasteViaClipboard(page, file, before) {
  try {
    if (!(await setClipboardImage(file))) {
      log('  剪贴板贴图不可用（放不进剪贴板），改用别的方式')
      return false
    }
    // ⚠️ 这里**不能**动光标：此刻光标正停在"标记被删掉的位置"，那就是图片该在的地方
    await keepEditorFocus(page)
    await page.waitForTimeout(400)
    await page.keyboard.press('Control+V')
    // 等它**传完并稳住**（6 秒内不再变化）再返回，否则后面的操作会把这图挤掉
    const ok = await waitHosted(page, before + 1, 40, 6000)
    // 再敲一个回车把这张图"落定"，并**留在原位**（不要跳回正文末尾）
    if (ok) {
      await keepEditorFocus(page)
      await page.keyboard.press('Enter')
      await page.waitForTimeout(800)
      // 关键：等知乎把这张图**存到服务器**再走下一步（否则下一张会把它顶掉）
      await nudgeAndWaitSaved(page)
    }
    return ok
  } catch {
    return false
  }
}

/**
 * 插一张图：走**剪贴板真粘贴**（实测这条路能让知乎正常收下图片）。
 *
 * 为什么不用别的路（都是实测结论）：
 *   · 跟着 HTML 一起粘（内嵌 data:）→ 知乎前端直接崩一下（控制台报
 *     "Cannot read properties of null (reading 'setAttribute')"），图**根本没进去**
 *   · 点工具栏「图片」按钮想触发文件选择 → 8 秒内没有 filechooser 事件，这条路不成立
 *   · 写进系统剪贴板 + 真 Ctrl+V → 图片正常进草稿（草稿私有图床），刷新后还在 ✅
 * 代价：会占用系统剪贴板，而且需要**有头**浏览器窗口（无头浏览器没有系统剪贴板）。
 */
async function insertImageDirect(page, file) {
  const before = await countHostedImages(page).catch(() => 0)
  if (await pasteViaClipboard(page, file, before)) return 'clipboard'
  return null
}

/**
 * 把正文里的图片一个个切出来，落成本地临时文件（正文切成 文字/图片/文字/图片… 交替的段）。
 *
 * ⚠️ 切分依据是**裸的 `<img src=...>` 标签**，不是"包着图的段落"。
 * 这是踩过的坑：编辑器（Tiptap）导出的 HTML 里图片就是顶层的一个裸 `<img>`，
 * **不会被 `<p>` 包住**（实测导出的就是 `<p>文字</p><img src="data:..."><p>文字</p>`）。
 * 早先按 `<p><img></p>` 找，真实文档里一张都切不出来 —— 图片留在正文里、
 * 又被知乎那条会失败的导入通道吞掉，用户看到的还是「图片导入失败」。
 * 切点安全：图片在导出结构里是块级顶层节点，前后不会切开半个标签。
 */
export async function extractImageFiles(html, tmpDir, page = null) {
  const segments = []
  const queue = []
  const re = /<img\b[^>]*>/gi
  let last = 0
  let n = 0
  let m
  while ((m = re.exec(html))) {
    const tag = m[0]
    // 公式在知乎编辑器里也是 <img>（eeimg / equation?tex=），不能当图片切
    if (/\beeimg\b/i.test(tag) || /equation\?tex=/i.test(tag)) continue
    const sm = tag.match(/\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)')/i)
    const src = (sm?.[1] ?? sm?.[2] ?? '').trim()
    if (!/^(data:|https?:)/i.test(src)) continue // 本地路径留给前面的守卫去拦
    if (m.index > last) segments.push({ type: 'html', value: html.slice(last, m.index) })
    const got = await fetchImageBytes(src, page)
    if (!got) {
      // 拿不到字节：留在正文里，让知乎自己去试（至少不丢内容）
      segments.push({ type: 'html', value: tag })
    } else {
      const file = resolve(tmpDir, `push-img-${n}.${got.ext}`)
      writeFileSync(file, got.buf)
      queue.push({ index: n, src, file, bytes: got.buf.length })
      segments.push({ type: 'image', index: n, file, src })
      n += 1
    }
    last = m.index + tag.length
  }
  if (last < html.length) segments.push({ type: 'html', value: html.slice(last) })
  return { segments: segments.length ? segments : [{ type: 'html', value: html }], queue }
}

const extOf = (mime) =>
  mime.includes('jpeg') || mime.includes('jpg') ? 'jpg' : mime.includes('gif') ? 'gif' : mime.includes('webp') ? 'webp' : 'png'

/** 把 jsDelivr 的地址换成它的其它镜像域名（同一个路径）。
 *  为什么要换：cdn.jsdelivr.net 有时会 302 到 raw.githubusercontent.com，
 *  而那个域名在用户这台机器上 DNS 都不通（实测），于是下载失败 —— 换镜像能绕开。 */
function jsdelivrMirrors(src) {
  const m = src.match(/^https?:\/\/cdn\.jsdelivr\.net(\/.*)$/i)
  if (!m) return []
  return ['fastly.jsdelivr.net', 'gcore.jsdelivr.net', 'testingcf.jsdelivr.net'].map((h) => `https://${h}${m[1]}`)
}

/** 取图片字节：内嵌 data: 直接解码；外链用 Node 下载（原地址 + jsDelivr 镜像，各试几轮）。
 *
 *  为什么不用浏览器页面的 fetch（试过，不通）：jsDelivr 会 302 到 raw.githubusercontent.com，
 *  那边既没有 CORS 头（浏览器读不了响应体 → "Failed to fetch"），在这台机器上还 DNS 不通。
 *  而 Node 直连 cdn.jsdelivr.net 有时能拿到 200（CDN 缓存命中时不重定向），所以**重试 + 换镜像**很值。
 *  实在拿不到的，就让它留在正文里交给知乎自己去抓（知乎那条路有时也能成），并如实记进警告。 */
async function fetchImageBytes(src, _page = null) {
  try {
    if (/^data:/i.test(src)) {
      const m = src.match(/^data:([^;,]*)(;base64)?,([\s\S]*)$/i)
      if (!m) return null
      const mime = (m[1] || 'image/png').toLowerCase()
      const buf = m[2] ? Buffer.from(m[3], 'base64') : Buffer.from(decodeURIComponent(m[3]), 'binary')
      return { buf, ext: extOf(mime) }
    }
    const candidates = [src, ...jsdelivrMirrors(src)]
    for (let round = 0; round < 2; round += 1) {
      for (const url of candidates) {
        const ctl = new AbortController()
        const timer = setTimeout(() => ctl.abort(), INLINE_TIMEOUT_MS)
        try {
          const res = await fetch(url, { signal: ctl.signal, redirect: 'follow' })
          if (!res.ok) continue
          const mime = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase()
          if (!/^image\//.test(mime)) continue
          const buf = Buffer.from(await res.arrayBuffer())
          if (!buf.length || buf.length > INLINE_MAX_BYTES) continue
          return { buf, ext: extOf(mime) }
        } catch {
          /* 这个地址没成，试下一个 */
        } finally {
          clearTimeout(timer)
        }
      }
      await new Promise((r) => setTimeout(r, 1000))
    }
    return null
  } catch {
    return null
  }
}

export async function inlineRemoteImages(html, page = null) {
  const tags = [...new Set((html.match(/<img\b[^>]*>/gi) ?? []).filter((t) => !/\beeimg\b/i.test(t)))]
  const jobs = []
  for (const tag of tags) {
    const m = tag.match(/\bsrc\s*=\s*("([^"]*)"|'([^']*)')/i)
    const src = (m?.[2] ?? m?.[3] ?? '').trim()
    if (!/^https?:\/\//i.test(src)) continue
    if (/(zhimg|zhihu)\.com/i.test(src)) continue // 知乎自己的图：本来就能直接显示
    jobs.push(src)
  }
  const out = { html, inlined: 0, failed: [] }
  for (const src of jobs) {
    const got = await fetchImageBytes(src, page)
    if (got) {
      const dataUrl = `data:${got.ext === 'jpg' ? 'image/jpeg' : 'image/' + got.ext};base64,${got.buf.toString('base64')}`
      // 同一张图可能出现多次，全部替换
      out.html = out.html.split(src).join(dataUrl)
      out.inlined += 1
      log(`  外链图片已内嵌：${src.slice(0, 60)}…（${Math.round(got.buf.length / 1024)}KB）`)
    } else {
      out.failed.push({ src, why: '下载失败（浏览器和本机网络都没拿到）' })
      log(`  外链图片下载失败：${src.slice(0, 60)}…`)
    }
  }
  return out
}

async function uploadDraft({ title, html }) {
  /* 图片分三类：内嵌 data:（要单独插进去）/ 公开网址（**先在浏览器里下载下来**，见上）/
     本地路径（知乎拿不到，必须拦掉）。 */
  // 守卫先做，而且**不开浏览器**：本地图片直接拒收，用户知乎上的草稿一点不动
  const imgStats0 = classifyImages(html)
  const imagesExpected = imgStats0.total
  if (imgStats0.local > 0) {
    log(`拒收：${imgStats0.local} 张图片是本地路径（${imgStats0.localNames.join('、')}），知乎读不到，没动草稿`)
    return { ok: false, error: localImageBlockText(imgStats0), imagesExpected, imagesInDraft: 0 }
  }
  // 有图就必须开**可见**窗口：插图走系统剪贴板，无头浏览器没有剪贴板
  const ctx = await ensureBrowser({ visible: imagesExpected > 0 })
  const page = await ctx.newPage()
  const warnings = []
  // 各步骤耗时：上传完打一行，慢了知道该看哪儿
  const t0 = Date.now()
  let tPrev = t0
  const timings = []
  const step = (name) => {
    const now = Date.now()
    timings.push(`${name} ${((now - tPrev) / 1000).toFixed(1)}s`)
    tPrev = now
  }
  try {
    // 外链图片：先尽量在本机拿下来（Node 直连 CDN，多重试几次）
    const inlined = await inlineRemoteImages(html)
    html = inlined.html
    if (inlined.inlined > 0) {
      warnings.push(`有 ${inlined.inlined} 张图片是外链网址，已先下载下来再传（知乎自己抓外链经常抓不到）`)
    }
    if (inlined.failed.length) {
      warnings.push(
        `有 ${inlined.failed.length} 张外链图片没能下载下来（${inlined.failed.map((f) => f.why).join('、')}）——` +
          `这几张到知乎里可能显示「图片导入失败」，建议在编辑器里重新插一次`,
      )
    }
    const parts = splitParts(html)
    // 正文（公式已换成知乎认的 <img eeimg>）：图片要从这里面切出来单独真上传
    const bodyHtml = parts
      .map((p) => (p.type === 'formula' ? formulaImgHtml(p.latex, p.display) : p.value))
      .join('')
    const imgStats = classifyImages(bodyHtml)
    /* 图片走"真上传"：从正文里切出来 → 落成本地临时文件 → 在编辑器里一张张插进去。
       这样就不经过知乎的"导入"通道（那条路实测会出「图片导入失败」）。 */
    const tmpDir = resolve(STATE_DIR, 'tmp')
    mkdirSync(tmpDir, { recursive: true })
    // 清掉上一次推送留下的临时图片（只留这一次的，方便出问题时看现场，也不会越攒越多）
    try {
      for (const f of readdirSync(tmpDir)) {
        if (f.startsWith('push-img-')) rmSync(resolve(tmpDir, f), { force: true })
      }
    } catch {
      /* 清不掉就算了 */
    }
    const { segments, queue } = await extractImageFiles(bodyHtml, tmpDir, page)
    const dataExpected =
      queue.length + classifyImages(segments.filter((s) => s.type === 'html').map((s) => s.value).join('')).embedded
    if (queue.length) log(`准备直接插入 ${queue.length} 张图片（不走知乎的导入通道）`)
    /* 把这次要推的内容存一份到 ~/.dadealbit/last-push.*（只留最近一次）。
       为什么：图片问题排查全靠"当时推的到底是什么"——是内嵌图、外链还是本地路径，
       光看界面看不出来（上一轮就是靠推理才知道推的是外链）。 */
    try {
      writeFileSync(resolve(STATE_DIR, 'last-push.html'), html, 'utf-8')
      writeFileSync(
        resolve(STATE_DIR, 'last-push.json'),
        JSON.stringify(
          {
            at: Date.now(),
            title,
            bytes: html.length,
            images: imgStats,
            remoteInlined: inlined.inlined,
            remoteFailed: inlined.failed,
            directInsert: queue.length,
            directBytes: queue.reduce((n, q) => n + q.bytes, 0),
          },
          null,
          2,
        ),
        'utf-8',
      )
    } catch {
      /* 存不下就算了 */
    }
    await page.goto(WRITE_URL, { waitUntil: 'domcontentloaded', timeout: 60000 })
    await page.waitForSelector('.public-DraftEditor-content', { timeout: 40000 })
    step('打开写作页')

    // 判断是否登录：未登录会被重定向到登录页
    if (!/zhuanlan\.zhihu\.com\/write/.test(page.url())) {
      return { ok: false, needLogin: true, error: '看起来没有登录，请先点「登录知乎」' }
    }
    // 等标题框出现就够了，别死等固定秒数
    await page.waitForSelector('textarea[placeholder*="标题"], input[placeholder*="标题"]', { timeout: 20000 })
    step('等页面就绪')

    // 标题（知乎限 100 字，超了会被截断导致后续校验对不上，这里先自己截断并提示）
    const titleEl = page.locator('textarea[placeholder*="标题"], input[placeholder*="标题"]').first()
    if ((await titleEl.count()) === 0) {
      return { ok: false, error: '找不到标题输入框（知乎可能改版了）' }
    }
    const rawTitle = title || '未命名文档'
    const safeTitle = [...rawTitle].slice(0, 100).join('')
    if (safeTitle !== rawTitle) warnings.push(`标题超过知乎的 100 字上限，已截断到前 100 字`)

    /* 已经有同名草稿就改那一篇，而不是再新建一篇（知乎写作页每次打开都是新草稿）。
       找不到就还在这篇新草稿上写（老行为）。 */
    let reusedDraft = false
    try {
      reusedDraft = await reuseExistingDraft(page, safeTitle)
    } catch (e) {
      log('  查同名草稿时出错（不影响上传，按新建处理）：' + String(e).slice(0, 80))
    }
    if (!reusedDraft) {
      // 查完会停在草稿列表页，回到写作页继续（新草稿）
      await page.goto(WRITE_URL, { waitUntil: 'domcontentloaded', timeout: 60000 })
      await page.waitForSelector('.public-DraftEditor-content', { timeout: 40000 })
      await page.waitForSelector('textarea[placeholder*="标题"], input[placeholder*="标题"]', { timeout: 20000 })
    }
    step(reusedDraft ? '找到同名草稿并打开' : '新建草稿')

    const titleBox = page.locator('textarea[placeholder*="标题"], input[placeholder*="标题"]').first()
    await titleBox.click()
    await titleBox.fill(safeTitle)
    await page.waitForTimeout(400)
    step('填标题')

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

    // 清空正文（复用旧草稿时，上一次的内容必须彻底删掉 —— 文字、表格、图片、公式都是）
    const cleared = await clearEditor(page)
    if (!cleared) warnings.push('正文没清干净（可能有上次留下的内容），这次是接着写的')
    // 注意：这里**不要**再 click() 正文区 —— 正文上压着浮动工具条（"加粗"那些），
    // 点击会被它挡住，Playwright 会一直重试到 30 秒超时才被 catch 吞掉（白等半分钟，实测）。
    // 真正要紧的是"焦点 + 光标在正文里"，focusBodyEnd 已经做了。
    const focusOk = await page.evaluate(() => {
      const el = document.querySelector('.public-DraftEditor-content')
      return !!el && (el === document.activeElement || el.contains(document.activeElement))
    })
    if (!focusOk) {
      warnings.push('光标没能进到正文里，内容可能会插错位置（已继续尝试）')
      await page.evaluate(() => document.querySelector('.public-DraftEditor-content')?.focus())
      await page.waitForTimeout(300)
    }
    step('读旧草稿 + 清空正文')

    /* 清空之后要**等到编辑器里真的没有图了**再开始插。
       为什么：同名草稿复用时会先清空，但知乎那边是异步的 —— 旧图还在 DOM 里时，
       "插入成功"的判定（数托管图片的个数）会被旧图顶替，于是提前认为插好了、
       紧接着粘下一段，真正那张就被挤掉（实测 3 张只留 2 张）。 */
    if (queue.length) {
      for (let i = 0; i < 10; i += 1) {
        if ((await countHostedImages(page).catch(() => 0)) === 0) break
        await page.waitForTimeout(1000)
      }
      const left = await countHostedImages(page).catch(() => 0)
      if (left > 0) log(`  注意：清空后编辑器里还剩 ${left} 张图（可能影响计数判定）`)
    }

    /* 正文整篇一次粘完（文字 + 公式标记 + 内嵌图片都在同一段 HTML 里）。
       公式写成知乎的 <img eeimg>，粘贴时它自己会转成**真公式节点**
       （实测草稿里是 <span class="FormulaCSR ztext-math isEditable" data-tex="…">，可再编辑）；
       data: 图片也是它自己接过去重新托管（草稿里变成 picx.zhimg.com 的地址）。
       一百多个公式的稿子从"十几分钟"降到"一次粘贴"，有图也不用再一张张等。 */
    let formulaDone = 0
    let formulaFailed = 0
    /** 图在草稿里、但没被知乎接手托管的张数（草稿里就是「图片导入失败」） */
    let imagesUnhosted = 0

    const formulaParts = parts.filter((p) => p.type === 'formula')
    // 公式统一走粘贴：把公式写成知乎的 <img eeimg>，粘贴时它自己会转成**真公式节点**
    // （实测：草稿里是 <span class="FormulaCSR ztext-math isEditable" data-tex="…">，可以再编辑）。
    // 老代码先粘一个"探针公式"看它认不认，不认就退回一个个开弹窗 —— 那是 execCommand 时代的补丁：
    // 探针只能靠"注入后立刻读 DOM"判断，而合成粘贴后 React 重渲染很慢（实测十几秒都读不到），
    // 于是探针永远判"不认"，公式全走慢路，而且探针本身还会把一段公式留在草稿开头。
    // 现在改成：全部用粘贴，**上传完刷新草稿再数公式**（那才是可信的判据），不够就告警。
    if (formulaParts.length > 0) {
      log(`  公式走粘贴通道：整篇连同公式一次粘进去（共 ${formulaParts.length} 个公式）`)
    }

    /* 正文一次粘完（图片位置先留**占位标记**），再把标记逐个换成真图。
       为什么不像上一版那样"粘一段文字 → 插一张图 → 再粘一段"：
       实测那种交替节奏不稳 —— 图片还在上传时，紧接着的文字粘贴会把它顶掉/冲掉，
       8 张图有时只存下 4 张（而且日志里每张都"插入成功"）。现在：
         1. 正文（含公式）一次粘贴，图片位置放 <p>DADEALBITIMGnMARK</p>
         2. 等正文落定
         3. 逐个把标记选中、删掉，光标就停在该位置，然后 Ctrl+V 真粘贴图片
       这样图片插入之间不再夹着大段粘贴，位置也由标记保证是准的。 */
    formulaDone = formulaParts.length
    let insertedDirect = 0
    let pastedFallback = 0
    const MARK = (i) => `DADEALBITIMG${i}MARK`
    const pasteHtml = segments
      .map((seg) => (seg.type === 'html' ? seg.value : `<p>${MARK(seg.index)}</p>`))
      .join('')
    await pasteHtmlInto(page, pasteHtml)
    await page.waitForTimeout(2500)
    log(`  正文一次粘完（${queue.length} 张图的位置留了标记）`)

    /* 在编辑器里找标记、选中它、删掉它。
       返回 'ok'（删掉了）/ 'notfound'（找不到标记）/ 'stuck'（选中了但没删掉）。 */
    const cutMarker = async (mk) => {
      // ⚠️ 必须先让编辑器拿到焦点，否则"设了选区"也不生效：Backspace 会删到别处，
      //    标记留在正文里（实测：前两张图的标记就这么留在了草稿里，图也被贴到别处）
      await keepEditorFocus(page)
      await page.waitForTimeout(150)
      const found = await page
        .evaluate((mark) => {
          const root = document.querySelector('.public-DraftEditor-content')
          if (!root) return false
          const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
          let node = walker.nextNode()
          while (node) {
            const at = (node.nodeValue || '').indexOf(mark)
            if (at >= 0) {
              const r = document.createRange()
              r.setStart(node, at)
              r.setEnd(node, at + mark.length)
              const sel = window.getSelection()
              sel.removeAllRanges()
              sel.addRange(r)
              return true
            }
            node = walker.nextNode()
          }
          return false
        }, mk)
        .catch(() => false)
      if (!found) return 'notfound'
      await page.keyboard.press('Backspace')
      await page.waitForTimeout(400)
      const still = await page
        .evaluate((mark) => (document.querySelector('.public-DraftEditor-content')?.innerText || '').includes(mark), mk)
        .catch(() => false)
      return still ? 'stuck' : 'ok'
    }

    for (const item of queue) {
      const marker = MARK(item.index)
      let cut = await cutMarker(marker)
      if (cut === 'stuck') {
        // 再试一次（有时第一次按键被编辑器吃掉）
        cut = await cutMarker(marker)
        if (cut !== 'ok') log(`  第 ${item.index + 1} 张图的标记没能删掉（${cut}）`)
      }

      if (cut === 'ok') {
        // 光标就停在标记原来的位置，接着把图贴上去
      } else {
        // 找不到标记（知乎把文字拆散了）：退化为插到正文末尾，位置可能不精确
        pastedFallback += 1
        log(`  第 ${item.index + 1} 张图的位置标记没找到，改插到正文末尾`)
        await focusBodyEnd(page)
        await page.waitForTimeout(300)
      }

      let via = await insertImageDirect(page, item.file)
      if (!via) {
        await page.waitForTimeout(3000)
        via = await insertImageDirect(page, item.file)
      }
      if (via) {
        insertedDirect += 1
        log(`  第 ${insertedDirect}/${queue.length} 张图已插入（剪贴板粘贴）`)
        /* 落定后再确认一次：草稿里的托管图片数应该 ≥ 已插入张数。
           实测偶尔会有图被后一次插入/重排挤掉（8 张里少 1 张），这里发现少了就补插一次。 */
        await page.waitForTimeout(1500)
        const nowHosted = await countHostedImages(page).catch(() => 0)
        if (nowHosted < insertedDirect) {
          log(`  发现少了一张（草稿里 ${nowHosted} 张 < 已插 ${insertedDirect} 张），补插一次`)
          await focusBodyEnd(page)
          await page.waitForTimeout(300)
          if (await insertImageDirect(page, item.file)) {
            log('  补插成功')
          } else {
            warnings.push(`有 1 张图片插入后被知乎丢掉了（第 ${item.index + 1} 张），建议到草稿里看一眼`)
          }
        }
      } else {
        pastedFallback += 1
        log(`  第 ${item.index + 1} 张图插不进去，退回"跟着正文粘"（可能显示导入失败）`)
        await pasteHtmlInto(page, `<img src="${item.src}">`)
        await page.waitForTimeout(1200)
      }
    }
    /* 收尾一：把还留在正文里的标记清干净。
       标记是内部占位符，**绝不能留在用户草稿里**（实测出现过"图插进去了、标记还留着"）。
       逐个再找一遍，找到就删；删不掉的记进警告，让用户知道。 */
    let markersLeft = 0
    for (const item of queue) {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const cut = await cutMarker(MARK(item.index))
        if (cut === 'ok') {
          markersLeft += 1
          break
        }
        if (cut === 'notfound') break
      }
    }
    if (markersLeft) log(`  收尾：清掉了 ${markersLeft} 处残留的位置标记`)
    if (queue.length) {
      warnings.push(
        `图片走的是直接插入：${insertedDirect}/${queue.length} 张成功` +
          (pastedFallback ? `，${pastedFallback} 张没插上（退回旧办法，可能显示「图片导入失败」）` : ''),
      )
    }
    // 等它落进 Draft.js：这里不等 DOM（React 重渲染慢，读不准），
    // 只等一小会儿让粘贴事件处理完，剩下的交给"刷新后草稿"来判定。
    await page.waitForTimeout(1500)

    /* 最后再"弄脏"一下文档，逼知乎**重新保存一次**。
       为什么：实测图片插完后 DOM 里都在，但草稿有时只存下 7/8 张 ——
       说明知乎那次保存发生在某张图还没落定时，之后没有再存。这里敲一个回车（内容变了），
       让它把"现在这份完整内容"再存一遍。 */
    if (insertedDirect > 0) {
      try {
        await focusBodyEnd(page)
        await page.keyboard.press('Enter')
        await page.waitForTimeout(4000)
      } catch {
        /* 弄脏失败不影响主流程 */
      }
    }
    step(`粘贴正文（含公式${insertedDirect ? `；${insertedDirect} 张图直接插入` : ''}）`)

    // 公式数量不在这里数：合成粘贴后 React 重渲染慢，DOM 上读不准（实测十几秒还读不到）。
    // 真正的判据是下面"刷新后的草稿"里的公式节点数。

    // 等自动保存：知乎没有保存按钮，靠"刷新后内容还在"来确认。
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

    const beforeReload = await readEditor()
    log(`注入后（刷新前）正文长度 ${beforeReload.bodyText.length}，状态「${beforeReload.status}」`)
    // 注意：这里读不到正文**不算异常** —— 合成粘贴后 React 重渲染很慢，
    // 刷新前 DOM 上经常还是空的，但草稿其实已经存下了。所以只记一行，不当失败。
    step('等保存')

    // 刷新验证：以"刷新后草稿里有什么"为准（这是唯一可信的判据）。
    // 第一轮先快试一次（多数情况已经存好了），不够再逐轮加长等待。
    let after = { title: '', text: '', formulas: 0, images: 0, hosted: 0, imageSrcs: [], markersLeft: 0 }
    const attempts = imagesExpected > 0 ? 6 : 4
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      await page.waitForTimeout(attempt === 0 ? 1200 : 5000 + attempt * 4000)
      await page.reload({ waitUntil: 'domcontentloaded' })
      // 别死等固定秒数：等到标题框有值（知乎把草稿灌进来）就开始读
      await page
        .waitForFunction(
          () => (document.querySelector('textarea[placeholder*="标题"]')?.value ?? '').length > 0,
          { timeout: 20000 },
        )
        .catch(() => {})
      await page.waitForTimeout(600)
      after = await page.evaluate(() => {
        const t = document.querySelector('textarea[placeholder*="标题"]')?.value ?? ''
        const root = document.querySelector('.public-DraftEditor-content')
        const imgs = root ? [...root.querySelectorAll('img')] : []
        // 公式也是 img（eeimg）：数图片时要把它们排除，否则"图片都在"会被公式图片顶替
        const real = imgs.filter(
          (im) => !im.hasAttribute('eeimg') && !/\/equation\?tex=/.test(im.getAttribute('src') || ''),
        )
        /* 草稿"骨架"：按文档顺序把段落和图片平铺出来（图片写成 [图]）。
           为什么用 [data-block]：知乎编辑器是 Draft.js，段落是它自己的块（div[data-block="true"]），
           用 p/h1 选不到正文段落（踩过：骨架里只剩标题和图片）。
           为什么需要它：只数图片个数看不出**位置**对不对 —— 曾经所有图都被插到末尾，个数校验照样通过。 */
        const blocks = root ? [...root.querySelectorAll('[data-block="true"]')] : []
        const outline = blocks
          .map((el) => {
            const hasImg = el.tagName === 'IMG' || !!el.querySelector('img:not([eeimg]), figure')
            const txt = (el.textContent || '').replace(/\s+/g, ' ').trim()
            if (hasImg) return txt ? `[图]${txt.slice(0, 8)}` : '[图]'
            return txt ? txt.slice(0, 14) : ''
          })
          .filter(Boolean)
          .slice(0, 40)
          .join(' | ')
          .slice(0, 600)
        return {
          title: t,
          text: (root?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 60),
          formulas: root
            ? root.querySelectorAll('[data-tex], .ztext-math, img[eeimg], mjx-container, .katex, [class*="Math"], [class*="math"]').length
            : 0,
          images: real.length,
          // 图片有没有真的被知乎收下：看地址有没有换成知乎自己的域名。
          // ⚠️ 必须写成 (zhimg|zhihu).com —— 实测直接粘进草稿的图是
          // pic-private 那个域（草稿私有图床），只认 picx.zhimg.com 会把成功的图误判成失败。
          // 光数 <img> 也不够：导入失败的图**元素还在**（草稿里显示「图片导入失败，请重新上传」）。
          hosted: real.filter((im) => /(zhimg|zhihu)\.com/.test(im.getAttribute('src') || '')).length,
          // 表格过不过得去（贴 HTML 表格时知乎可能不认）—— 只做记录，不参与成功判定
          tables: root ? root.querySelectorAll('table').length : 0,
          // 图片地址（截断存日志，便于事后判断是哪几张出了问题）
          imageSrcs: real.map((im) => (im.getAttribute('src') || '').slice(0, 48)).slice(0, 5),
          // 草稿骨架（段落 / 图片的顺序）—— 判断图片有没有插在原位
          outline,
          // 残留的位置标记数（必须为 0：那是内部占位符，不该出现在用户草稿里）
          markersLeft: ((root?.innerText || '').match(/DADEALBITIMG\d+MARK/g) ?? []).length,
        }
      })
      const okNow =
        after.title === draftTitle &&
        !!after.text &&
        (formulaParts.length === 0 || after.formulas >= formulaParts.length) &&
        (imagesExpected === 0 || after.images >= imagesExpected) &&
        after.hosted >= dataExpected
      log(
        `  校验第 ${attempt + 1} 次：标题${after.title === draftTitle ? '✓' : '✗'} 正文${after.text ? '✓' : '✗'} 公式 ${after.formulas}/${formulaParts.length} 图片 ${after.images}/${imagesExpected}（知乎托管 ${after.hosted}/${dataExpected}）`,
      )
      if (after.outline) log(`  草稿骨架：${after.outline}`)
      if (okNow) break
    }
    step('刷新校验')
    log(`  各步骤耗时：${timings.join(' · ')}（合计 ${((Date.now() - t0) / 1000).toFixed(1)}s）`)
    const saved = after.title === safeTitle
    if (saved && !after.text) warnings.push('刷新后正文是空的（草稿可能没保存成功）')
    // 公式是"粘贴 <img eeimg> → 知乎自己转成公式节点"，所以要以刷新后的草稿为准
    if (formulaParts.length > 0 && after.formulas < formulaParts.length) {
      warnings.push(
        `刷新后草稿里只数到 ${after.formulas} 个公式，应该有 ${formulaParts.length} 个（知乎可能没把它们当公式存，去草稿里看一眼）`,
      )
      formulaFailed = formulaParts.length - after.formulas
    }
    if (imagesExpected > 0 && after.images < imagesExpected) {
      warnings.push(`草稿里只有 ${after.images} 张图片，应该有 ${imagesExpected} 张`)
    }
    // 残留的内部标记：绝不该出现在用户草稿里（实测出现过，表现是正文里多出一串 DADEALBITIMGnMARK 文字）
    if (after.markersLeft > 0) {
      warnings.push(
        `草稿里还留着 ${after.markersLeft} 处内部占位标记（形如 DADEALBITIMG0MARK 的文字）——` +
          `请手动删掉这几处，并把那几张图重新插一次`,
      )
    }
    // 图在、但没被知乎接管 = 草稿里很可能就是「图片导入失败，请重新上传」
    if (dataExpected > 0 && after.hosted < dataExpected) {
      warnings.push(
        `有 ${dataExpected - after.hosted} 张图片没被知乎接手托管（草稿里可能显示「图片导入失败，请重新上传」）——` +
          `到知乎草稿箱看一眼，缺的图重新插一次`,
      )
      imagesUnhosted = Math.max(0, dataExpected - after.hosted)
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

    // 成功判定要把公式和图片算进去：少东西、或者图没被知乎接管，都不该报"成功"
    const contentOk =
      saved &&
      !!after.text &&
      formulaFailed === 0 &&
      imagesExpected === after.images &&
      imagesUnhosted === 0 &&
      after.markersLeft === 0
    const imagesMissing = Math.max(0, imagesExpected - after.images)
    // 没成功就把现场存下来（截图 + DOM + 日志），省得下次改版还要重新复现
    const failureDir = contentOk
      ? null
      : await saveFailureSnapshot(page, { where: 'uploadDraft', title: safeTitle, saved, formulas: after.formulas, images: after.images, warnings })
    return {
      ok: contentOk,
      saved,
      reusedDraft,
      failureDir,
      title: after.title,
      previewText: after.text,
      textBeforeReload: beforeReload.bodyText,
      formulasInDraft: after.formulas,
      formulasInserted: formulaDone,
      formulasFailed: formulaFailed,
      imagesInserted: imagesExpected - imagesMissing,
      imagesFailed: imagesMissing,
      imagesExpected,
      imagesInDraft: after.images,
      imagesHosted: after.hosted,
      imagesUnhosted,
      /** 草稿骨架：段落 / 图片的顺序 —— 用来核对"图有没有插在原位" */
      outline: after.outline,
      imageSrcs: after.imageSrcs,
      tablesInDraft: after.tables,
      backupsDir: resolve(STATE_DIR, 'backups'),
      stepTimings: timings,
      warnings,
      draftUrl: WRITE_URL,
    }
  } finally {
    await page.close().catch(() => {})
    // 带图推送会开一个可见窗口：推完就关掉，别让它一直杵在用户桌面上（下次要图再开）
    await closeVisibleBrowser()
  }
}

/** 把导出 HTML 按公式切成若干段（图片**不切**，见下面的说明） */
export function splitParts(html) {
  const out = []
  // 公式：行内是 <span data-latex="…">…</span>，块级是 <div data-latex="…" data-math-block>…</div>
  // 属性顺序不固定，所以整个属性串都抓下来再找 data-math-block
  //
  // 图片（<img src="data:…">）**故意不切出来**：实测把 data: 图片留在 HTML 里一起粘，
  // 知乎会自己把它接过去重新托管（草稿里变成 picx.zhimg.com 的地址）。
  // 老代码是一张张写进系统剪贴板再真 Ctrl+V，慢得多（每张要等 20 秒左右）、
  // 还得为它开一个"有头"浏览器窗口、期间占用你的剪贴板。现在整篇一次粘完。
  const re = /<(span|div)\b([^>]*data-latex="([^"]*)"[^>]*)>[\s\S]*?<\/\1>/g
  let last = 0
  let m
  while ((m = re.exec(html))) {
    if (m.index > last) out.push({ type: 'html', value: html.slice(last, m.index) })
    out.push({
      type: 'formula',
      latex: decodeEntities(m[3]),
      display: /data-math-block/.test(m[2] || ''),
    })
    last = m.index + m[0].length
  }
  if (last < html.length) out.push({ type: 'html', value: html.slice(last) })
  return out.length ? out : [{ type: 'html', value: html }]
}

/** 数一数 HTML 里有几张内嵌图片（data: 开头的那种，粘贴时由知乎接管托管） */
export function countInlineImages(html) {
  return (html.match(/<img[^>]*src="data:/g) ?? []).length
}

/**
 * 正文里的图片按"知乎收不收得到"分类。
 *
 * 为什么助手也要自己数一遍：编辑器那边已经拦了本地路径的图片（见 src/editor/zhihuImages.ts），
 * 但助手可能被别的入口调用（老版本编辑器、脚本、手工 POST），而这条路的失败**极其安静** ——
 * 知乎拿不到 assets/xxx.jpg，草稿里只留一个「图片导入失败，请重新上传」的空位，
 * 刷新校验却因为"img 元素在"而报成功。所以两边都数、都拦。
 */
export function classifyImages(html) {
  const stats = { total: 0, embedded: 0, remote: 0, local: 0, localNames: [] }
  for (const tag of html.match(/<img\b[^>]*>/gi) ?? []) {
    // 公式在知乎编辑器里也是 <img>（eeimg / equation?tex=），别当图片数
    if (/\beeimg\b/i.test(tag) || /equation\?tex=/i.test(tag)) continue
    const m = tag.match(/\bsrc\s*=\s*("([^"]*)"|'([^']*)')/i)
    const src = (m?.[2] ?? m?.[3] ?? '').trim()
    if (!src) continue
    stats.total += 1
    if (/^data:/i.test(src)) stats.embedded += 1
    else if (/^https?:/i.test(src)) stats.remote += 1
    else {
      stats.local += 1
      if (stats.localNames.length < 3) {
        let s = src.split(/[?#]/)[0]
        try {
          s = decodeURIComponent(s)
        } catch {
          /* 编码坏了就按原样 */
        }
        const parts = s.split(/[\\/]/)
        stats.localNames.push(parts[parts.length - 1] || s)
      }
    }
  }
  return stats
}

/** 本地图片拦下来时给用户的那句话（和编辑器里的说法保持一致） */
export function localImageBlockText(stats) {
  const names = stats.localNames.length
    ? `（${stats.localNames.join('、')}${stats.local > stats.localNames.length ? ' 等' : ''}）`
    : ''
  return (
    `这篇里有 ${stats.local} 张图片还是本地路径${names}，知乎读不到你电脑上的文件 —— ` +
    `传过去草稿里只会显示「图片导入失败，请重新上传」。` +
    `没有动你知乎上的草稿：请回到编辑器，点「知乎」面板里的「选图片文件夹修复」` +
    `（选那个装着 assets 的文件夹）把图片嵌进文档，再传一次。`
  )
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

/** 把焦点和光标放到正文末尾（粘贴/插图都插在光标处；别用 click()：
 *  正文区上压着浮动工具条，点击会被拦截，助手原来那行 .click({position}).catch() 是静默失败的） */
function focusBodyEnd(page) {
  return page.evaluate(() => {
    const el = document.querySelector('.public-DraftEditor-content')
    if (!el) return false
    el.focus()
    const sel = window.getSelection()
    const range = document.createRange()
    range.selectNodeContents(el)
    range.collapse(false)
    sel.removeAllRanges()
    sel.addRange(range)
    return true
  })
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

  /* 手动存一份现场（截图 + DOM + 日志）：出问题时点一下，把那个文件夹发出去就能定位 */
  if (url.pathname === '/snapshot') {
    if (req.method !== 'POST') {
      send(405, { ok: false, error: '请用 POST' })
      return
    }
    try {
      const ctx = await ensureBrowser()
      const page = await ctx.newPage()
      let dir = null
      try {
        await page.goto(WRITE_URL, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {})
        await page.waitForTimeout(3000)
        dir = await saveFailureSnapshot(page, { where: 'manual (/snapshot)' })
      } finally {
        await page.close().catch(() => {})
      }
      send(200, { ok: !!dir, failureDir: dir, error: dir ? undefined : '存快照失败（看助手窗口的日志）' })
    } catch (e) {
      send(500, { ok: false, error: String(e).slice(0, 200) })
    }
    return
  }

  /* 自检：拿一篇临时草稿真跑一遍"正文/公式/图片/表格能不能存住"，给一句人话结论 */
  if (url.pathname === '/selfcheck') {
    if (req.method !== 'POST') {
      send(405, { ok: false, error: '请用 POST' })
      return
    }
    if (busy) {
      send(429, { ok: false, error: '助手正忙（正在传别的稿子），等它跑完再自检' })
      return
    }
    busy = true
    log('自检：开始（会用一篇临时草稿「' + SELFCHECK_TITLE + '」，跑完清空）')
    try {
      const r = await runSelfCheck()
      log(`自检：${r.ok ? '通过 ✅' : '没通过 ❌'} ${r.summary ?? r.error ?? ''}`)
      send(200, { ...r, note: '自检会在你知乎里留一篇空草稿，标题「' + SELFCHECK_TITLE + '」，可以直接删' })
    } catch (e) {
      send(500, { ok: false, error: '自检失败：' + String(e).slice(0, 200) })
    } finally {
      busy = false
    }
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
        error: '这篇没有正文内容（只有空白），已中止——没有动你知乎上的草稿。先在编辑器里写点东西再传。',
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
