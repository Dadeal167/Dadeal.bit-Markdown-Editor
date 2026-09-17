/**
 * 浅深色主题体检：切换 / 生效 / 持久化 / 打印回浅色 / 关键元素对比度
 * 前提：pnpm dev 已运行
 */
import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

const OUT = resolve('.probe')
mkdirSync(OUT, { recursive: true })
const BASE = 'http://127.0.0.1:5173/'
const THEME_KEY = 'md-editor-theme-v1'

const results = []
const record = (name, ok, detail = '') => {
  results.push({ name, ok, detail })
  console.log(`${ok ? '✅' : '❌'}  ${name}${detail ? '  — ' + detail : ''}`)
}

const browser = await chromium.launch({ channel: 'msedge', headless: true })
const context = await browser.newContext({ viewport: { width: 1360, height: 900 }, acceptDownloads: true })
const page = await context.newPage()
const errors = []
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text())
})
page.on('pageerror', (e) => errors.push(String(e.message)))

const ready = async () => {
  await page.waitForSelector('.ProseMirror', { timeout: 30000 })
  await page.waitForTimeout(1200)
}
const pickTheme = async (label) => {
  await page.locator('.zh-btn[title^="主题"]').click()
  await page.waitForTimeout(200)
  await page.locator('.zh-menu__item', { hasText: label }).click()
  await page.waitForTimeout(400)
}
const colors = () =>
  page.evaluate(() => {
    const g = (sel, prop) => {
      const el = document.querySelector(sel)
      return el ? getComputedStyle(el)[prop] : null
    }
    return {
      theme: document.documentElement.dataset.theme,
      bodyBg: g('body', 'backgroundColor'),
      cardBg: g('.editor-card', 'backgroundColor'),
      text: g('.zh-prose', 'color'),
      toolbarBg: g('.zh-toolbar', 'backgroundColor'),
      statusBg: g('.zh-statusbar', 'backgroundColor'),
    }
  })

await page.goto(BASE, { waitUntil: 'load', timeout: 60000 })
await ready()
await page.evaluate((k) => localStorage.removeItem(k), THEME_KEY)
await page.reload({ waitUntil: 'load' })
await ready()

/* 1. 默认跟随系统（无头浏览器默认浅色） */
record('默认为跟随系统', (await colors()).theme === 'light', (await colors()).theme)

/* 2. 切深色 */
await pickTheme('深色')
const dark = await colors()
record(
  '切到深色：页面 / 白卡 / 文字都变了',
  dark.theme === 'dark' && dark.bodyBg === 'rgb(22, 24, 28)' && dark.cardBg === 'rgb(30, 33, 38)',
  `body=${dark.bodyBg} card=${dark.cardBg}`,
)
record(
  '深色下正文是浅色字',
  dark.text === 'rgb(230, 232, 234)',
  dark.text,
)
// 亮度对比：正文文字应明显亮于卡片底色
const contrast = await page.evaluate(() => {
  const lum = (rgb) => {
    const [r, g, b] = rgb.match(/\d+/g).map(Number)
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255
  }
  const text = lum(getComputedStyle(document.querySelector('.zh-prose')).color)
  const card = lum(getComputedStyle(document.querySelector('.editor-card')).backgroundColor)
  return Math.round(Math.abs(text - card) * 100)
})
record('深色下文字与底色对比足够', contrast >= 60, `亮度差 ${contrast}%`)

/* 3. 工具栏 / 状态栏 / 下拉 / 弹窗也变深 */
await page.locator('.zh-btn[title^="主题"]').click()
await page.waitForTimeout(300)
const menuBg = await page.evaluate(() => {
  const el = document.querySelector('.zh-menu')
  return el ? getComputedStyle(el).backgroundColor : null
})
await page.keyboard.press('Escape')
const modalBg = await (async () => {
  await page.locator('.zh-btn[title="公式"]').click()
  await page.waitForSelector('.zh-modal--math', { timeout: 4000 })
  const bg = await page.evaluate(() => getComputedStyle(document.querySelector('.zh-modal')).backgroundColor)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)
  return bg
})()
record(
  '下拉 / 弹窗在深色下也是深底',
  menuBg === 'rgb(35, 38, 44)' && modalBg === 'rgb(30, 33, 38)',
  `menu=${menuBg} modal=${modalBg}`,
)
record('工具栏与状态栏跟随主题', dark.toolbarBg === 'rgb(30, 33, 38)' && dark.statusBg === 'rgb(30, 33, 38)')

/* 4. 公式在深色下可见（KaTeX 用 currentColor） */
const mathColor = await page.evaluate(() => {
  const el = document.querySelector('.math-node .katex')
  return el ? getComputedStyle(el).color : null
})
record('公式在深色下用浅色字', mathColor === 'rgb(230, 232, 234)', mathColor)

await page.screenshot({ path: resolve(OUT, 'theme-dark.png') })

/* 5. 刷新后仍是深色 */
await page.reload({ waitUntil: 'load' })
await ready()
record('刷新后保持深色', (await colors()).theme === 'dark', (await colors()).theme)

/* 6. 打印时必须回浅色 */
await page.emulateMedia({ media: 'print' })
await page.waitForTimeout(300)
const printBg = await page.evaluate(() => getComputedStyle(document.querySelector('.zh-prose')).backgroundColor)
await page.emulateMedia({ media: 'screen' })
record('深色模式下打印回浅色', printBg === 'rgb(255, 255, 255)', printBg)

/* 7. 切回浅色 */
await pickTheme('浅色')
const light = await colors()
record(
  '切回浅色',
  light.theme === 'light' && light.bodyBg === 'rgb(248, 248, 250)' && light.cardBg === 'rgb(255, 255, 255)',
  `body=${light.bodyBg}`,
)

/* 8. 跟随系统：模拟系统深色 */
await context.close()
const ctx2 = await browser.newContext({ viewport: { width: 1360, height: 900 }, colorScheme: 'dark' })
const page2 = await ctx2.newPage()
await page2.goto(BASE, { waitUntil: 'load', timeout: 60000 })
await page2.waitForSelector('.ProseMirror', { timeout: 30000 })
await page2.waitForTimeout(1200)
const sysTheme = await page2.evaluate(() => document.documentElement.dataset.theme)
record('系统深色时自动用深色', sysTheme === 'dark', sysTheme)

record('全程控制台无错误', errors.length === 0, errors.length ? errors.slice(0, 3).join(' | ').slice(0, 200) : '无')

await browser.close()
for (const r of results) if (!r.ok) console.log(`\n待修：${r.name} — ${r.detail}`)
const failed = results.filter((r) => !r.ok).length
console.log(`\n${results.length - failed}/${results.length} 通过`)
process.exit(failed ? 1 : 0)
