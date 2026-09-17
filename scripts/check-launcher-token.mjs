/**
 * 「启动器把助手令牌带进来」的回归测试
 *
 * 背景：以前用户要手动双击 bat、留着黑窗口、再把令牌粘进面板。
 * 现在「开始使用.bat」在后台把助手拉起来，然后打开
 *   Dadealbit Markdown 编辑器.html#zhihu-token=<令牌>&zhihu-addr=http://127.0.0.1:5174
 * 编辑器要：
 *   1. 把令牌/地址存进面板用的那份配置（localStorage）
 *   2. **立刻把 hash 抹掉**（令牌不能留在地址栏和浏览历史里）
 *   3. 面板打开时能读到它、并去探测助手
 * 另外要保证：hash 里没东西时，一切照旧（不能把用户原有配置弄丢）。
 */
import { chromium } from 'playwright-core'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

const APP = resolve('Dadealbit Markdown 编辑器.html')
if (!existsSync(APP)) {
  console.error('先跑 pnpm build')
  process.exit(1)
}
const app = 'file:///' + APP.replace(/\\/g, '/')

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`${ok ? '✅' : '❌'}  ${name}${detail ? '  — ' + detail : ''}`)
}

const browser = await chromium.launch({ channel: 'msedge', headless: true })
const page = await browser.newPage({ viewport: { width: 1280, height: 950 } })
const errs = []
page.on('pageerror', (e) => errs.push(String(e).slice(0, 140)))

/* ---------- 1. 带着令牌打开：应该自动填好并抹掉 hash ---------- */
const TOKEN = 'launcher-token-abc123'
await page.goto(`${app}#zhihu-token=${TOKEN}&zhihu-addr=http://127.0.0.1:5198`, { waitUntil: 'load', timeout: 60000 })
await page.waitForSelector('.ProseMirror', { timeout: 30000 })
await page.waitForTimeout(1500)

const stored = await page.evaluate(() => ({
  token: localStorage.getItem('md-editor-zhihu-v1'),
  addr: localStorage.getItem('md-editor-zhihu-addr-v1'),
  hash: window.location.hash,
  href: window.location.href,
}))
check('启动器带的令牌被存进配置', stored.token === TOKEN, String(stored.token))
check('启动器带的助手地址也被存下来', stored.addr === 'http://127.0.0.1:5198', String(stored.addr))
check('地址栏里的 hash 被抹掉了（令牌不留在地址栏/历史）', stored.hash === '', `hash="${stored.hash}"`)
check('地址里再也搜不到令牌', !stored.href.includes(TOKEN), stored.href.slice(-60))
check('给了个"已经连上"的提示', /助手/.test(await page.evaluate(() => document.querySelector('.zh-fixbar__text')?.textContent ?? '')))

/* 面板打开时应该读到它（并去探测那个地址） */
await page.locator('.zh-btn[title="知乎"]').click()
await page.waitForTimeout(1200)
const panel = await page.evaluate(() => ({
  addr: document.querySelector('.zh-zhihu__field input')?.value ?? '',
  state: document.querySelector('.zh-zhihu__state')?.textContent ?? '',
  selfCheckBtn: !!document.querySelector('.zh-modal--zhihu button[title*="临时草稿"]'),
}))
check('面板里助手地址已填好', panel.addr === 'http://127.0.0.1:5198', panel.addr)
check('面板拿这个令牌去探测了（探测失败=没助手，属正常）', /没检测到助手|助手已连接/.test(panel.state), panel.state.slice(0, 30))
check('面板上有「检查一下能不能用（自检）」按钮', panel.selfCheckBtn)

/* ---------- 2. 没有 hash 时：原有配置不能被弄丢 ---------- */
await page.keyboard.press('Escape')
await page.waitForTimeout(300)
await page.goto(app, { waitUntil: 'load', timeout: 60000 })
await page.waitForSelector('.ProseMirror', { timeout: 30000 })
await page.waitForTimeout(1200)
const kept = await page.evaluate(() => localStorage.getItem('md-editor-zhihu-v1'))
check('不带 hash 打开时，之前存好的令牌还在（没被清掉）', kept === TOKEN, String(kept))

/* ---------- 3. 只有地址、没有令牌（半截 hash）也不能出错 ---------- */
await page.goto(`${app}#zhihu-addr=http://127.0.0.1:5174`, { waitUntil: 'load', timeout: 60000 })
await page.waitForSelector('.ProseMirror', { timeout: 30000 })
await page.waitForTimeout(1200)
const half = await page.evaluate(() => ({
  token: localStorage.getItem('md-editor-zhihu-v1'),
  addr: localStorage.getItem('md-editor-zhihu-addr-v1'),
  hash: window.location.hash,
}))
check('半截 hash：只更新地址，令牌保持原样', half.token === TOKEN && half.addr === 'http://127.0.0.1:5174', JSON.stringify(half))
check('半截 hash 也被抹掉', half.hash === '')

check('全程无页面错误', errs.length === 0, errs.slice(0, 2).join(' | '))

/* ---------- 4. 面板里那两个输入框还得能打字 ----------
   踩过的坑：面板「打开时重读 localStorage」的效果如果依赖 addr，
   打字 → 重跑效果 → 读回 localStorage 里的旧值 → 把刚打的字改回去，
   地址栏就变成一个字都打不进去（右上角那句提示还在，很难看出是代码问题）。 */
await page.goto(app, { waitUntil: 'load', timeout: 60000 })
await page.waitForSelector('.ProseMirror', { timeout: 30000 })
await page.locator('.zh-btn[title="知乎"]').click()
await page.waitForSelector('.zh-modal--zhihu', { timeout: 5000 })
await page.waitForTimeout(600)
const addrBox = page.locator('.zh-zhihu__field input').first()
const tokenBox = page.locator('.zh-zhihu__field input').nth(1)
await addrBox.click()
await page.keyboard.press('Control+a')
await page.keyboard.type('http://127.0.0.1:5999', { delay: 5 })
check('助手地址能正常打字（不会被打回原值）', (await addrBox.inputValue()) === 'http://127.0.0.1:5999', await addrBox.inputValue())
await tokenBox.click()
await page.keyboard.press('Control+a')
await page.keyboard.type('typed-token-xyz', { delay: 5 })
check('助手令牌能正常打字', (await tokenBox.inputValue()) === 'typed-token-xyz', await tokenBox.inputValue())
check('打完字地址框没被连带改掉', (await addrBox.inputValue()) === 'http://127.0.0.1:5999', await addrBox.inputValue())

await browser.close()
for (const r of results) if (!r.ok) console.log(`\n待修：${r.name}`)
const failed = results.filter((r) => !r.ok).length
console.log(`\n${results.length - failed}/${results.length} 通过`)
process.exit(failed ? 1 : 0)
