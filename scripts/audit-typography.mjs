/**
 * 正文排版体检：字号 / 字体（整篇）＋ 文字颜色（选中内容）＋ 与公式互不干扰
 * 前提：pnpm dev 已运行
 */
import { chromium } from 'playwright-core'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { tmpdir } from 'node:os'

const OUT = resolve('.probe')
mkdirSync(OUT, { recursive: true })
const BASE = 'http://127.0.0.1:5173/'
const TYPO_KEY = 'md-editor-typography-v1'
const DOCS_KEY = 'md-editor-docs-v1'

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
  await page.waitForTimeout(1300)
}
const md = () => page.evaluate(() => window.__MD__?.() ?? '')
const docFontSize = () =>
  page.evaluate(() => getComputedStyle(document.querySelector('.zh-prose')).fontSize)
const docFontFamily = () =>
  page.evaluate(() => getComputedStyle(document.querySelector('.zh-prose')).fontFamily)
const openPanel = async () => {
  if (await page.locator('.zh-typomenu').isVisible().catch(() => false)) return
  await page.locator('.zh-btn[title="正文字号 / 字体 / 文字颜色"]').click()
  await page.waitForSelector('.zh-typomenu', { timeout: 4000 })
}
const closePanel = async () => {
  await page.keyboard.press('Escape')
  await page.waitForTimeout(250)
}
/** 在编辑器里选中第一段文字的前若干字符 */
const selectText = (len = 4) =>
  page.evaluate((n) => {
    const ed = window.__EDITOR__
    let from = null
    ed.state.doc.descendants((node, pos) => {
      if (from === null && node.isTextblock && node.textContent.trim().length >= n) {
        from = pos + 1
        return false
      }
      return true
    })
    ed.chain().setTextSelection({ from, to: from + n }).run()
  }, len)

await page.goto(BASE, { waitUntil: 'load', timeout: 60000 })
await ready()
await page.evaluate(
  ([t, d]) => {
    localStorage.removeItem(t)
    localStorage.removeItem(d)
  },
  [TYPO_KEY, DOCS_KEY],
)
await page.reload({ waitUntil: 'load' })
await ready()

/* ---------- 1. 面板存在且三段齐全 ---------- */
await openPanel()
const sections = await page.locator('.zh-typomenu__section').allInnerTexts()
record(
  '字体面板有「字号 / 字体 / 颜色 / 我的字体」四段',
  sections.length === 4 &&
    sections[0].includes('字号') &&
    sections[1].includes('正文字体') &&
    sections[2].includes('颜色') &&
    sections[3].includes('我的字体'),
  sections.map((s) => s.replace(/\n/g, ' ').slice(0, 12)).join(' | '),
)
record('默认正文字号 16px', (await docFontSize()) === '16px', await docFontSize())

/* ---------- 2. 改字号（整篇） ---------- */
await page.locator('.zh-typomenu__chip', { hasText: '大' }).first().click()
await page.waitForTimeout(300)
record('选「大」后正文变 18px', (await docFontSize()) === '18px', await docFontSize())
const h1Size = await page.evaluate(
  () => getComputedStyle(document.querySelector('.zh-prose h1')).fontSize,
)
record('标题跟着一起缩放（1.5em → 27px）', h1Size === '27px', h1Size)

/* ---------- 3. 改字体（整篇） ---------- */
await page.locator('.zh-typomenu__item', { hasText: '楷体' }).click()
await page.waitForTimeout(300)
const family = await docFontFamily()
record('选「楷体」后正文用楷体', /KaiTi|Kaiti/i.test(family), family.slice(0, 40))

/* ---------- 4. 公式不受正文字体影响 ---------- */
/* 显式等公式渲染出来再量。
   以前这里是"固定等 1.3 秒"，在全量套件里（dev server 刚起、编辑器初始化更慢）
   会偶发量到"还没渲染完"的瞬间 → 报"没找到公式"的假失败（实测过一次）。 */
const gotFormula = await page
  .waitForSelector('.math-node .katex', { timeout: 15000 })
  .then(() => true)
  .catch(() => false)
record('默认文档里的公式渲染出来了（后面那条断言的前提）', gotFormula)
const katexFamily = await page.evaluate(() => {
  const el = document.querySelector('.math-node .katex')
  return el ? getComputedStyle(el).fontFamily : null
})
record(
  '公式字体不被正文字体影响',
  !!katexFamily && !/KaiTi|Kaiti/i.test(katexFamily),
  (katexFamily ?? '没找到公式').slice(0, 46),
)

/* ---------- 5. 刷新后设置还在 ---------- */
const stored = await page.evaluate((k) => localStorage.getItem(k), TYPO_KEY)
record('设置写入 localStorage', !!stored && stored.includes('18') && /KaiTi/i.test(stored), stored ?? '')
await page.reload({ waitUntil: 'load' })
await ready()
record(
  '刷新后字号字体仍生效',
  (await docFontSize()) === '18px' && /KaiTi|Kaiti/i.test(await docFontFamily()),
  `${await docFontSize()} / ${(await docFontFamily()).slice(0, 24)}`,
)

/* ---------- 6. 文字颜色（选中内容） ---------- */
await openPanel()
await page.evaluate(() => window.__EDITOR__.commands.focus('start'))
await selectText(4)
await page.waitForTimeout(300)
const hint = await page.locator('.zh-typomenu__hint').innerText()
record('选中后提示可上色', hint.includes('已选中'), hint)
await page.locator('.zh-typomenu__swatch[title="红色"]').click()
await page.waitForTimeout(400)
const mdWithColor = await md()
record(
  '红色写进 Markdown（行内 HTML）',
  /<span style="color:#d93025">/.test(mdWithColor),
  mdWithColor.split('\n').find((l) => l.includes('<span'))?.slice(0, 40) ?? '没找到',
)
const domColor = await page.evaluate(() => {
  const span = document.querySelector('.ProseMirror span[style*="color"]')
  return span ? { color: getComputedStyle(span).color, text: span.textContent } : null
})
record('页面上确实变色了', !!domColor && domColor.color === 'rgb(217, 48, 37)', JSON.stringify(domColor))

/* ---------- 7. 颜色能存进 .md 再读回来 ---------- */
const [dl] = await Promise.all([
  page.waitForEvent('download', { timeout: 8000 }),
  page
    .locator('.zh-btn[title="保存"]')
    .click()
    .then(() => page.locator('.zh-menu__item[data-format="plain"]').click()),
])
const savedPath = await dl.path()
const savedText = savedPath ? readFileSync(savedPath, 'utf-8') : ''
const roundTripFile = resolve(tmpdir(), 'color-roundtrip.md')
writeFileSync(roundTripFile, savedText, 'utf-8')
const [chooser] = await Promise.all([
  page.waitForEvent('filechooser', { timeout: 6000 }),
  page.locator('.zh-btn[title="打开"]').click(),
])
await chooser.setFiles(roundTripFile)
await page.waitForTimeout(1400)
const reopened = await page.evaluate(() => {
  const span = document.querySelector('.ProseMirror span[style*="color"]')
  return span ? { color: getComputedStyle(span).color, text: span.textContent } : null
})
record(
  '颜色往返 .md 后仍在',
  !!reopened && reopened.color === 'rgb(217, 48, 37)',
  JSON.stringify(reopened),
)

/* ---------- 8. 清除颜色 ---------- */
await page.evaluate(() => window.__EDITOR__.commands.focus('start'))
await selectText(4)
await page.waitForTimeout(250)
await openPanel()
await page.locator('.zh-typomenu__clear').click()
await page.waitForTimeout(400)
const afterClear = await md()
record('清除颜色后 Markdown 里没有 span', !afterClear.includes('<span style="color'), afterClear.slice(0, 30))

/* ---------- 9. 公式不接受文字颜色 mark ---------- */
const marksAllowed = await page.evaluate(() => ({
  inline: window.__EDITOR__.schema.nodes.mathInline.spec.marks,
  block: window.__EDITOR__.schema.nodes.mathBlock.spec.marks,
}))
record(
  '公式节点声明不接受 mark（两边不重叠）',
  marksAllowed.inline === '' && marksAllowed.block === '',
  JSON.stringify(marksAllowed),
)

/* ---------- 10. 导出 HTML 带上排版 ---------- */
await closePanel()
const [htmlDl] = await Promise.all([
  page.waitForEvent('download', { timeout: 8000 }),
  page
    .locator('.zh-btn[title="保存"]')
    .click()
    .then(() => page.locator('.zh-menu__item[data-format="html"]').click()),
])
const htmlPath = await htmlDl.path()
const htmlText = htmlPath ? readFileSync(htmlPath, 'utf-8') : ''
record(
  '导出的 HTML 沿用所选字号/字体',
  htmlText.includes('18px') && /KaiTi/i.test(htmlText),
  htmlText.match(/font:[^;]+/)?.[0]?.slice(0, 50) ?? '没找到 font 声明',
)

await page.screenshot({ path: resolve(OUT, 'typography-menu.png') })
record('全程控制台无错误', errors.length === 0, errors.length ? errors.slice(0, 3).join(' | ').slice(0, 240) : '无')

await browser.close()
for (const r of results) if (!r.ok) console.log(`\n待修：${r.name} — ${r.detail}`)
const failed = results.filter((r) => !r.ok).length
console.log(`\n${results.length - failed}/${results.length} 通过`)
process.exit(failed ? 1 : 0)
