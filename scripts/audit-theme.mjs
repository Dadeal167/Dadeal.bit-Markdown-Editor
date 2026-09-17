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

/* 4. 公式在深色下可见（KaTeX 用 currentColor）
   ⚠️ 这个套件跑在**共享的 dev server** 上，前一个套件可能已经把文档换成没有公式的内容了。
   以前这里直接 querySelector，取不到就记 null 报失败 —— 是**测试自身的脆弱**，不是主题坏了。
   所以先确保文档里真有公式（没有就塞一个），再量颜色。 */
await page.evaluate(() => {
  const prose = document.querySelector('.zh-prose')
  if (prose && !prose.querySelector('.math-node')) {
    window.__EDITOR__?.commands.setContent('<p>主题检查用的公式 $\\frac{1+k}{1-k}$</p>')
  }
})
await page
  .waitForSelector('.math-node .katex', { timeout: 10000 })
  .catch(() => {})
const mathColor = await page.evaluate(() => {
  const el = document.querySelector('.math-node .katex')
  return el ? getComputedStyle(el).color : null
})
record(
  '公式在深色下用浅色字',
  mathColor === 'rgb(230, 232, 234)',
  mathColor ?? '**页面上没有公式**（连补都没补上）',
)

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

/* 7b. 菜单里的"当前项"必须跟着主题走（用户报过：选了深色，✓ 还在"跟随系统"上） */
const markedItem = async (p) => {
  await p.keyboard.press('Escape')
  await p.waitForTimeout(120)
  await p.locator('.zh-btn[title^="主题"]').click()
  await p.waitForTimeout(250)
  // 选中项里有 ✓，读的时候去掉再比
  const marked = await p.$$eval('.zh-menu .zh-menu__item--on', (els) =>
    els.map((e) => e.textContent.replace('✓', '').trim()),
  )
  await p.keyboard.press('Escape')
  await p.waitForTimeout(150)
  return marked
}
/** 切主题并确认真的生效（菜单开着时点按钮会把它收起来，所以先按 Esc） */
const setTheme = async (label, expect) => {
  for (let i = 0; i < 3; i += 1) {
    await page.keyboard.press('Escape')
    await page.waitForTimeout(120)
    await pickTheme(label)
    const now = await page.evaluate(() => document.documentElement.dataset.theme)
    if (now === expect) return now
  }
  return page.evaluate(() => document.documentElement.dataset.theme)
}
await setTheme('深色', 'dark')
const markedDark = await markedItem(page)
record('选了深色后，菜单里勾在「深色」上', markedDark.length === 1 && markedDark[0] === '深色', markedDark.join(',') || '没勾')
await setTheme('浅色', 'light')
const markedLight = await markedItem(page)
record('选了浅色后，菜单里勾在「浅色」上', markedLight.length === 1 && markedLight[0] === '浅色', markedLight.join(',') || '没勾')
await setTheme('跟随系统', 'light')
const markedSystem = await markedItem(page)
record('选了跟随系统后，菜单里勾在「跟随系统」上', markedSystem.length === 1 && markedSystem[0] === '跟随系统', markedSystem.join(',') || '没勾')

/* 7c. 深色下"暗淡的行内文字"要自动变浅（用户报过：黑字在深底上看不见）
   注意测量姿势：真正把字画出来的是**最内层**那个 span —— 深色修补是一层 decoration
   （`<span style="color:#000"><span class="zh-dim-color">字</span></span>`），
   所以要比的是最内层的计算色，而不是外层作者那份行内色。 */
{
  const DIM = 'rgb(230, 232, 234)' // --zh-text 的深色取值
  const BLACK = 'rgb(0, 0, 0)'
  await page.evaluate(() => {
    const ed = window.__EDITOR__
    ed.chain().focus('end').insertContent({ type: 'paragraph' }).run()
    ed.chain()
      .insertContent('<span style="color: #000000">纯黑字</span><span style="color: #1a1a1a">近黑字</span>')
      .run()
  })
  await page.waitForTimeout(500)
  /** 取"实际画出来的颜色"：包含这段文字的最内层 span */
  const paintedColor = (text) =>
    page.evaluate((t) => {
      const hit = [...document.querySelectorAll('.zh-prose span')].filter((s) => s.textContent.trim() === t)
      const painted = hit.filter((s) => ![...s.children].some((c) => c.textContent.trim() === t)).pop()
      const outer = hit.find((s) => s.getAttribute('style'))
      return {
        painted: painted ? getComputedStyle(painted).color : null,
        paintedClass: painted?.className ?? '',
        authored: outer ? getComputedStyle(outer).color : null,
        decorations: document.querySelectorAll('.zh-prose .zh-dim-color').length,
      }
    }, text)

  const now = await setTheme('深色', 'dark')
  await page.waitForTimeout(400)
  const d0 = await paintedColor('纯黑字')
  const d1 = await paintedColor('近黑字')
  record(
    '深色下纯黑行内字自动变浅（能看清）',
    d0.painted === DIM && d1.painted === DIM,
    `[${now}] 纯黑=${d0.painted} 近黑=${d1.painted}`,
  )
  record(
    '只是显示变浅，作者选的颜色还留在文档里',
    d0.authored === BLACK && d0.decorations >= 2,
    `作者色=${d0.authored} 修补层=${d0.decorations} 类名=${d0.paintedClass}`,
  )
  record('修补层不进文档（导出 HTML 里没有）', !(await page.evaluate(() => window.__EDITOR__.getHTML())).includes('zh-dim-color'))

  await setTheme('浅色', 'light')
  await page.waitForTimeout(400)
  const l0 = await paintedColor('纯黑字')
  record(
    '切回浅色：黑字原样回来、修补层撤掉',
    l0.painted === BLACK && l0.decorations === 0,
    `纯黑=${l0.painted} 修补层=${l0.decorations}`,
  )
}

/* 8. 跟随系统：模拟系统深色 */
await context.close()
const ctx2 = await browser.newContext({ viewport: { width: 1360, height: 900 }, colorScheme: 'light' })
const page2 = await ctx2.newPage()
await page2.goto(BASE, { waitUntil: 'load', timeout: 60000 })
await page2.waitForSelector('.ProseMirror', { timeout: 30000 })
await page2.waitForTimeout(1200)

/* 8a. 界面上什么都不点，直接把"系统"切成深色 —— 修过的坑：
   以前 decoration 只在 React 的 theme 变化时才重算，"跟随系统"时系统变了没人推，
   深色下太暗的文字还是黑的，直到用户下一次编辑才恢复。 */
{
  const DIM = 'rgb(230, 232, 234)'
  // 确保是"跟随系统"
  await page2.keyboard.press('Escape')
  await page2.locator('.zh-btn[title^="主题"]').click()
  await page2.waitForTimeout(200)
  await page2.locator('.zh-menu__item', { hasText: '跟随系统' }).click()
  await page2.waitForTimeout(400)
  await page2.evaluate(() => {
    const ed = window.__EDITOR__
    ed.chain().focus('end').insertContent({ type: 'paragraph' }).run()
    ed.chain().insertContent('<span style="color: #000000">系统切色测试</span>').run()
  })
  await page2.waitForTimeout(500)
  const before = await page2.evaluate(() => document.documentElement.dataset.theme)
  record('系统是浅色时用浅色', before === 'light', before)

  await page2.emulateMedia({ colorScheme: 'dark' })
  await page2.waitForTimeout(600)
  const after = await page2.evaluate(() => {
    const hit = [...document.querySelectorAll('.zh-prose span')].filter((s) => s.textContent.trim() === '系统切色测试')
    const painted = hit.filter((s) => ![...s.children].some((c) => c.textContent.trim() === '系统切色测试')).pop()
    return { theme: document.documentElement.dataset.theme, painted: painted ? getComputedStyle(painted).color : null }
  })
  record('系统切深色后自动变深色', after.theme === 'dark', after.theme)
  record('系统切深色后，太暗的文字立刻变浅（不用等下一次编辑）', after.painted === DIM, `颜色=${after.painted}`)
  await page2.emulateMedia({ colorScheme: 'light' })
  await page2.waitForTimeout(300)
}
record('全程控制台无错误', errors.length === 0, errors.length ? errors.slice(0, 3).join(' | ').slice(0, 200) : '无')

await browser.close()
for (const r of results) if (!r.ok) console.log(`\n待修：${r.name} — ${r.detail}`)
const failed = results.filter((r) => !r.ok).length
console.log(`\n${results.length - failed}/${results.length} 通过`)
process.exit(failed ? 1 : 0)
