/**
 * 公式输入补全体检：触发 / 最多 3 条 / 键盘选择 / 插入位置 / 与分类面板不冲突
 * 前提：pnpm dev 已运行
 */
import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

const OUT = resolve('.probe')
mkdirSync(OUT, { recursive: true })
const BASE = 'http://127.0.0.1:5173/'

const results = []
const record = (name, ok, detail = '') => {
  results.push({ name, ok, detail })
  console.log(`${ok ? '✅' : '❌'}  ${name}${detail ? '  — ' + detail : ''}`)
}

const browser = await chromium.launch({ channel: 'msedge', headless: true })
const page = await browser.newPage({ viewport: { width: 1360, height: 900 } })
const errors = []
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text())
})
page.on('pageerror', (e) => errors.push(String(e.message)))

await page.goto(BASE, { waitUntil: 'load', timeout: 60000 })
await page.waitForSelector('.ProseMirror', { timeout: 30000 })
await page.waitForTimeout(1300)

const openMath = async () => {
  if (await page.locator('.zh-modal--math').isVisible().catch(() => false)) return
  await page.locator('.zh-btn[title="公式"]').click()
  await page.waitForSelector('.zh-modal--math', { timeout: 4000 })
  await page.waitForTimeout(300)
}
const texValue = () => page.locator('.zh-mathsource').inputValue()
const items = () => page.locator('.zh-autocomplete__item')
const setTexAndCaret = async (text) => {
  await page.locator('.zh-mathsource').click()
  await page.locator('.zh-mathsource').fill(text)
  await page.waitForTimeout(300)
}

await openMath()

/* 1. 打 \al 出现候选 */
await setTexAndCaret('\\al')
const n1 = await items().count()
const firstText = n1 ? await items().first().innerText() : ''
record('输入 "\\al" 出现候选', n1 > 0 && n1 <= 3, `${n1} 条，第一条：${firstText.replace(/\n/g, ' / ')}`)
record('候选带图形与中文名', firstText.includes('alpha') || firstText.includes('阿尔法'), firstText)

/* 2. 最多三条（用户要求只要三个） */
await setTexAndCaret('\\s')
const n2 = await items().count()
record('候选最多 3 条', n2 === 3, `输入 "\\s" 给了 ${n2} 条`)

/* 3. 不输入反斜杠时不给候选 */
await setTexAndCaret('x^2 + ')
record('普通输入不打扰', (await items().count()) === 0, `候选 ${await items().count()} 条`)

/* 4. 键盘选择 + Enter 插入 */
await setTexAndCaret('\\alp')
await page.waitForTimeout(300)
await page.keyboard.press('Enter')
await page.waitForTimeout(400)
const afterEnter = await texValue()
record('Enter 插入候选', afterEnter.startsWith('\\alpha'), JSON.stringify(afterEnter))

/* 5. 模板类补全：光标应落在第一个空括号里 */
await setTexAndCaret('\\fra')
await page.waitForTimeout(300)
const fracItem = items().filter({ hasText: 'frac' }).first()
const hasFrac = (await items().count()) > 0
if (hasFrac) await fracItem.click()
await page.waitForTimeout(400)
const afterFrac = await texValue()
const caretInside = await page.evaluate(() => {
  const ta = document.querySelector('.zh-mathsource')
  return { value: ta.value, pos: ta.selectionStart }
})
record(
  '模板补全后光标落在空括号里',
  afterFrac.includes('\\frac') && caretInside.pos === afterFrac.indexOf('{}') + 1,
  `tex=${JSON.stringify(afterFrac)} 光标=${caretInside.pos}`,
)

/* 6. ↑↓ 能换选中的那条 */
await setTexAndCaret('\\the')
await page.waitForTimeout(300)
const before = await items().filter({ has: page.locator('.zh-autocomplete__cmd') }).allInnerTexts()
await page.keyboard.press('ArrowDown')
await page.waitForTimeout(200)
const onIndex = await page.evaluate(() => {
  const list = [...document.querySelectorAll('.zh-autocomplete__item')]
  return list.findIndex((el) => el.className.includes('--on'))
})
record('↑↓ 可切换候选', onIndex === 1 || before.length === 1, `当前高亮第 ${onIndex + 1} 条（共 ${before.length} 条）`)

/* 7. Esc 只收起补全，不关弹窗 */
await setTexAndCaret('\\alp')
await page.waitForTimeout(300)
await page.keyboard.press('Escape')
await page.waitForTimeout(300)
record(
  'Esc 只收起补全，弹窗还在',
  (await items().count()) === 0 && (await page.locator('.zh-modal--math').isVisible()),
  `候选 ${await items().count()} 条，弹窗可见 ${await page.locator('.zh-modal--math').isVisible()}`,
)

/* 8. 补全出来的公式能真的插入正文 */
await page.locator('.zh-mathsource').fill('\\sqrt{2}')
await page.waitForTimeout(300)
await page.getByRole('button', { name: '确认', exact: true }).click()
await page.waitForTimeout(700)
const md = await page.evaluate(() => window.__MD__())
record('补全后确认插入正文', md.includes('\\sqrt{2}'), md.slice(-24).replace(/\n/g, '⏎'))

await openMath()
await setTexAndCaret('\\alp')
await page.waitForTimeout(400)
await page.screenshot({ path: resolve(OUT, 'autocomplete.png') })
record('全程控制台无错误', errors.length === 0, errors.length ? errors.slice(0, 3).join(' | ').slice(0, 200) : '无')

await browser.close()
for (const r of results) if (!r.ok) console.log(`\n待修：${r.name} — ${r.detail}`)
const failed = results.filter((r) => !r.ok).length
console.log(`\n${results.length - failed}/${results.length} 通过`)
process.exit(failed ? 1 : 0)
