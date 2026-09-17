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

await browser.close()
for (const r of results) if (!r.ok) console.log(`\n待修：${r.name}`)
const failed = results.filter((r) => !r.ok).length
console.log(`\n${results.length - failed}/${results.length} 通过`)
process.exit(failed ? 1 : 0)
