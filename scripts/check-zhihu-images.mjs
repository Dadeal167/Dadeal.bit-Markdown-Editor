/**
 * 推知乎前的图片守卫（离线可跑，不碰真知乎）
 *
 * 对应源码：src/editor/zhihuImages.ts（图片按"知乎收不收得到"分类）、
 *          src/editor/ZhihuModal.tsx（面板拦截）、scripts/zhihu-assistant.mjs（助手侧拒收 + 托管校验）
 *
 * 起因（用户报的）：把「知乎导出」出来的 .md 打开改完，用「存到草稿箱」传过去，
 * 草稿里每张图都是「图片导入失败，请重新上传」——因为源文件里写的是
 * `assets/文章名/img_001.jpg` 这种**本地相对路径**，知乎服务端读不到用户电脑上的文件。
 * 更糟的是两边都报成功：编辑器只数 `data:` 图片（相对路径一张都不数），助手也只数 `data:`，
 * 于是用户要到知乎草稿箱里才发现图没了。
 *
 * 验五件事：
 *   1. 编辑器：文档里有本地图片时，知乎面板当场显示警告 + 「选图片文件夹修复」按钮
 *   2. 编辑器：点「存到草稿箱」被拦住，而且**根本不发请求**（文案是"本地路径"，不是"连不上助手"）
 *   3. 编辑器：图片都嵌进文档了（data:）就不该有这个警告
 *   4. 助手：带本地图片的 HTML 直接拒收，并且**不开浏览器**（秒回，不碰用户的知乎登录态）
 *   5. 分类器：知乎公式的 <img eeimg> 不算图片；https / file: / blob: 各自判定正确
 */
import { chromium } from 'playwright-core'
import { spawn, execFile } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`${ok ? '✅' : '❌'}  ${name}${detail ? '  — ' + detail : ''}`)
}

const APP = resolve('Dadealbit Markdown 编辑器.html')
if (!existsSync(APP)) {
  console.error('先跑 pnpm build')
  process.exit(1)
}

/* ============================================================
 * 一、编辑器：本地图片要在面板里当场拦住
 * ============================================================ */
const ROOT = resolve('.probe', 'zhihu-local-img')
const ART = '本地图文章'
const ASSETS = join(ROOT, 'assets', ART)
rmSync(ROOT, { recursive: true, force: true })
mkdirSync(ASSETS, { recursive: true })
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)
writeFileSync(join(ASSETS, 'img_001.png'), PNG)
writeFileSync(join(ASSETS, 'img_002.png'), PNG)
const mdPath = join(ROOT, `${ART}.md`)
writeFileSync(
  mdPath,
  [`# ${ART}`, '', '一段话。', '', `![图1](assets/${ART}/img_001.png)`, '', `![图2](assets/${ART}/img_002.png)`, ''].join('\n'),
  'utf-8',
)
const DATA_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

const browser = await chromium.launch({ channel: 'msedge', headless: true })
const page = await browser.newPage({ viewport: { width: 1300, height: 1000 } })
const errors = []
page.on('pageerror', (e) => errors.push(String(e).slice(0, 120)))

const openApp = async () => {
  await page.goto('file:///' + APP.replace(/\\/g, '/'), { waitUntil: 'load', timeout: 60000 })
  await page.waitForSelector('.ProseMirror', { timeout: 30000 })
  await page.waitForTimeout(900)
}
const TEST_TOKEN = 'check-zhihu-images-dummy-token'
const openZhihuPanel = async () => {
  await page.locator('.zh-btn[title="知乎"]').click()
  await page.waitForSelector('.zh-modal--zhihu', { timeout: 10000 })
  // 令牌填上，否则「存到草稿箱」按钮是禁用的（点不动就测不到拦截）。
  // ⚠️ 这个输入框失焦时会把值**写进 localStorage**（编辑器就靠它记住令牌），而 file:// 页面的
  // localStorage 是所有本地 HTML 共用的 —— 也就是说这个测试会把用户存好的真令牌覆盖成假值。
  // 所以下面先备份、跑完一律还原（见 storageBefore / restoreStorage）。
  await page.locator('.zh-zhihu__field', { hasText: '助手令牌' }).locator('input').fill(TEST_TOKEN)
  await page.waitForTimeout(700)
}
const readStorage = () =>
  page.evaluate(() => {
    try {
      return {
        token: localStorage.getItem('md-editor-zhihu-v1'),
        addr: localStorage.getItem('md-editor-zhihu-addr-v1'),
      }
    } catch {
      return { token: null, addr: null }
    }
  })
/** 把助手令牌/地址恢复成测试前的样子（不然用户下次用编辑器会看到"令牌不对"） */
const restoreStorage = async (snap) => {
  if (!snap) return
  await page.evaluate((s) => {
    try {
      if (s.token === null) localStorage.removeItem('md-editor-zhihu-v1')
      else localStorage.setItem('md-editor-zhihu-v1', s.token)
      if (s.addr === null) localStorage.removeItem('md-editor-zhihu-addr-v1')
      else localStorage.setItem('md-editor-zhihu-addr-v1', s.addr)
    } catch {
      /* 存不下就算了 */
    }
  }, snap)
}
const closePanel = async () => {
  await page.locator('.zh-modal--zhihu .zh-modal__close').click()
  await page.waitForTimeout(300)
}

await openApp()
/** 用户原来的令牌/地址：跑完要还原（见 openZhihuPanel 的说明） */
const storageBefore = await readStorage()
const [chooser] = await Promise.all([
  page.waitForEvent('filechooser', { timeout: 10000 }),
  page.locator('.zh-btn[title="打开"]').click(),
])
await chooser.setFiles(mdPath)
await page.waitForTimeout(2200)

await openZhihuPanel()
const warn = await page.evaluate(() => {
  const el = document.querySelector('.zh-zhihu__imgwarn')
  return {
    has: !!el,
    text: el?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
    repairBtn: !!document.querySelector('.zh-zhihu__imgwarn button'),
  }
})
check(
  '文档里有本地路径图片时，知乎面板当场提示（说清"本地路径"和文件名）',
  warn.has && /本地路径/.test(warn.text) && /img_001\.png/.test(warn.text),
  warn.text.slice(0, 70),
)
check(
  '提示里带「选图片文件夹修复」按钮（一键接上已有的修复流程）',
  warn.repairBtn && /选图片文件夹修复/.test(warn.text),
)
check(
  '提示里把后果写明（图片导入失败，请重新上传）',
  /图片导入失败/.test(warn.text),
)

/* 点「存到草稿箱」：必须被拦住，而且结果里说的是图片问题 —— 不是"连不上助手"
   （助手这时候根本没在跑；如果守卫没生效，用户看到的会是连接失败，照样把稿子发出去） */
await page.locator('.zh-modal--zhihu .zh-modal__footer .zh-btn-solid').click()
await page.waitForTimeout(1500)
const blocked = await page.evaluate(() => {
  const el = document.querySelector('.zh-modal--zhihu .zh-zhihu__result--bad')
  return { text: el?.textContent?.replace(/\s+/g, ' ').trim() ?? '' }
})
check(
  '点「存到草稿箱」被拦住，且说明是本地图片（不是"助手连不上"）',
  /本地路径/.test(blocked.text) && /没有动你知乎上的草稿|图片导入失败/.test(blocked.text) && !/连不上|Failed to fetch|助手/.test(blocked.text.replace(/助手已连接|没检测到助手/g, '')),
  blocked.text.slice(0, 80),
)

/* 图片嵌好之后（data:），警告要消失 —— 否则用户永远修不完 */
await closePanel()
await page.evaluate(
  (src) => {
    const ed = window.__EDITOR__
    ed?.commands.setContent(`<h1>${'嵌好图了'}</h1><p>一段话。</p><p><img src="${src}"></p>`)
  },
  DATA_PNG,
)
await page.waitForTimeout(900)
await openZhihuPanel()
const afterEmbed = await page.evaluate(() => ({
  warn: !!document.querySelector('.zh-zhihu__imgwarn'),
  tips: document.querySelector('.zh-modal--zhihu')?.textContent?.includes('存到知乎草稿箱') ?? false,
}))
check('图片都是内嵌 data: 时，不再出现本地图片警告', afterEmbed.tips && !afterEmbed.warn)

/* 把**编辑器真实导出的 HTML** 抓下来，后面喂给助手的切图逻辑。
   这一条是这次踩坑踩出来的：编辑器导出的是**裸 `<img>`**（Tiptap 不给它套 <p>），
   而助手原来只认 `<p><img></p>`，真实文档一张都切不出来 ——
   图片就留在正文里、被知乎那条会失败的导入通道吞掉，用户看到的还是「图片导入失败」。
   所以这里必须用真产物，不能用手写的 HTML 片段。 */
const realMarkup = await page.evaluate((src) => {
  const ed = window.__EDITOR__
  ed?.commands.setContent(`<h2>真实格式</h2><p>文字一。</p><p><img src="${src}"></p><p>文字二。</p>`)
  return ed?.getHTML() ?? ''
}, DATA_PNG)
check(
  '取到编辑器真实导出的 HTML（用于校验助手的切图逻辑）',
  /<img\b/i.test(realMarkup) && !/<p>\s*<img/i.test(realMarkup),
  JSON.stringify(realMarkup.slice(0, 80)),
)

await closePanel()
/* 还原用户的助手令牌/地址：这个测试为了能点按钮临时改过它（file:// 的 localStorage 是所有本地 HTML 共用的） */
await restoreStorage(storageBefore)
const storageAfter = await readStorage()
check(
  '测试没有动用户存好的助手令牌/地址（跑完还原）',
  storageAfter.token === storageBefore.token && storageAfter.addr === storageBefore.addr,
  `token ${storageAfter.token === storageBefore.token ? '一致' : '被改了'}`,
)
check('整段流程没有 JS 报错', errors.length === 0, errors.slice(0, 2).join(' | '))
await browser.close()

/* ============================================================
 * 二、助手：带本地图片的请求直接拒收，而且不开浏览器
 * ============================================================ */
const NODE = process.execPath
const PORT = 5198
const TOKEN = 'test-guard-token'
const TOKEN_FILE = resolve(homedir(), '.dadealbit', 'token.txt')
/** 助手启动时会写 token.txt；跑完要还原，别把用户正在用的令牌文件弄脏 */
const tokenBackup = existsSync(TOKEN_FILE) ? readFileSync(TOKEN_FILE, 'utf-8') : null

const child = spawn(NODE, [resolve('scripts', 'zhihu-assistant.mjs'), '--port', String(PORT), '--token', TOKEN], {
  stdio: ['ignore', 'pipe', 'pipe'],
})
const childLog = []
child.stdout.on('data', (b) => childLog.push(String(b)))
child.stderr.on('data', (b) => childLog.push(String(b)))

const status = async () => {
  const r = await fetch(`http://127.0.0.1:${PORT}/status`, { headers: { 'x-dadealbit-token': TOKEN } }).catch(() => null)
  return r ? r.status : 0
}
const post = async (body) => {
  const t0 = Date.now()
  const r = await fetch(`http://127.0.0.1:${PORT}/draft`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-dadealbit-token': TOKEN },
    body: JSON.stringify(body),
  })
  const json = await r.json().catch(() => ({}))
  return { status: r.status, json, ms: Date.now() - t0 }
}

try {
  let up = false
  for (let i = 0; i < 30 && !up; i += 1) {
    await new Promise((r) => setTimeout(r, 500))
    up = (await status()) === 200
  }
  check('助手能在测试端口起来（离线，不碰真知乎）', up, up ? `http://127.0.0.1:${PORT}` : childLog.join('').slice(-160))

  if (up) {
    const rel = await post({
      title: 'Dadealbit 守卫测试（不该产生草稿）',
      html: `<p>一段正常文字</p><p><img src="assets/${ART}/img_001.png"></p>`,
    })
    check(
      '相对路径图片：助手直接拒收（ok=false + 说清原因）',
      rel.status === 200 && rel.json.ok === false && /本地路径/.test(rel.json.error ?? ''),
      (rel.json.error ?? '').slice(0, 70),
    )
    check('拒收时说明"没有动你知乎上的草稿"', /没有动你知乎上的草稿/.test(rel.json.error ?? ''))
    check(
      '拒收发生在开浏览器之前（秒回，不会去动用户的知乎登录态）',
      rel.ms < 8000,
      `${(rel.ms / 1000).toFixed(1)}s`,
    )

    const fileUrl = await post({
      title: 'Dadealbit 守卫测试（不该产生草稿）',
      html: `<p>文字</p><p><img src="file:///C:/tmp/a.png"></p>`,
    })
    check(
      'file:// 图片同样被拒收',
      fileUrl.json.ok === false && /本地路径/.test(fileUrl.json.error ?? ''),
      (fileUrl.json.error ?? '').slice(0, 60),
    )

    const blob = await post({
      title: 'Dadealbit 守卫测试（不该产生草稿）',
      html: `<p>文字</p><p><img src="blob:http://127.0.0.1/abc"></p>`,
    })
    check(
      'blob: 临时图片也算"知乎拿不到"，一并拒收',
      blob.json.ok === false && /本地路径/.test(blob.json.error ?? ''),
      (blob.json.error ?? '').slice(0, 60),
    )
  }
} finally {
  child.kill()
  await new Promise((r) => setTimeout(r, 400))
  if (tokenBackup !== null) writeFileSync(TOKEN_FILE, tokenBackup, 'utf-8')
}

/* ============================================================
 * 三、分类器：公式的 <img eeimg> 不算图片（单元级）
 *    助手是个单文件脚本，import 它就等于启动服务；所以用一个临时探针文件去 import，
 *    给它一个没人用的端口，跑完立刻退出（不会碰真知乎，也不占用户正在跑的那个助手）。
 * ============================================================ */
const unitFile = resolve('.probe', 'unit-classify.mjs')
mkdirSync(resolve('.probe'), { recursive: true })
writeFileSync(
  unitFile,
  [
    `import { mkdirSync } from 'node:fs'`,
    `import { resolve } from 'node:path'`,
    `const m = await import(${JSON.stringify('file:///' + resolve('scripts', 'zhihu-assistant.mjs').replace(/\\/g, '/'))})`,
    `const show = (n, h) => console.log('UNIT ' + n + '=' + JSON.stringify(m.classifyImages(h)))`,
    `show('formula', '<p>公式</p><img eeimg="1" src="//www.zhihu.com/equation?tex=x">')`,
    `show('data', '<p><img src="data:image/png;base64,AAA"></p>')`,
    `show('https', "<p><img src='https://picx.zhimg.com/a.png'></p>")`,
    `show('local', '<p><img src="assets/文章/img_001.png"></p>')`,
    `show('file', '<p><img src="file:///C:/tmp/a.png"></p>')`,
    `show('mixed', '<p><img src="data:image/jpeg;base64,AAA"><img src="assets/文章/img_001.png"><img eeimg="1" src="//www.zhihu.com/equation?tex=y"></p>')`,
    // 外链图片：起一个假图床（本地 HTTP），验证"下载下来变成内嵌 data:"真的发生
    `import { createServer } from 'node:http'`,
    `const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')`,
    `const srv = createServer((req, res) => {`,
    `  if (req.url === '/ok.png') { res.setHeader('content-type', 'image/png'); res.end(PNG) }`,
    `  else if (req.url === '/notimage') { res.setHeader('content-type', 'text/html'); res.end('<b>hi</b>') }`,
    `  else { res.statusCode = 404; res.end('nope') }`,
    `})`,
    `await new Promise((r) => srv.listen(0, '127.0.0.1', r))`,
    `const base = 'http://127.0.0.1:' + srv.address().port`,
    `const r1 = await m.inlineRemoteImages('<p><img src="' + base + '/ok.png"></p>')`,
    `console.log('UNIT inlineOk=' + JSON.stringify({ inlined: r1.inlined, isData: /src="data:image\\/png;base64,/.test(r1.html), failed: r1.failed.length }))`,
    `const r2 = await m.inlineRemoteImages('<p><img src="' + base + '/missing.png"></p>')`,
    `console.log('UNIT inlineFail=' + JSON.stringify({ inlined: r2.inlined, failed: r2.failed.length, kept: /missing\\.png/.test(r2.html) }))`,
    `const r3 = await m.inlineRemoteImages('<p><img src="https://picx.zhimg.com/a.png"></p>')`,
    `console.log('UNIT inlineZhihu=' + JSON.stringify({ inlined: r3.inlined, untouched: /picx\\.zhimg\\.com/.test(r3.html) }))`,
    `const r4 = await m.inlineRemoteImages('<p><img src="' + base + '/notimage"></p>')`,
    `console.log('UNIT inlineNotImage=' + JSON.stringify({ inlined: r4.inlined, failed: r4.failed.length }))`,
    // 真实编辑器导出的 HTML（裸 <img>，不套 <p>）：必须能切成图片段
    `const RE = ${JSON.stringify(realMarkup)}`,
    `const tmp2 = resolve('.probe', 'markup-tmp')`,
    `mkdirSync(tmp2, { recursive: true })`,
    `const ex = await m.extractImageFiles(RE, tmp2)`,
    `console.log('UNIT realMarkup=' + JSON.stringify({ imgs: (RE.match(/<img\\b/g) || []).length, cut: ex.queue.length, hasImageSeg: ex.segments.some((s) => s.type === 'image') }))`,
    `srv.close()`,
    'process.exit(0)',
    '',
  ].join('\n'),
  'utf-8',
)
const unitOut = await new Promise((res) => {
  execFile(
    NODE,
    [unitFile, '--port', '5197', '--token', 'unit-test-token'],
    { timeout: 30000, cwd: resolve('.') },
    (_e, stdout, stderr) => res(String(stdout) + String(stderr)),
  )
})
rmSync(unitFile, { force: true })
if (tokenBackup !== null) writeFileSync(TOKEN_FILE, tokenBackup, 'utf-8')
const parse = (name) => {
  const line = unitOut.split(/\r?\n/).find((l) => l.startsWith('UNIT ' + name + '='))
  try {
    return JSON.parse(line.slice(('UNIT ' + name + '=').length))
  } catch {
    return null
  }
}
const uFormula = parse('formula')
const uData = parse('data')
const uHttps = parse('https')
const uLocal = parse('local')
const uFile = parse('file')
const uMixed = parse('mixed')
check(
  '公式的 <img eeimg> 不算图片（否则每篇有公式的文章都会被误拦）',
  !!uFormula && uFormula.total === 0 && uFormula.local === 0,
  JSON.stringify(uFormula),
)
check('内嵌 data: 记为"知乎会接管"', !!uData && uData.embedded === 1 && uData.local === 0, JSON.stringify(uData))
check('单引号写的 https 网址也算公开网址', !!uHttps && uHttps.remote === 1 && uHttps.local === 0, JSON.stringify(uHttps))
check('本地相对路径被识别出来（带文件名）', !!uLocal && uLocal.local === 1 && uLocal.localNames[0] === 'img_001.png', JSON.stringify(uLocal))
check(
  '混在一起时各算各的（1 内嵌 + 1 本地，公式不计）',
  !!uMixed && uMixed.total === 2 && uMixed.embedded === 1 && uMixed.local === 1,
  JSON.stringify(uMixed),
)
check('file:// 绝对路径也算本地（知乎读不到）', !!uFile && uFile.local === 1, JSON.stringify(uFile))

/* ---------- 外链图片：先下载下来变成内嵌图 ----------
   用户实测踩到的正是这条：文档里的图是图床外链（jsDelivr），助手原样推过去，
   知乎用自己的服务器去抓 → 抓不到 → 草稿里就是「图片导入失败，请重新上传」。 */
const uInlineOk = parse('inlineOk')
const uInlineFail = parse('inlineFail')
const uInlineZhihu = parse('inlineZhihu')
const uInlineNotImage = parse('inlineNotImage')
check(
  '外链图片会先下载下来、转成内嵌 data:（不能指望知乎去抓外链）',
  !!uInlineOk && uInlineOk.inlined === 1 && uInlineOk.isData === true && uInlineOk.failed === 0,
  JSON.stringify(uInlineOk),
)
check(
  '外链下载失败时如实记录、保留原网址（不伪造成功）',
  !!uInlineFail && uInlineFail.inlined === 0 && uInlineFail.failed === 1 && uInlineFail.kept === true,
  JSON.stringify(uInlineFail),
)
check(
  '知乎自己图床（zhimg.com）的图片不动它（本来就能显示，没必要多下一个来回）',
  !!uInlineZhihu && uInlineZhihu.inlined === 0 && uInlineZhihu.untouched === true,
  JSON.stringify(uInlineZhihu),
)
check(
  '返回的不是图片（比如 HTML 错误页）时不当图片用',
  !!uInlineNotImage && uInlineNotImage.inlined === 0 && uInlineNotImage.failed === 1,
  JSON.stringify(uInlineNotImage),
)

/* 最关键的一条：**编辑器真实导出的 HTML** 里图片是裸 <img>，必须切得出来。
   （这次就是没测它，导致"我手拼的 HTML 能过、用户真实文档一张都切不出"） */
const uRealMarkup = parse('realMarkup')
check(
  '编辑器真实导出的 HTML（裸 <img>，没有 <p> 包着）能切出图片段',
  !!uRealMarkup && uRealMarkup.imgs === 1 && uRealMarkup.cut === 1 && uRealMarkup.hasImageSeg === true,
  JSON.stringify(uRealMarkup),
)

const failed = results.filter((r) => !r.ok)
console.log(`\n${failed.length ? '❌' : '✅'}  图片守卫：${results.length - failed.length}/${results.length} 通过`)
if (failed.length) {
  console.log('失败项：' + failed.map((f) => f.name).join('、'))
  process.exit(1)
}
