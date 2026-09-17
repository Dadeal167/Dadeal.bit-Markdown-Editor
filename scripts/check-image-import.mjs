/**
 * 图片导入回归测试（针对用户真实遇到的情况）
 *
 * 背景：很多导出工具（知乎导出、网页转 Markdown 工具）会把图片存成旁边的
 * assets/xxx.jpg，正文里写**相对路径**。编辑器是一个单独打开的本地网页，
 * 浏览器不允许它读旁边的文件夹 —— 于是图片全是裂的（实测 8/8 张打不开）。
 * 修法：导入后浮出提示条 → 选导出文件夹 → 按文件名配上、压缩后内嵌成 data URL。
 *
 * 这个脚本走真实路径：开双击版单文件 HTML →「打开」导入 .md → 点提示条上的修复按钮
 * → 用真实的文件夹选择器交图 → 检查图片是否真的显示出来了，并且关掉重开还在。
 */
import { chromium } from 'playwright-core'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { makeAnimatedGif } from './make-test-gif.mjs'

/**
 * **本套件的断言总数** —— 文档里的数量占位符读的就是这个常量（见 check:docs-counts）。
 * 改测试条数时改这里；文档不用动（占位符会跟着变）。
 */
export const TEST_COUNT = 15

const APP = resolve('Dadealbit Markdown 编辑器.html')
if (!existsSync(APP)) {
  console.error('先跑 pnpm build')
  process.exit(1)
}

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`${ok ? '✅' : '❌'}  ${name}${detail ? '  — ' + detail : ''}`)
}

/* ---------- 造一个"知乎导出"那样的文件夹：assets/文章名/img_00N.jpg ---------- */
const ROOT = resolve('.probe', 'img-repair')
const ART = '我的文章'
const ASSETS = join(ROOT, 'assets', ART)
mkdirSync(ASSETS, { recursive: true })

// 用一张最小的真 PNG 当图片（1x1 红点），验证"能解码显示"就够
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)
const NAMES = ['img_001.png', 'img_002.png', 'img_003.png']
NAMES.forEach((n) => writeFileSync(join(ASSETS, n), PNG))

const mdPath = join(ROOT, `${ART}.md`)
const md = [
  `# ${ART}`,
  '',
  '开头一段话。',
  '',
  ...NAMES.map((n, i) => `![图${i + 1}](assets/${ART}/${n})`),
  '',
  '公式也要在：$x_1 + y_2$',
  '',
].join('\n')
writeFileSync(mdPath, md, 'utf-8')

const browser = await chromium.launch({ channel: 'msedge', headless: true })
const page = await browser.newPage({ viewport: { width: 1300, height: 1000 } })
const errors = []
page.on('pageerror', (e) => errors.push(String(e).slice(0, 120)))
const mdNow = () => page.evaluate(() => window.__MD__?.() ?? '')

const openApp = async () => {
  await page.goto('file:///' + APP.replace(/\\/g, '/'), { waitUntil: 'load', timeout: 60000 })
  await page.waitForSelector('.ProseMirror', { timeout: 30000 })
  await page.waitForTimeout(900)
}

/* ---------- 1. 导入：图片应当是裂的，提示条应当浮出来 ---------- */
await openApp()
const [chooser] = await Promise.all([
  page.waitForEvent('filechooser', { timeout: 10000 }),
  page.locator('.zh-btn[title="打开"]').click(),
])
await chooser.setFiles(mdPath)
await page.waitForTimeout(2500)

const afterImport = await page.evaluate(() => {
  const imgs = [...document.querySelectorAll('.ProseMirror img')].filter(
    (i) => !String(i.className).includes('separator'),
  )
  return {
    imgs: imgs.length,
    broken: imgs.filter((i) => !i.complete || i.naturalWidth === 0).length,
    bar: !!document.querySelector('.zh-fixbar'),
    barText: document.querySelector('.zh-fixbar__text')?.textContent?.trim() ?? '',
    repairBtn: !!document.querySelector('.zh-btn[title="修复图片：选导出文件夹"], .zh-pill[title="修复图片：选导出文件夹"]'),
  }
})
check('导入后 3 张图片都打不开（相对路径）', afterImport.imgs === 3 && afterImport.broken === 3, `${afterImport.broken}/${afterImport.imgs} 裂图`)
check('自动浮出提示条', afterImport.bar && /图片打不开/.test(afterImport.barText), afterImport.barText.slice(0, 40))
check('提示条上有「选导出文件夹修复」按钮', afterImport.repairBtn)

/* ---------- 2. 点修复 → 选导出文件夹 → 图片应当全部嵌进来 ---------- */
const [dirChooser] = await Promise.all([
  page.waitForEvent('filechooser', { timeout: 10000 }),
  page.locator('.zh-pill[title="修复图片：选导出文件夹"]').click(),
])
await dirChooser.setFiles(ROOT) // Playwright 对 webkitdirectory 输入支持直接给目录
await page.waitForTimeout(3500)

const afterFix = await page.evaluate(() => {
  const imgs = [...document.querySelectorAll('.ProseMirror img')].filter(
    (i) => !String(i.className).includes('separator'),
  )
  return {
    imgs: imgs.length,
    broken: imgs.filter((i) => !i.complete || i.naturalWidth === 0).length,
    dataSrc: imgs.filter((i) => (i.getAttribute('src') || '').startsWith('data:image/')).length,
    note: document.querySelector('.zh-fixbar')?.textContent?.trim() ?? '',
    okBar: !!document.querySelector('.zh-fixbar--ok'),
  }
})
check('修复后 3 张图片全部显示出来', afterFix.imgs === 3 && afterFix.broken === 0, `裂图 ${afterFix.broken}/${afterFix.imgs}`)
check('图片已内嵌成 data URL', afterFix.dataSrc === 3, `${afterFix.dataSrc}/3`)
check('提示条变成"修好了"的绿色反馈', afterFix.okBar && /已把 3 张图片/.test(afterFix.note), afterFix.note.slice(0, 40))

const mdAfter = await mdNow()
check(
  '导出的 Markdown 里图片变成内嵌数据',
  !/assets\//.test(mdAfter) && (mdAfter.match(/data:image\//g) || []).length >= 3,
  `data:image 出现 ${(mdAfter.match(/data:image\//g) || []).length} 次`,
)
check('公式没被图片修复弄坏', mdAfter.includes('$x_1 + y_2$'))

/* ---------- 3. 关掉重开：图片还在（真的存下来了） ---------- */
await page.waitForTimeout(1600) // 等自动保存（1.2s）
await openApp()
await page.waitForTimeout(1500)
const afterReload = await page.evaluate(() => {
  const imgs = [...document.querySelectorAll('.ProseMirror img')].filter(
    (i) => !String(i.className).includes('separator'),
  )
  return {
    imgs: imgs.length,
    broken: imgs.filter((i) => !i.complete || i.naturalWidth === 0).length,
    bar: !!document.querySelector('.zh-fixbar'),
  }
})
check(
  '关掉再打开：图片还在，也不再提示修复',
  afterReload.imgs === 3 && afterReload.broken === 0 && !afterReload.bar,
  `${afterReload.imgs} 张，裂 ${afterReload.broken}，提示条 ${afterReload.bar ? '还在' : '没了'}`,
)

check('全程无页面错误', errors.length === 0, errors.slice(0, 2).join(' | '))

/* ============================================================
 * 场景二（用户 2026-09-27 在新电脑上遇到的）：导出文件夹名字里**带空格**
 *
 * 知乎导出（和别的"网页转 Markdown"工具）会用**文章标题**当文件夹名，
 * 而标题里带空格是常态。`![说明](assets/文章 名/img.gif)` 里的裸空格会让整段
 * 不再是图片语法 → 导入后正文里出现那行字、图一张都没有，而且因为没建出图片节点，
 * "图片打不开"的提示也不会出现（界面上无路可走）。
 * 修法见 src/editor/tiptap/mdDestinations.ts（导入前把目标里的坏字符转义）。
 * 这里守的是**完整链路**：带空格的文件夹 + 动图 → 导入 → 提示条 → 选文件夹 → 内嵌。
 * ============================================================ */
const ROOT2 = resolve('.probe', 'img-repair-space')
const ART2 = '可能是更简单的Markdown编辑器？——Dadealbit Markdown编辑器' /* ← 里面有空格 */
const ASSETS2 = join(ROOT2, 'assets', ART2)
mkdirSync(ASSETS2, { recursive: true })
writeFileSync(join(ASSETS2, 'img_001.png'), PNG)
writeFileSync(join(ASSETS2, 'img_002.gif'), makeAnimatedGif())

const mdPath2 = join(ROOT2, `${ART2}.md`)
writeFileSync(
  mdPath2,
  ['# 带空格的导出文件夹', '', `![静态图](assets/${ART2}/img_001.png)`, `![动图](assets/${ART2}/img_002.gif)`, ''].join('\n'),
  'utf-8',
)

await openApp()
const [chooser2] = await Promise.all([
  page.waitForEvent('filechooser', { timeout: 10000 }),
  page.locator('.zh-btn[title="打开"]').click(),
])
await chooser2.setFiles(mdPath2)
await page.waitForTimeout(2500)

const spaceImport = await page.evaluate(() => {
  const imgs = [...document.querySelectorAll('.ProseMirror img')].filter(
    (i) => !String(i.className).includes('separator'),
  )
  const text = document.querySelector('.ProseMirror')?.textContent ?? ''
  return {
    imgs: imgs.length,
    text,
    literal: text.includes('!['),
    bar: !!document.querySelector('.zh-fixbar'),
    repairBtn: !!document.querySelector('.zh-pill[title="修复图片：选导出文件夹"]'),
  }
})
check(
  '文件夹名字带空格：图片照样**建出来了**（用户那次是 0 张、只剩一行字）',
  spaceImport.imgs === 2,
  `${spaceImport.imgs} 张`,
)
check('文件夹名字带空格：正文里没有字面 `![`', !spaceImport.literal, spaceImport.text.replace(/\s+/g, ' ').slice(0, 70))
check('文件夹名字带空格：照样浮出"图片打不开"的提示条', spaceImport.bar && spaceImport.repairBtn)

const [dirChooser2] = await Promise.all([
  page.waitForEvent('filechooser', { timeout: 10000 }),
  page.locator('.zh-pill[title="修复图片：选导出文件夹"]').click(),
])
await dirChooser2.setFiles(ROOT2)
await page.waitForTimeout(3500)
const spaceFixed = await page.evaluate(() => {
  const imgs = [...document.querySelectorAll('.ProseMirror img')].filter(
    (i) => !String(i.className).includes('separator'),
  )
  return {
    imgs: imgs.length,
    broken: imgs.filter((i) => !i.complete || i.naturalWidth === 0).length,
    dataSrc: imgs.filter((i) => (i.getAttribute('src') || '').startsWith('data:image/')).length,
  }
})
check(
  '文件夹名字带空格：选文件夹后两张（含动图）全部内嵌显示',
  spaceFixed.imgs === 2 && spaceFixed.broken === 0 && spaceFixed.dataSrc === 2,
  `裂 ${spaceFixed.broken}/${spaceFixed.imgs}，内嵌 ${spaceFixed.dataSrc}`,
)

check('场景二全程无页面错误', errors.length === 0, errors.slice(0, 2).join(' | '))

await browser.close()
for (const r of results) if (!r.ok) console.log(`\n待修：${r.name}`)
const failed = results.filter((r) => !r.ok).length
console.log(`\n${results.length - failed}/${results.length} 通过`)
/* 自检：实际断言数必须等于对外声明的 TEST_COUNT（文档数量占位符读它） */
if (results.length !== TEST_COUNT) {
  console.log(`\n❌ 断言总数与 TEST_COUNT 不符：实际 ${results.length}，声明 ${TEST_COUNT}`)
  console.log('   改测试条数时请一并更新文件顶部的 TEST_COUNT')
  process.exit(1)
}

process.exit(failed ? 1 : 0)
