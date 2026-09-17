/**
 * 纸张背景色 —— 回归防线（新功能，2026-10-01）。
 *
 * 守四件事：
 *   A. 「字体」菜单里真有一排背景色，点一下就换纸（并且**只有纸变**：工具栏/面板不受影响）
 *   B. 换完关掉浏览器再打开还在（localStorage 新键 `md-editor-bg-v1`）
 *   C. 深色纸自动用浅色字（否则深底黑字看不见）；「恢复默认」把变量删干净、回到主题的纸色
 *   D. 导出的网页也带上这张纸（颜色 + 字色）—— 而**没设过背景时导出的文件一个字都不多**（老行为不变）
 *
 * 判定都用计算样式与实际导出文件，不看"设置项亮了没有"。
 * 被测代码：src/editor/pageBackground.ts + TypographyMenu 的背景那一排 + buildStandaloneHtml。
 */
import { chromium } from 'playwright-core'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'

/** **本套件的断言总数** —— 文档里的数量占位符读的就是这个常量（见 check:docs-counts）。 */
export const TEST_COUNT = 16

const APP = resolve('Dadealbit Markdown 编辑器.html')
if (!existsSync(APP)) {
  console.error('先跑 pnpm build:pure')
  process.exit(1)
}

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`${ok ? '✅' : '❌'}  ${name}${detail ? '  — ' + detail : ''}`)
}

const DL = resolve('.probe', 'page-bg-dl')
rmSync(DL, { recursive: true, force: true })

const browser = await chromium.launch({ channel: 'msedge', headless: true })
const page = await browser.newPage({ viewport: { width: 1280, height: 950 }, acceptDownloads: true })
const errs = []
page.on('pageerror', (e) => errs.push(String(e).slice(0, 140)))

const openApp = async () => {
  await page.goto('file:///' + APP.replace(/\\/g, '/'), { waitUntil: 'load', timeout: 60000 })
  await page.waitForSelector('.ProseMirror', { timeout: 30000 })
  await page.waitForTimeout(1100)
}
/** 纸张与正文的实际颜色（计算样式，不是看设置项） */
const look = () =>
  page.evaluate(() => {
    const card = document.querySelector('.editor-card')
    const prose = document.querySelector('.ProseMirror')
    return {
      cardBg: card ? getComputedStyle(card).backgroundColor : '(没有卡)',
      proseColor: prose ? getComputedStyle(prose).color : '(没有正文)',
      rootBg: document.documentElement.style.getPropertyValue('--doc-bg'),
      rootInk: document.documentElement.style.getPropertyValue('--doc-ink'),
      saved: localStorage.getItem('md-editor-bg-v1'),
    }
  })
const openFontMenu = async () => {
  await page.keyboard.press('Escape')
  await page.waitForTimeout(200)
  await page.locator('.zh-btn[title="正文字号 / 字体 / 颜色 / 背景"]').click()
  await page.waitForSelector('.zh-typomenu', { timeout: 8000 })
}
const exportHtml = async (fileName) => {
  await page.keyboard.press('Escape')
  await page.waitForTimeout(250)
  await page.locator('.zh-btn[title="保存"]').click()
  const [dl] = await Promise.all([
    page.waitForEvent('download', { timeout: 30000 }),
    page.locator('.zh-menu__item[data-format="html"]').click(),
  ])
  const saved = resolve(DL, fileName)
  await dl.saveAs(saved)
  await page.waitForTimeout(400)
  return readFileSync(saved, 'utf8')
}

/* ---------- 0. 默认状态：纸色就是主题的纸（没有 --doc-bg） ---------- */
await openApp()
const before = await look()
check('默认：没有设过背景时 --doc-bg 不存在（老行为不变）', before.rootBg === '' && before.saved === null, `rootBg=${JSON.stringify(before.rootBg)} saved=${before.saved}`)
check('默认：纸是主题自己的卡色', before.cardBg === 'rgb(255, 255, 255)', before.cardBg)

/* ---------- A. 菜单里点一下换纸 ---------- */
await openFontMenu()
const swatches = await page.locator('.zh-typomenu [data-bg-row] .zh-typomenu__swatch').count()
check('A1 「字体」菜单里有背景那一排（默认 + 7 个预设）', swatches === 8, `${swatches} 个色块`)
await page.locator('.zh-typomenu [data-bg-row] .zh-typomenu__swatch[title="背景：淡黄"]').click()
await page.waitForTimeout(400)
const afterYellow = await look()
check('A2 点「淡黄」后纸真的变黄了', afterYellow.cardBg === 'rgb(253, 246, 227)', afterYellow.cardBg)
check('A3 只有纸变：工具栏不受影响（还是主题色）', await page.evaluate(() => getComputedStyle(document.querySelector('.zh-toolbar')).backgroundColor) !== 'rgb(253, 246, 227)', '工具栏没跟着变')
check('A4 浅色纸 → 字仍是深色', afterYellow.proseColor === 'rgb(25, 27, 31)', afterYellow.proseColor)

/* ---------- B. 关掉重开还在 ---------- */
await page.waitForTimeout(300)
await openApp()
const afterReload = await look()
check('B1 关掉再打开：纸还是淡黄（存进了 localStorage）', afterReload.cardBg === 'rgb(253, 246, 227)', afterReload.cardBg)
check('B2 存的是新键 md-editor-bg-v1，没动已有的键', (afterReload.saved ?? '').includes('#fdf6e3'), afterReload.saved ?? '(空)')

/* ---------- C. 深色纸自动用浅字 + 恢复默认 ---------- */
await page.evaluate(() => localStorage.setItem('md-editor-bg-v1', JSON.stringify({ color: '#1f2430' })))
await openApp()
const dark = await look()
check('C1 深色纸：字色自动变浅（否则深底黑字看不见）', dark.proseColor === 'rgb(232, 234, 237)', dark.proseColor)
check('C2 纸确实是那个深色', dark.cardBg === 'rgb(31, 36, 48)', dark.cardBg)
await openFontMenu()
await page.locator('.zh-typomenu [data-bg-row] .zh-typomenu__reset').click()
await page.waitForTimeout(400)
const cleared = await look()
check('C3 「恢复默认」把变量删干净、回到主题纸色', cleared.rootBg === '' && cleared.cardBg === 'rgb(255, 255, 255)', `rootBg=${JSON.stringify(cleared.rootBg)} card=${cleared.cardBg}`)
check('C4 恢复默认后存档里是空串（不是残留旧颜色）', (cleared.saved ?? '').includes('""'), cleared.saved ?? '(空)')

/* ---------- D. 导出的网页也带上这张纸 ---------- */
const plainHtml = await exportHtml('plain.html')
check('D1 没设背景时：导出的网页里没有多余样式（老行为）', !/body \{ background/.test(plainHtml), '没有 background 行')

await page.evaluate(() => localStorage.setItem('md-editor-bg-v1', JSON.stringify({ color: '#1f2430' })))
await openApp()
const darkHtml = await exportHtml('dark.html')
check('D2 深色纸：导出的网页带上纸色', darkHtml.includes('background: #1f2430'), '有 background: #1f2430')
check('D3 深色纸：导出的网页字色也是浅的', darkHtml.includes('color: #e8eaed'), '有 color: #e8eaed')

check('全程无页面错误', errs.length === 0, errs.slice(0, 2).join(' | '))

await browser.close()
for (const r of results) if (!r.ok) console.log(`\n待修：${r.name}`)
const failed = results.filter((r) => !r.ok).length
console.log(`\n${results.length - failed}/${results.length} 通过`)
/* 自检：实际断言数必须等于对外声明的 TEST_COUNT（文档数量占位符读它） */
if (results.length !== TEST_COUNT) {
  console.log(`\n❌ 断言总数与 TEST_COUNT 不符：实际 ${results.length}，声明 ${TEST_COUNT}`)
  process.exit(1)
}
process.exit(failed ? 1 : 0)
