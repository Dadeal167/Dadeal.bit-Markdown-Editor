import { chromium } from 'playwright-core'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { tmpdir } from 'node:os'

const browser = await chromium.launch({ channel: 'msedge', headless: true })
const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, acceptDownloads: true })
const errors = []
page.on('pageerror', (e) => errors.push(String(e.message)))
await page.goto('http://127.0.0.1:5173/', { waitUntil: 'load', timeout: 60000 })
await page.waitForSelector('.ProseMirror', { timeout: 30000 })
await page.waitForTimeout(1300)

const run = []
const check = (name, ok, detail = '') => {
  run.push({ name, ok })
  console.log(`${ok ? '✅' : '❌'}  ${name}${detail ? '  — ' + detail : ''}`)
}

/** 走真实路径：保存成文件 → 再打开 */
const saveAndReopen = async () => {
  const [dl] = await Promise.all([
    page.waitForEvent('download', { timeout: 8000 }),
    page
    .locator('.zh-btn[title="保存"]')
    .click()
    .then(() => page.locator('.zh-menu__item[data-format="plain"]').click()),
  ])
  const p = await dl.path()
  const text = p ? readFileSync(p, 'utf-8') : ''
  const f = resolve(tmpdir(), `verify-${Date.now()}.md`)
  writeFileSync(f, text, 'utf-8')
  const [ch] = await Promise.all([
    page.waitForEvent('filechooser', { timeout: 6000 }),
    page.locator('.zh-btn[title="打开"]').click(),
  ])
  await ch.setFiles(f)
  await page.waitForTimeout(1000)
  return text
}

/* ① 行间公式：应该存成 $$…$$ 并成为块级节点 */
await page.evaluate(() => window.__EDITOR__.commands.clearContent())
await page.waitForTimeout(300)
await page.locator('.zh-btn[title="公式"]').click()
await page.waitForSelector('.zh-modal--math', { timeout: 4000 })
await page.locator('.zh-mathsource').fill('x^2+y^2=1')
await page.getByRole('button', { name: '行间', exact: true }).click()
await page.waitForTimeout(200)
await page.getByRole('button', { name: '确认', exact: true }).click()
await page.waitForTimeout(600)
const blockHtml = await page.evaluate(() => document.querySelector('.ProseMirror').innerHTML)
const savedBlock = await saveAndReopen()
check(
  '「行间」插入的是块级公式',
  blockHtml.includes('node-mathBlock'),
  blockHtml.slice(0, 60),
)
check('存盘是 $$…$$', /\$\$[\s\S]*x\^2\+y\^2=1[\s\S]*\$\$/.test(savedBlock), JSON.stringify(savedBlock.trim()))
const afterBlock = await page.evaluate(() => document.querySelectorAll('.math-node').length)
check('块级公式能读回', afterBlock === 1, `${afterBlock} 个公式节点`)

/* ② 正文里两个字面 $（写价格）：不能被当成公式 */
await page.evaluate(() => window.__EDITOR__.commands.clearContent())
await page.waitForTimeout(300)
await page.evaluate(() => window.__EDITOR__.commands.focus('end'))
await page.keyboard.type('原价 $100，现价 $60')
await page.waitForTimeout(400)
const textMd = await saveAndReopen()
const domText = await page.evaluate(() => document.querySelector('.ProseMirror').textContent)
const mathNodes = await page.evaluate(() => document.querySelectorAll('.math-node').length)
check('两个字面 $ 不会被当成公式', mathNodes === 0 && domText === '原价 $100，现价 $60', `DOM="${domText}" 公式=${mathNodes}`)
check('存盘时字面 $ 被转义', textMd.includes('\\$100'), JSON.stringify(textMd.trim()))

/* ③ 正文里手打的 $…$ 保持纯文本（不自动变公式），往返后依然一致
      —— 这是刻意设计：否则"原价 $100，现价 $60"会被吞成公式；要插公式请点「公式」按钮 */
await page.evaluate(() => window.__EDITOR__.commands.clearContent())
await page.waitForTimeout(300)
await page.evaluate(() => window.__EDITOR__.commands.focus('end'))
await page.keyboard.type('当 $x>0$ 时价格是 $5')
await page.waitForTimeout(400)
await saveAndReopen()
const mixed = await page.evaluate(() => ({
  text: document.querySelector('.ProseMirror').textContent,
  math: document.querySelectorAll('.math-node').length,
}))
check(
  '手打的 $…$ 保持纯文本且往返不丢',
  mixed.math === 0 && mixed.text === '当 $x>0$ 时价格是 $5',
  JSON.stringify(mixed),
)

/* ④ 表格弹窗打开时打字不会跑进正文 */
await page.evaluate(() => window.__EDITOR__.commands.clearContent())
await page.waitForTimeout(300)
await page.evaluate(() => window.__EDITOR__.commands.focus('end'))
await page.locator('.zh-btn[title="表格"]').click()
await page.waitForSelector('.zh-modal--table', { timeout: 4000 })
await page.waitForTimeout(400)
await page.keyboard.type('3')
await page.waitForTimeout(300)
const tableState = await page.evaluate(() => ({
  rowInput: document.querySelector('.zh-modal--table input[aria-label="输入表格行数"]')?.value,
  doc: document.querySelector('.ProseMirror').textContent.trim(),
}))
check('表格弹窗抢到焦点（数字进输入框）', tableState.rowInput === '3' && tableState.doc === '', JSON.stringify(tableState))
await page.keyboard.press('Escape')
await page.waitForTimeout(300)

/* ⑤ loadStore 每个页面只执行一次（原来每次渲染都读写整个文档库） */
const storeReads = await page.evaluate(() => {
  let reads = 0
  const orig = Storage.prototype.getItem
  Storage.prototype.getItem = function (k) {
    if (k === 'md-editor-docs-v1') reads += 1
    return orig.call(this, k)
  }
  const input = document.querySelector('.zh-title')
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  for (let i = 0; i < 3; i += 1) {
    setter.call(input, 'x'.repeat(i + 1))
    input.dispatchEvent(new Event('input', { bubbles: true }))
  }
  Storage.prototype.removeItem.call(localStorage, '__none')
  Storage.prototype.getItem = orig
  return reads
})
check('打字时不再反复读整个文档库', storeReads === 0, `3 次输入触发 ${storeReads} 次读取`)

/* ⑥ 无障碍：弹窗有 dialog 语义 */
await page.locator('.zh-btn[title="表格"]').click()
await page.waitForSelector('.zh-modal--table', { timeout: 4000 })
const role = await page.evaluate(() => {
  const el = document.querySelector('.zh-modal--table')
  return { role: el.getAttribute('role'), modal: el.getAttribute('aria-modal') }
})
check('弹窗有 dialog / aria-modal', role.role === 'dialog' && role.modal === 'true', JSON.stringify(role))
await page.keyboard.press('Escape')

check('全程无页面错误', errors.length === 0, errors.slice(0, 2).join(' | '))
await browser.close()
const failed = run.filter((r) => !r.ok).length
console.log(`\n${run.length - failed}/${run.length} 通过`)
process.exit(failed ? 1 : 0)
