/**
 * 符号表渲染校验：打开公式弹窗的每个分类面板，逐个检查符号按钮
 * - KaTeX 是否渲染成功（.katex-error 表示失败）
 * - 图形是否可见（宽高不能太小）
 * 前提：pnpm dev 已运行
 */
import { chromium } from 'playwright-core'

const browser = await chromium.launch({ channel: 'msedge', headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
const errors = []
page.on('pageerror', (e) => errors.push(String(e.message)))
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text())
})

await page.goto('http://127.0.0.1:5173/', { waitUntil: 'load', timeout: 60000 })
await page.waitForSelector('.ProseMirror', { timeout: 30000 })
await page.waitForTimeout(1500)
await page.locator('.zh-btn[title="公式"]').click()
await page.waitForSelector('.zh-modal--math', { timeout: 5000 })
await page.waitForTimeout(500)

const categories = await page.locator('.zh-mathcat').allInnerTexts()
let total = 0
const broken = []
const invisible = []
const silentErrors = []

for (const raw of categories) {
  const name = raw.replace(/▾/g, '').trim()
  await page.locator('.zh-mathcat', { hasText: name }).first().click()
  await page.waitForTimeout(400)
  const rows = await page.evaluate(() => {
    return [...document.querySelectorAll('.zh-mathpanel .zh-symbol')].map((b) => {
      const r = b.getBoundingClientRect()
      const err = b.querySelector('.katex-error')
      return {
        title: b.getAttribute('title') ?? '',
        latex: b.getAttribute('data-latex') ?? '',
        text: (b.textContent ?? '').trim(),
        w: Math.round(r.width),
        h: Math.round(r.height),
        hasKatex: !!b.querySelector('.katex'),
        error: err ? err.textContent?.slice(0, 40) ?? '渲染失败' : null,
      }
    })
  })
  const secTitles = await page.locator('.zh-mathsec__title').allInnerTexts()
  total += rows.length
  const bad = rows.filter((r) => r.error)
  const small = rows.filter((r) => !r.error && (!r.hasKatex || r.w < 8 || r.h < 8))
  // 静默错误：KaTeX 对不认识的命令可能既不报错、也不显示图形，而是把命令名当字母排出来
  // （\permil 就是这样渲染成 "permil" 的）。判据：单个裸命令渲染出来的文字不能等于命令名本身。
  const silent = []
  for (const r of rows) {
    const latex = r.latex
    if (!/^\\[a-zA-Z]+$/.test(latex)) continue
    const name = latex.slice(1).toLowerCase()
    const shown = (r.text ?? '').replace(/\s+/g, '').toLowerCase()
    if (shown === name) silent.push(`${name}｜${r.title}｜渲染成了字母 "${shown}"`)
  }
  broken.push(...bad.map((b) => `${name}｜${b.title}｜${b.error}`))
  invisible.push(...small.map((s) => `${name}｜${s.title}｜${s.w}×${s.h}`))
  silentErrors.push(...silent)
  console.log(
    `${name}: ${rows.length} 个符号，${secTitles.length} 组` +
      (bad.length ? `，❌ 渲染失败 ${bad.length}` : '') +
      (small.length ? `，⚠️ 图形过小 ${small.length}` : '') +
      (silent.length ? `，❌ 静默错误 ${silent.length}` : ''),
  )
  // 收起面板
  await page.locator('.zh-mathpanel__close').click()
  await page.waitForTimeout(200)
}

console.log(`\n合计 ${total} 个符号`)
if (broken.length) {
  console.log(`\n❌ KaTeX 渲染失败 ${broken.length} 个：`)
  broken.forEach((b) => console.log('  ' + b))
}
if (invisible.length) {
  console.log(`\n⚠️ 图形过小 ${invisible.length} 个：`)
  invisible.forEach((b) => console.log('  ' + b))
}
if (silentErrors.length) {
  console.log(`\n❌ 静默错误（命令名被当成字母排出来）${silentErrors.length} 个：`)
  silentErrors.forEach((b) => console.log('  ' + b))
}
if (errors.length) {
  console.log(`\n控制台错误 ${errors.length} 条：`)
  errors.slice(0, 5).forEach((e) => console.log('  ' + e.slice(0, 120)))
}
console.log(
  broken.length === 0 && invisible.length === 0 && silentErrors.length === 0 && errors.length === 0
    ? '\n✅ 全部符号渲染正常'
    : '\n需要修复上面列出的项',
)
await browser.close()
process.exit(broken.length + invisible.length + silentErrors.length > 0 ? 1 : 0)
