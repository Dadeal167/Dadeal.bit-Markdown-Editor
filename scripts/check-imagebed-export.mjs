/**
 * 「导出知乎 .md」图片自动上架图床（回归测试，用假助手，不碰真网络）
 *
 * 背景：本地图片（内嵌 base64）知乎导入读不了；知乎自己的图床只给私有地址。
 * 所以导出时先把图片传给助手 → 助手传到用户的公开图床仓库 → 返回 jsDelivr 网址 →
 * 网址写进 .md → 知乎导入时自己把图抓回去（用户验证过这个办法"挺好"）。
 *
 * 这个脚本用本地假助手（/status 说已连接、/upload-images 返回假网址）验证整条链路：
 *   1. 助手在：图片被换成网址、没有提示行、没有内嵌 base64（data）
 *   2. 助手不在：退回"图片留在文件里 + 每张一行提示"，图片不能丢
 */
import { chromium } from 'playwright-core'
import { createServer } from 'node:http'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const APP = resolve('Dadealbit Markdown 编辑器.html')
if (!existsSync(APP)) {
  console.error('先跑 pnpm build')
  process.exit(1)
}
const app = 'file:///' + APP.replace(/\\/g, '/')
const DL = resolve('.probe', 'imagebed-dl')
rmSync(DL, { recursive: true, force: true })
mkdirSync(DL, { recursive: true })

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`${ok ? '✅' : '❌'}  ${name}${detail ? '  — ' + detail : ''}`)
}

/* ---------- 假助手：/status + /upload-images ---------- */
const PORT = 5197
const TOKEN = 'bed-suite-token'
let uploadCalls = 0
let lastCount = 0
/** 打开它 = 假装"助手这条路坏了"（走 git push，国内网络确实会抽风），用来测令牌兜底 */
let failUploads = false
const server = createServer((req, res) => {
  const cors = {
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'content-type, x-dadealbit-token',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
  }
  if (req.method === 'OPTIONS') {
    res.writeHead(204, cors).end()
    return
  }
  const send = (code, obj) => {
    res.writeHead(code, { ...cors, 'content-type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify(obj))
  }
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`)
  if (url.pathname === '/status') {
    if (req.headers['x-dadealbit-token'] !== TOKEN) return send(401, { ok: false })
    return send(200, { ok: true, busy: false, imageBed: 'Dadeal167/Dadeal.bit-ImageBed' })
  }
  if (url.pathname === '/upload-images' && req.method === 'POST') {
    if (req.headers['x-dadealbit-token'] !== TOKEN) return send(401, { ok: false })
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      let images = []
      try {
        images = JSON.parse(body).images ?? []
      } catch {
        /* 忽略 */
      }
      uploadCalls += 1
      lastCount = images.length
      // FAIL_UPLOADS=1 或临时打开 failUploads 时，假装助手这条路坏了，
      // 用来验证"助手失败 → 自动改用 GitHub 令牌直传"这条兜底
      if (failUploads || process.env.FAIL_UPLOADS === '1') {
        return send(500, { ok: false, error: '图床上传出错：git push 失败（测试用）' })
      }
      send(200, {
        ok: true,
        urls: images.map((_, i) => `https://gcore.jsdelivr.net/gh/Dadeal167/Dadeal.bit-ImageBed@main/images/fake-${i + 1}.png`),
        warnings: [],
        added: images.length,
        verified: true,
      })
    })
    return
  }
  send(404, { ok: false })
})
await new Promise((r) => server.listen(PORT, '127.0.0.1', r))
console.log(`假助手已启动：http://127.0.0.1:${PORT}\n`)

/* ---------- 造一篇带两张"本机图片"的文档 ---------- */
const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
const srcMd = [
  '# 图床上传测试',
  '',
  '第一张：![图一](data:image/png;base64,' + PNG + ')',
  '',
  '正文与公式 $x_1$。',
  '',
  '第二张：![图二](data:image/png;base64,' + PNG + ')',
  '',
  '网络图片不该被动：![网图](https://picx.zhimg.com/v2-real.jpg)',
  '',
].join('\n')
const srcPath = resolve('.probe', 'imagebed-src.md')
writeFileSync(srcPath, srcMd, 'utf-8')

const browser = await chromium.launch({ channel: 'msedge', headless: true })

/** 开一个把助手地址指向 port 的页面，导入文档、导出知乎 .md
 *  @param opts.expectNoDownload 期望"拦住不给文件"（助手没开又没令牌时就是这样） */
async function exportWith(port, token, fileName, opts = {}) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 950 }, acceptDownloads: true })
  const errs = []
  let downloaded = null
  page.on('pageerror', (e) => errs.push(String(e).slice(0, 140)))
  page.on('download', (d) => {
    downloaded = d.suggestedFilename()
  })
  await page.addInitScript(
    ([addrKey, tokenKey, addr, tok]) => {
      localStorage.setItem(addrKey, addr)
      localStorage.setItem(tokenKey, tok)
      // 这一轮不带图床令牌（不然编辑器会走"自己直传"那条路）
      localStorage.removeItem('md-editor-imagebed-v1')
    },
    ['md-editor-zhihu-addr-v1', 'md-editor-zhihu-v1', `http://127.0.0.1:${port}`, token],
  )
  await page.goto(app, { waitUntil: 'load', timeout: 60000 })
  await page.waitForSelector('.ProseMirror', { timeout: 30000 })
  await page.waitForTimeout(1200)
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser', { timeout: 10000 }),
    page.locator('.zh-btn[title="打开"]').click(),
  ])
  await chooser.setFiles(srcPath)
  await page.waitForTimeout(2500)
  await page.locator('.zh-btn[title="知乎"]').click()
  await page.waitForTimeout(2000)
  const state = await page.evaluate(() => document.querySelector('.zh-zhihu__state')?.textContent ?? '')
  const exportBtn = page.locator('.zh-zhihu__export button', { hasText: '导出知乎 .md' })

  if (opts.expectNoDownload) {
    // 期望"拦住不给文件"：点完等一会儿，确认没有 download 事件
    await exportBtn.click()
    await page.waitForTimeout(3500)
    const note = await page.evaluate(() => document.querySelector('.zh-zhihu__result')?.textContent ?? '')
    const noteClass = await page.evaluate(() => document.querySelector('.zh-zhihu__result')?.className ?? '')
    await page.close()
    return { md: '', note, noteClass, state, errs, downloaded }
  }

  const [download] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), exportBtn.click()])
  const saved = resolve(DL, fileName)
  await download.saveAs(saved)
  await page.waitForTimeout(600)
  const note = await page.evaluate(() => document.querySelector('.zh-zhihu__result')?.textContent ?? '')
  const noteClass = await page.evaluate(() => document.querySelector('.zh-zhihu__result')?.className ?? '')
  await page.close()
  return { md: readFileSync(saved, 'utf-8'), note, noteClass, state, errs, downloaded }
}

/* ---------- 1. 助手在：图片换公开网址 ---------- */
const on = await exportWith(PORT, TOKEN, 'with-assistant.md')
console.log('--- 助手在线时 ---')
check('面板认出助手已连接', /已连接/.test(on.state), on.state.slice(0, 30))
check('确实调用了图床接口，两张图都传了', uploadCalls === 1 && lastCount === 2, `调用 ${uploadCalls} 次，最后一次 ${lastCount} 张`)
check(
  '两张本机图片换成了公开网址',
  on.md.includes('https://gcore.jsdelivr.net/gh/Dadeal167/Dadeal.bit-ImageBed@main/images/fake-1.png') &&
    on.md.includes('...fake-2.png'.replace('...', 'https://gcore.jsdelivr.net/gh/Dadeal167/Dadeal.bit-ImageBed@main/images/')),
  (on.md.match(/!\[[^\]]*\]\([^)]{0,70}/g) || []).join(' | ').slice(0, 150),
)
check('文件里不再有内嵌 base64 图片', !/\]\(data:image\//.test(on.md), `${(on.md.match(/\]\(data:image\//g) || []).length} 处`)
check('没有「导入知乎后手动粘」的提示行（有网址就不需要了）', !/^> 🖼️ /m.test(on.md))
check('本来就是网址的图片没被动', on.md.includes('https://picx.zhimg.com/v2-real.jpg'))
check('公式照常转换', on.md.includes('equation?tex=x_1'))
check('反馈里说明图片已上传图床', /图床/.test(on.note) && /公开网址/.test(on.note), on.note.slice(0, 90))
check('这种是成功样式（不是警告）', /result--ok/.test(on.noteClass), on.noteClass)
check('助手在线这轮无页面错误', on.errs.length === 0, on.errs.slice(0, 2).join(' | '))

/* ---------- 2. 助手不在、也没填令牌：照样给文件，但每张图上面一行提示 ----------
   （用户 2026-09 改的规矩：以前是"先不导出"硬拦住，现在给文件 + 把缺图说清楚） */
const off = await exportWith(5198, TOKEN, 'no-assistant.md')
console.log('\n--- 助手离线、也没令牌 ---')
check('助手离线：**仍然下载了文件**', off.downloaded !== null, `下载了 ${off.downloaded ?? '(没下载)'}`)
check('助手离线：图片还在文件里（内嵌 base64）', /\]\(data:image\//.test(off.md), `${(off.md.match(/\]\(data:image\//g) || []).length} 处`)
check('助手离线：每张没换网址的图上面有一行提示', (off.md.match(/^> 🖼️ /gm) || []).length === 2, `${(off.md.match(/^> 🖼️ /gm) || []).length} 行`)
check(
  '助手离线：提示里说清"会丢、两条出路、推荐草稿箱"',
  /没换成公开网址/.test(off.note) && /开始使用\.bat/.test(off.note) && /图床设置/.test(off.note) && /存到草稿箱/.test(off.note),
  off.note.slice(0, 140).replace(/\n/g, ' '),
)
check('助手离线：反馈是警告样式', /result--bad/.test(off.noteClass), off.noteClass)
check('助手离线这轮无页面错误', off.errs.length === 0, off.errs.slice(0, 2).join(' | '))

/* ---------- 3. 不开助手：编辑器用 GitHub 令牌自己上传（接口用假响应拦下来） ---------- */
async function exportWithToken({ fileName, mockOk, transientPutFails = 0, assistantPort = 5198 }) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 950 }, acceptDownloads: true })
  const errs = []
  const calls = []
  let putFailsLeft = transientPutFails
  page.on('pageerror', (e) => errs.push(String(e).slice(0, 140)))
  // 把 GitHub 接口拦下来：不碰真网络、也不需要真令牌
  await page.route('https://api.github.com/**', async (route) => {
    const req = route.request()
    calls.push(`${req.method()} ${new URL(req.url()).pathname}`)
    if (!String(req.headers()['authorization'] ?? '').startsWith('Bearer ')) {
      await route.fulfill({ status: 401, body: JSON.stringify({ message: 'Requires authentication' }) })
      return
    }
    if (!mockOk) {
      await route.fulfill({
        status: 403,
        body: JSON.stringify({ message: 'Resource not accessible by personal access token' }),
      })
      return
    }
    // 前 N 次 PUT 假装"GitHub 那边临时出错"，用来验证逐张重试
    if (req.method() === 'PUT' && putFailsLeft > 0) {
      putFailsLeft -= 1
      await route.fulfill({ status: 500, body: JSON.stringify({ message: 'Server Error (test)' }) })
      return
    }
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({ content: { path: new URL(req.url()).pathname.split('/contents/')[1] } }),
    })
  })
  // jsDelivr 的分发验证也拦下来（不然要等真网络）
  await page.route('https://**.jsdelivr.net/**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from([0x89, 0x50, 0x4e, 0x47]) })
  })
  await page.addInitScript(
    ([key, cfg]) => localStorage.setItem(key, JSON.stringify(cfg)),
    ['md-editor-imagebed-v1', { repo: 'Dadeal167/Dadeal.bit-ImageBed', token: 'ghp_fake_token_for_test' }],
  )
  await page.addInitScript(
    ([addrKey, tokenKey, port]) => {
      localStorage.setItem(addrKey, `http://127.0.0.1:${port}`) // 5198 = 没助手在；5197 = 那个"会失败的假助手"
      localStorage.setItem(tokenKey, 'whatever')
    },
    ['md-editor-zhihu-addr-v1', 'md-editor-zhihu-v1', assistantPort],
  )
  await page.goto(app, { waitUntil: 'load', timeout: 60000 })
  await page.waitForSelector('.ProseMirror', { timeout: 30000 })
  await page.waitForTimeout(1200)
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser', { timeout: 10000 }),
    page.locator('.zh-btn[title="打开"]').click(),
  ])
  await chooser.setFiles(srcPath)
  await page.waitForTimeout(2500)
  await page.locator('.zh-btn[title="知乎"]').click()
  await page.waitForTimeout(1500)
  const hasBedUi = (await page.locator('.zh-zhihu__bed-toggle').count()) > 0
  // 点导出后等一会儿：有下载就存下来，没下载就说明被拦住了（把原因读出来，别直接抛超时）
  let downloaded = null
  page.on('download', (d) => {
    downloaded = d.suggestedFilename()
  })
  const wantDownload = page.waitForEvent('download', { timeout: 20000 }).catch(() => null)
  await page.locator('.zh-zhihu__export button', { hasText: '导出知乎 .md' }).click()
  const download = await wantDownload
  const saved = resolve(DL, fileName)
  if (download) await download.saveAs(saved)
  await page.waitForTimeout(500)
  const note = await page.evaluate(() => document.querySelector('.zh-zhihu__result')?.textContent ?? '')
  await page.close()
  return { md: download ? readFileSync(saved, 'utf-8') : '', note, calls, errs, hasBedUi, downloaded }
}

console.log('\n--- 不开助手 + 填了图床令牌 ---')
const direct = await exportWithToken({ fileName: 'direct-upload.md', mockOk: true })
check('面板里有「图床设置」入口', direct.hasBedUi, direct.hasBedUi ? '' : '没找到 .zh-zhihu__bed-toggle')
check('确实调了 GitHub 接口上传（两次 PUT）', direct.calls.filter((c) => c.startsWith('PUT ')).length === 2, JSON.stringify(direct.calls))
check(
  '两张图片换成了 jsDelivr 公开网址（不靠助手）',
  (direct.md.match(/https:\/\/[a-z.]*jsdelivr\.net\/gh\/Dadeal167\/Dadeal\.bit-ImageBed@main\/images\/[0-9a-f]+\.png/g) || []).length >= 2,
  (direct.md.match(/!\[[^\]]*\]\([^)]{0,60}/g) || []).join(' | ').slice(0, 140),
)
check('文件里没有内嵌 base64 图片', !/\]\(data:image\//.test(direct.md))
check('没有「手动粘图」提示行', !/^> 🖼️ /m.test(direct.md))
check('反馈里说明图片已上传图床', /图床/.test(direct.note), direct.note.slice(0, 80))
check('这轮无页面错误', direct.errs.length === 0, direct.errs.slice(0, 2).join(' | '))

console.log('\n--- 不开助手 + 令牌没权限（照样给文件，但每张图上面一行提示）---')
const denied = await exportWithToken({ fileName: 'token-denied.md', mockOk: false })
check('令牌没权限：**仍然下载了文件**', denied.downloaded !== null, `下载了 ${denied.downloaded ?? '(没下载)'}`)
check('令牌没权限：每张图上面都有提示行', (denied.md.match(/^> 🖼️ /gm) || []).length === 2, `${(denied.md.match(/^> 🖼️ /gm) || []).length} 行`)
check('令牌没权限：反馈里说清原因（权限不够）', /权限/.test(denied.note), denied.note.slice(0, 90).replace(/\n/g, ' '))
check(
  '令牌没权限：同时给两条出路（开助手 / 改令牌）',
  /开始使用\.bat/.test(denied.note) && /图床设置/.test(denied.note),
  denied.note.slice(0, 140).replace(/\n/g, ' '),
)
check('令牌没权限这轮无页面错误', denied.errs.length === 0, denied.errs.slice(0, 2).join(' | '))

/* ---------- 6. 容错一：助手那条路坏了 → 自动改用 GitHub 令牌直传（两条路互为备份） ---------- */
console.log('\n--- 助手报错 + 填了令牌（应该自动换直传）---')
failUploads = true
const fallback = await exportWithToken({ fileName: 'fallback.md', mockOk: true, assistantPort: PORT })
failUploads = false
check('助手失败时确实调用了 GitHub 接口（走了兜底那条路）', fallback.calls.filter((c) => c.startsWith('PUT ')).length === 2, JSON.stringify(fallback.calls.slice(0, 4)))
check(
  '兜底成功：两张图都换成了公开网址',
  (fallback.md.match(/jsdelivr\.net\/gh\/Dadeal167/g) || []).length >= 2,
  (fallback.md.match(/!\[[^\]]*\]\([^)]{0,50}/g) || []).join(' | ').slice(0, 120),
)
check('兜底成功时不留"缺图"提示行', !/^> 🖼️ /m.test(fallback.md))
check('兜底这轮无页面错误', fallback.errs.length === 0, fallback.errs.slice(0, 2).join(' | '))

/* ---------- 7. 容错二：GitHub 临时出错（500）→ 逐张重试，不该立刻放弃 ---------- */
console.log('\n--- GitHub 头两次 PUT 返回 500（应该重试后成功）---')
const retried = await exportWithToken({ fileName: 'retry.md', mockOk: true, transientPutFails: 2 })
const putCount = retried.calls.filter((c) => c.startsWith('PUT ')).length
check('临时失败后重试了（PUT 次数 > 图片数）', putCount > 2, `PUT ${putCount} 次，图片 2 张`)
check(
  '重试之后仍然拿到了两个网址',
  (retried.md.match(/jsdelivr\.net\/gh\/Dadeal167/g) || []).length >= 2,
  (retried.md.match(/!\[[^\]]*\]\([^)]{0,40}/g) || []).join(' | ').slice(0, 120),
)
check('重试这轮无页面错误', retried.errs.length === 0, retried.errs.slice(0, 2).join(' | '))

await browser.close()
server.close()
for (const r of results) if (!r.ok) console.log(`\n待修：${r.name}`)
const failed = results.filter((r) => !r.ok).length
console.log(`\n${results.length - failed}/${results.length} 通过`)
process.exit(failed ? 1 : 0)
