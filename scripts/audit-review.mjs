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

/* ①-b 已有公式改排版：行内（紧凑）⇄ 行间（独占一行）
 *
 * 为什么单加这一组：用户 2026-09-26 问"公式怎么单独占一行"，查出来的是——
 * 弹窗里那个「行内 / 行间」按钮在**编辑已有公式**时是摆设（updateMathAt 只改 latex，
 * 类型传 undefined = 保持原类型），实测"点开行内公式 → 切行间 → 确认"文档里一点没变，
 * 只能删掉重插。现在两条路都通了，这里把边界钉住。
 *
 * 各场景都读**文档模型**（不是 DOM 文本）：光看界面看不出节点类型对不对。 */
const mathBlocks = () =>
  page.evaluate(() => {
    const out = []
    window.__EDITOR__.state.doc.forEach((n) => {
      if (n.type.name === 'paragraph') {
        const parts = []
        n.forEach((c) => {
          if (c.isText) parts.push(JSON.stringify(c.text))
          else if (c.type.name === 'mathInline') parts.push(`in[${c.attrs.latex}]`)
          else parts.push(c.type.name)
        })
        out.push(`p(${parts.join('+') || '空'})`)
      } else out.push(n.type.name)
    })
    return out
  })
const setMd = async (md) => {
  await page.evaluate((m) => window.__SET_MARKDOWN__(window.__EDITOR__, m), md)
  await page.waitForTimeout(700)
}
const openMathAt = async (i = 0) => {
  await page.evaluate((k) => document.querySelectorAll('.math-node')[k].click(), i)
  await page.waitForSelector('.zh-mathmode__btn', { timeout: 6000 })
  await page.waitForTimeout(250)
}
const confirmMode = async (label) => {
  await page.locator('.zh-mathmode__btn', { hasText: label }).click()
  await page.waitForTimeout(150)
  await page.locator('.zh-btn-confirm').click()
  await page.waitForTimeout(600)
}

/* 句中行内 → 行间：变成块级、前后文字一个字都不丢 */
await setMd('前面 $x+1$ 后面\n')
await openMathAt(0)
await confirmMode('行间')
const a1 = await mathBlocks()
check(
  '句中行内公式切「行间」→ 真的变成块级公式（前面那版这里是摆设）',
  a1.join(' | ') === 'p("前面 ") | mathBlock | p(" 后面")',
  a1.join(' | '),
)
const a1md = await page.evaluate(() => window.__MD__())
check(
  '切「行间」后导出是 $$…$$，latex 一字不差',
  a1md.includes('$$\nx+1\n$$') && a1md.includes('前面') && a1md.includes('后面'),
  JSON.stringify(a1md),
)

/* 整段只有一个公式 → 行间：不许留下空段落（实测老的 Fitter 路径会切出一个空段落） */
await setMd('$\\frac{a}{b}$\n')
await openMathAt(0)
await confirmMode('行间')
const b1 = await mathBlocks()
check('整段只有一个公式时切「行间」→ 不留空段落', b1[0] === 'mathBlock', b1.join(' | '))
const b1md = await page.evaluate(() => window.__MD__())
check('这一档导出正确（只有一个块级公式）', /^\$\$\n\\frac\{a\}\{b\}\n\$\$/.test(b1md.trim()), JSON.stringify(b1md))

/* 行间 → 行内：并回上一段（"把公式收回正文里"） */
await setMd('这是一段文字。\n\n$$E=mc^2$$\n')
await openMathAt(0)
await confirmMode('行内')
const c1 = await mathBlocks()
check(
  '行间公式切回「行内」→ 变回行内节点并并回上一段文字',
  c1[0] === 'p("这是一段文字。"+in[E=mc^2])',
  c1.join(' | '),
)
const c1md = await page.evaluate(() => window.__MD__())
check('切回「行内」后导出是 $…$（紧凑形态）', c1md.includes('这是一段文字。$E=mc^2$'), JSON.stringify(c1md))

/* 上一段是标题 → 不并进标题，自己起一段 */
await setMd('# 标题\n\n$$a^2+b^2=c^2$$\n')
await openMathAt(0)
await confirmMode('行内')
const d1 = await mathBlocks()
check(
  '上一段是标题时切回「行内」→ 自己起一段（不把公式塞进标题里）',
  d1[0] === 'heading' && d1[1] === 'p(in[a^2+b^2=c^2])',
  d1.join(' | '),
)

/* latex 原样：带反斜杠 / 花括号的公式来回切两次，内容不许被改一个字节 */
await setMd('设 $\\frac{n(n+1)}{2}$ 为和。\n')
const beforeLatex = await page.evaluate(() => window.__EDITOR__.state.doc.textBetween(0, window.__EDITOR__.state.doc.content.size))
await openMathAt(0)
await confirmMode('行间')
await openMathAt(0)
await confirmMode('行内')
const kept = await page.evaluate(() => {
  const out = []
  window.__EDITOR__.state.doc.descendants((n) => {
    if (n.type.name === 'mathInline' || n.type.name === 'mathBlock') out.push(n.attrs.latex)
    return true
  })
  return out
})
check(
  '来回切两次：latex 一个字节都没变（\\frac / 花括号不许被转义动过）',
  kept.length === 1 && kept[0] === '\\frac{n(n+1)}{2}',
  JSON.stringify(kept),
)

/* 切完光标不能在公式上：接着打字要能打进去，公式还在 */
await setMd('$x^2$\n')
await openMathAt(0)
await confirmMode('行间')
await page.evaluate(() => window.__EDITOR__.commands.focus('end'))
await page.keyboard.type('切完接着打字')
await page.waitForTimeout(400)
const f1 = await mathBlocks()
const f1md = await page.evaluate(() => window.__MD__())
check(
  '切完接着打字：字进得去、公式没被顶掉',
  f1.includes('mathBlock') && f1md.includes('切完接着打字') && f1md.includes('$$\nx^2\n$$'),
  `${f1.join(' | ')} ／ ${JSON.stringify(f1md)}`,
)

/* 位置失效时**不许改坏别的节点**：给一个指向普通文字的 pos，命令必须拒绝 */
const guard = await page.evaluate(() => {
  const ed = window.__EDITOR__
  const before = ed.state.doc.textBetween(0, ed.state.doc.content.size, '\n')
  const ok = ed.commands.updateMathAt(1, 'ZZZ', true)
  const after = ed.state.doc.textBetween(0, ed.state.doc.content.size, '\n')
  const types = []
  ed.state.doc.descendants((n) => {
    if (n.type.name === 'mathInline' || n.type.name === 'mathBlock') types.push(`${n.type.name}:${n.attrs.latex}`)
    return true
  })
  return { ok, same: before === after, types, text: after }
})
check(
  '位置失效（那个位置上不是公式）时命令拒绝执行、文档一个字节不动',
  guard.ok === false && guard.same && guard.types.length === 1 && guard.types[0] === 'mathBlock:x^2',
  JSON.stringify(guard),
)

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
