/**
 * 「一键启动」验证：打包出来的「自用」文件夹，双击「开始使用.bat」到底能不能用。
 *
 * 查什么：
 *   1. 文件齐全（开始使用.bat / 停止助手.bat / runtime\node.exe / 助手 + 依赖）
 *   2. 两个 .bat 是纯 ASCII + CRLF（中文在 cmd 下会乱码，写进去就等于坏掉）
 *   3. 便携 node 真能跑（runtime\node.exe -v）
 *   4. 真跑一遍：后台起助手 → 等到就绪 → 令牌能通过 /status 鉴权
 *   5. 不在文件夹里留临时文件、不留令牌（令牌只该在 ~/.dadealbit 和浏览器里）
 *   6. 「停止助手.bat」能把助手关掉（端口不再响应）
 *
 * 用法：node scripts/check-launcher.mjs [自用文件夹]
 *   默认查桌面上的「自用」。注意：测试会启动并随后关掉助手（占用一个测试端口）。
 */
import { spawn } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { resolve } from 'node:path'

import { chromium } from 'playwright-core'

const FOLDER = resolve(process.argv[2] ?? resolve(homedir(), 'Desktop', '自用'))
const PORT = 5197
const TOKEN_FILE = resolve(homedir(), '.dadealbit', 'token.txt')

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`${ok ? '✅' : '❌'}  ${name}${detail ? '  — ' + detail : ''}`)
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** 用某个令牌问助手在不在 */
async function probe(token) {
  try {
    const r = await fetch(`http://127.0.0.1:${PORT}/status`, { headers: { 'x-dadealbit-token': token } })
    return r.status
  } catch {
    return 0
  }
}

/** 跑一个 bat，收它的输出（当前目录 = 交付文件夹） */
function runBat(name, env = {}) {
  return new Promise((done) => {
    const child = spawn('cmd.exe', ['/d', '/c', resolve(FOLDER, name)], {
      cwd: FOLDER,
      env: { ...process.env, DADEALBIT_PORT: String(PORT), ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let out = ''
    child.stdout.on('data', (d) => (out += String(d)))
    child.stderr.on('data', (d) => (out += String(d)))
    const timer = setTimeout(() => child.kill(), 180000)
    child.on('close', (code) => {
      clearTimeout(timer)
      done({ code, out })
    })
  })
}

/* ---------- 1. 文件齐全 ---------- */
console.log(`检查文件夹：${FOLDER}\n`)
const START = resolve(FOLDER, '开始使用.bat')
const STOP = resolve(FOLDER, '停止助手.bat')
const NODE_EXE = resolve(FOLDER, 'runtime', 'node.exe')
const ASSIST = resolve(FOLDER, 'assistant', 'zhihu-assistant.mjs')
const HTML = resolve(FOLDER, 'Dadealbit Markdown 编辑器.html')

check('有「开始使用.bat」', existsSync(START))
check('有「停止助手.bat」', existsSync(STOP))
// 开机静默自启那两个（浏览器不允许网页自己拉起本地程序，所以"永远连着"得靠它）
check('有「安装助手自启 autostart-on.bat」', existsSync(resolve(FOLDER, '安装助手自启 autostart-on.bat')))
check('有「取消助手自启 autostart-off.bat」', existsSync(resolve(FOLDER, '取消助手自启 autostart-off.bat')))
check('有便携 node（runtime\\node.exe）', existsSync(NODE_EXE))
check('有助手脚本', existsSync(ASSIST))
check('有 playwright-core', existsSync(resolve(FOLDER, 'assistant', 'node_modules', 'playwright-core')))
if (!existsSync(START) || !existsSync(ASSIST) || !existsSync(HTML)) {
  console.log('\n缺关键文件，后面的实测没法跑。')
  console.log(`\n0/${results.length} 通过`)
  process.exit(1)
}

/* ---------- 2. bat 必须是纯 ASCII + CRLF ---------- */
for (const [label, file] of [
  ['开始使用.bat', START],
  ['停止助手.bat', STOP],
]) {
  const buf = readFileSync(file)
  const text = buf.toString('latin1')
  const nonAscii = [...text].filter((c) => c.charCodeAt(0) > 126)
  check(`${label} 是纯 ASCII（cmd 下不乱码）`, nonAscii.length === 0, nonAscii.length ? `第 ${buf.indexOf(Buffer.from([nonAscii[0].charCodeAt(0)])) + 1} 字节起有非 ASCII` : `${buf.length} 字节`)
  const loneLf = (text.match(/(?<!\r)\n/g) ?? []).length
  check(`${label} 是 CRLF 换行`, loneLf === 0, loneLf ? `${loneLf} 处裸 LF` : 'ok')
}
check(
  '编辑器认识启动器传令牌的写法（hash → localStorage）',
  readFileSync(HTML, 'utf-8').includes('zhihu-token'),
)
// 手动那条老路（启动知乎助手.bat）也得用文件夹里自带的 node，
// 否则「开始使用.bat 失败就走老路」这句提示在没装 Node 的机器上等于空话
{
  const manual = resolve(FOLDER, '启动知乎助手.bat')
  const text = existsSync(manual) ? readFileSync(manual).toString('latin1') : ''
  check(
    '「启动知乎助手.bat」也用自带的 node（没装 Node 的机器也能手动启动）',
    /runtime\\node\.exe/.test(text) && !/^node zhihu-assistant\.mjs/m.test(text),
    existsSync(manual) ? `${text.length} 字节` : '文件不存在',
  )
  const bad = [...text].filter((c) => c.charCodeAt(0) > 126).length
  check('「启动知乎助手.bat」是纯 ASCII', existsSync(manual) && bad === 0, `${bad} 个非 ASCII 字符`)
}

/* ---------- 3. 便携 node 能跑 ---------- */
{
  const out = await new Promise((done) => {
    const c = spawn(NODE_EXE, ['-v'], { stdio: ['ignore', 'pipe', 'ignore'] })
    let s = ''
    c.stdout.on('data', (d) => (s += String(d)))
    c.on('close', () => done(s.trim()))
    c.on('error', () => done(''))
  })
  check('便携 node 能跑（runtime\\node.exe -v）', /^v\d+\./.test(out), out || '跑不起来')
}

/* ---------- 4. 一键启动：真跑一遍 ---------- */
const originalToken = existsSync(TOKEN_FILE) ? readFileSync(TOKEN_FILE, 'utf-8') : null
const before = new Set(readdirSync(FOLDER))
const started = await runBat('开始使用.bat', { DADEALBIT_NO_OPEN: '1' })
const token = existsSync(TOKEN_FILE) ? readFileSync(TOKEN_FILE, 'utf-8').trim() : ''
check(
  '「开始使用.bat」报告助手已就绪',
  /Assistant is up on port/.test(started.out),
  started.out.trim().split('\n').pop()?.trim().slice(0, 120) || `退出码 ${started.code}`,
)
// cmd 的语法错误（比如 if 块里写了括号）只会打印一行然后继续，不看一眼就会漏掉
check(
  '「开始使用.bat」输出里没有 cmd 解析错误',
  !/was unexpected at this time|命令语法不正确|syntax is incorrect/.test(started.out),
  started.out.trim().split('\n')[0]?.trim().slice(0, 120) || '干净',
)
const status = await probe(token)
check('助手真的在跑，且令牌能通过鉴权', status === 200, `GET /status → ${status || '连不上'}`)
check('令牌不是空的', token.length >= 16, token ? `${token.length} 位` : '空')
const wrong = await probe('definitely-not-the-token')
check('令牌不对就拒绝（401）', wrong === 401, `GET /status → ${wrong || '连不上'}`)

/* 重复启动不该再起一个（幂等），也不该报错 */
const again = await runBat('开始使用.bat', { DADEALBIT_NO_OPEN: '1' })
check(
  '再点一次不会重复启动，照样报就绪',
  /Assistant is up on port/.test(again.out) && !/Starting the assistant/.test(again.out),
  again.out.trim().split('\n').filter(Boolean).pop()?.trim().slice(0, 120) || `退出码 ${again.code}`,
)
const stillUp = await probe(token)
check('第二次之后助手还在（没被误杀）', stillUp === 200, `GET /status → ${stillUp || '连不上'}`)

/* ---------- 4.5 「打开编辑器」这一步：拿启动器自己拼的 URL 来验 ----------
   踩过的坑：以前最后一行是 `start "" "%~dp0%HTMLF%#zhihu-token=..."`，
   Windows 的 start/ShellExecute 会把 `#zhihu-token=...` 当成**文件名的一部分**，
   于是每次都弹「Windows 找不到文件 ...#zhihu-token=...」—— 用户那边根本打不开编辑器。
   而当时的检查全都带 DADEALBIT_NO_OPEN=1，正好跳过这一行，所以一直没抓到。
   现在：① 用 DRY_RUN 让启动器把它要打开的 URL 打出来并逐项校验；② 静态拦住那个坏写法。 */
const BAT_TEXT = readFileSync(START, 'utf-8')
check(
  '启动器不再用 `start "...html#...` 这种坏写法（Windows 会当成文件名）',
  !/start\s+""\s+"%~dp0%HTMLF%#/.test(BAT_TEXT),
  BAT_TEXT.includes('%HTMLF%#') ? '还有 %HTMLF%# 这种写法' : '已改成 file:// URL',
)

const dry = await runBat('开始使用.bat', { DADEALBIT_DRY_RUN: '1' })
const dryUrl = /Would open:\s*(\S+)/.exec(dry.out)?.[1] ?? ''
check('启动器能报出它要打开的地址（DRY_RUN）', dryUrl.startsWith('file:///'), dryUrl.slice(0, 90) || dry.out.slice(0, 90))
check(
  '地址是正经的 file:// URL：带令牌 fragment、空格与中文都转义过了',
  dryUrl.includes('#zhihu-token=') && dryUrl.includes('&zhihu-addr=http') && !/ /.test(dryUrl),
  dryUrl.slice(0, 130),
)
{
  // 把 URL 还原成文件路径，必须真的指到这个 HTML
  const decoded = decodeURIComponent(dryUrl.replace(/^file:\/\/\//, '').split('#')[0]).replace(/\//g, '\\')
  check('URL 还原出来的路径就是那个编辑器文件', existsSync(decoded), decoded)
}
{
  const browser = await chromium.launch({ channel: 'msedge', headless: true })
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  // **用启动器自己拼出来的那个地址**（上面 DRY_RUN 打出来的），而不是这里另拼一个 ——
  // 这样"启动器给用户的地址能不能真的打开编辑器"才算被验证过
  const url = dryUrl || `file:///${HTML.replace(/\\/g, '/')}#zhihu-token=${token}&zhihu-addr=http://127.0.0.1:${PORT}`
  await page.goto(url, { waitUntil: 'load', timeout: 60000 })
  await page.waitForSelector('.ProseMirror', { timeout: 30000 })
  await page.locator('.zh-btn[title="知乎"]').click()
  await page.waitForSelector('.zh-modal--zhihu', { timeout: 10000 })
  const connected = await page
    .waitForSelector('text=助手已连接', { timeout: 20000 })
    .then(() => true)
    .catch(() => false)
  check('编辑器面板显示「助手已连接」（真助手、真页面）', connected)
  const state = await page.evaluate(() => ({
    token: localStorage.getItem('md-editor-zhihu-v1') ?? '',
    addr: localStorage.getItem('md-editor-zhihu-addr-v1') ?? '',
    hash: location.hash,
  }))
  check('令牌存进了浏览器', state.token === token, state.token ? `${state.token.length} 位` : '没存上')
  check('助手地址存进了浏览器', state.addr === `http://127.0.0.1:${PORT}`, state.addr || '没存上')
  check('地址栏里的令牌被立刻抹掉了（不在历史里留痕）', state.hash === '', state.hash || '已清空')
  await browser.close()
}

/* ---------- 6. 不留痕 ---------- */
const after = readdirSync(FOLDER)
const added = after.filter((n) => !before.has(n))
check('文件夹里没多出临时文件', added.length === 0, added.join(' ') || '干净')

const leaks = []
const walk = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = resolve(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'runtime') continue
      walk(full)
    } else if (entry.name !== 'Dadealbit Markdown 编辑器.html' && statSync(full).size < 2 * 1024 * 1024) {
      if (readFileSync(full, 'utf-8').includes(token)) leaks.push(entry.name)
    }
  }
}
walk(FOLDER)
check('令牌没被写进交付文件夹', leaks.length === 0, leaks.join(' ') || token.slice(0, 4) + '…只在 ~/.dadealbit')

/* ---------- 6.5 「打开编辑器」这一步：真跑一次，看浏览器有没有真的加载页面 ----------
   踩过的坑：以前那行 `start "" "...html#zhihu-token=..."` 会弹「Windows 找不到文件」；
   后来换成 explorer.exe，结果它把 file:// 当自己的协议、开出来一个资源管理器窗口。
   两次都是因为**检查全都带 DADEALBIT_NO_OPEN=1**（不打开浏览器），正好跳过这一步。
   现在改成：把编辑器临时换成"加载后回调本机服务"的测试页，真跑启动器，收到回调才算过。 */
{
  const http = await import('node:http')
  const hits = []
  const srv = http.createServer((req, res) => {
    hits.push(new URL(req.url, 'http://x').searchParams.get('m') ?? '?')
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    res.end('ok')
  })
  const CB_PORT = 5304
  await new Promise((r) => srv.listen(CB_PORT, '127.0.0.1', r))
  const original = readFileSync(HTML, 'utf-8')
  try {
    writeFileSync(
      HTML,
      `<!doctype html><meta charset="utf-8"><title>open-e2e</title><body><script>location.replace('http://127.0.0.1:${CB_PORT}/hit?m=launcher')</script>`,
      'utf-8',
    )
    const opened = await runBat('开始使用.bat', { DADEALBIT_NO_OPEN: '' }) // 不带 NO_OPEN：这次真去开浏览器
    let hit = false
    for (let i = 0; i < 24 && !hit; i += 1) {
      await new Promise((r) => setTimeout(r, 500))
      hit = hits.includes('launcher')
    }
    check('「开始使用.bat」真的把编辑器交给了浏览器（页面加载回调）', hit, hit ? '收到回调' : `输出：${opened.out.trim().split('\n').slice(-1)[0]?.slice(0, 90)}`)
    check(
      '打开这一步没有任何报错字样',
      !/Access is denied|cannot find|找不到|InvalidOperation/i.test(opened.out),
      opened.out.trim().split('\n').filter(Boolean).slice(-1)[0]?.slice(0, 90) || '干净',
    )
  } finally {
    writeFileSync(HTML, original, 'utf-8')
    srv.close()
  }
}

/* ---------- 7. 停止助手 ---------- */
const stopped = await runBat('停止助手.bat')
check('「停止助手.bat」报告已停止', /Assistant stopped/.test(stopped.out), stopped.out.trim().split('\n').pop()?.trim().slice(0, 120) || `退出码 ${stopped.code}`)
check(
  '「停止助手.bat」输出里没有报错',
  !/ERROR|unexpected at this time/.test(stopped.out),
  stopped.out.trim().split('\n').find((l) => /ERROR|unexpected/.test(l))?.trim().slice(0, 120) || '干净',
)
let down = false
for (let i = 0; i < 20; i += 1) {
  if ((await probe(token)) === 0) {
    down = true
    break
  }
  await sleep(500)
}
check('停止之后端口不再响应', down, down ? `${PORT} 已关闭` : `还在响应`)

/* 测试用的助手会轮换令牌，把用户原来的那份放回去，免得正在用的助手被带偏 */
if (originalToken !== null && originalToken.trim() !== token) {
  try {
    writeFileSync(TOKEN_FILE, originalToken, { encoding: 'utf-8', mode: 0o600 })
  } catch {
    /* 放不回去也不影响 */
  }
}

for (const r of results) if (!r.ok) console.log(`\n待修：${r.name}`)
const failed = results.filter((r) => !r.ok).length
console.log(`\n${results.length - failed}/${results.length} 通过`)
process.exit(failed ? 1 : 0)
