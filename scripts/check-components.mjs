/**
 * 组件逐个巡游：每一个界面表面（菜单 / 弹窗 / 面板）都必须"打得开、关得掉、不报错、不留渣"。
 *
 * 为什么要有它：功能测试管的是"这条链路对不对"，但**没人系统保证每个面板本身是干净的** ——
 * 少一个按钮、Esc 关不掉、关掉后蒙层留在页面上、点开时报一个 TypeError，
 * 这些都不会让别的测试变红，却能让用户直接卡住（真踩过：导出报错后按钮永久 disabled、
 * 公式补全按 Enter 抛 TypeError）。
 *
 * 每个表面都验这几条：
 *   1. 打得开（目标元素出现）且内容不是空的（菜单项数 / 面板里的控件数）
 *   2. 关得掉（Esc / 点面板外面 / 自己的关闭按钮），关掉后**元素消失、蒙层清零**
 *   3. 整个过程没有 console 报错 / 页面异常 / 未处理的 promise 拒绝
 * 另外还扫这些边角：
 *   · 空文档（新建的那篇）上把所有表面开一遍
 *   · 光标停在代码块里 / 表格里时开菜单
 *   · 同一个按钮连点三下（开-关-开）不会同时冒出两个面板
 *   · 深色主题下整套再来一遍
 *   · 收尾：Esc 之后还能接着打字（焦点没被面板吃掉）
 *
 * 前提：pnpm dev 已运行（端口 5173）。
 */
import { chromium } from 'playwright-core'

const BASE = 'http://127.0.0.1:5173/'
const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`${ok ? '✅' : '❌'}  ${name}${detail ? '  — ' + detail : ''}`)
}

const browser = await chromium.launch({ channel: 'msedge', headless: true })
const context = await browser.newContext({ viewport: { width: 1360, height: 900 }, acceptDownloads: true })
const page = await context.newPage()

/** 三类"报错"都收：控制台 error、页面异常、未处理的 promise 拒绝 */
const errors = []
page.on('console', (m) => {
  if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 160))
})
page.on('pageerror', (e) => errors.push('pageerror: ' + String(e).slice(0, 160)))
await page.addInitScript(() => {
  window.addEventListener('unhandledrejection', (e) => {
    window.__REJECTIONS__ = window.__REJECTIONS__ ?? []
    window.__REJECTIONS__.push(String(e.reason).slice(0, 160))
  })
})
// 原生 alert/confirm 一律按掉，别让测试挂住
let lastDialog = ''
page.on('dialog', (d) => {
  lastDialog = d.message().slice(0, 80)
  void d.accept().catch(() => {})
})

/** 助手没开时浏览器会记一条 ERR_CONNECTION_REFUSED（预期噪音，不算组件错误） */
const IGNORE_ERROR = /ERR_CONNECTION_REFUSED|Failed to load resource|127\.0\.0\.1:5174|favicon/i
const realErrors = () => errors.filter((e) => !IGNORE_ERROR.test(e))

const ready = async () => {
  await page.waitForSelector('.ProseMirror', { timeout: 30000 })
  await page.waitForTimeout(900)
}
const maskCount = () => page.evaluate(() => document.querySelectorAll('.zh-modal-mask').length)
const openMenuCount = () => page.evaluate(() => document.querySelectorAll('.zh-menu').length)
const rejections = () => page.evaluate(() => window.__REJECTIONS__ ?? [])

/** 按标题前缀找工具栏按钮（标题里常带括号说明，比如「我的文档（共 1 篇）」） */
const toolbarBtn = (title) => page.locator(`.zh-toolbar .zh-btn[title^="${title}"]`)

/**
 * 每个界面表面的定义：
 *   open  —— 点哪个按钮；带 menu 的话表示还要再点「更多」里的那一项
 *   panel —— 打开后必须出现的元素
 *   items —— 面板里至少要有的"可点项"数量（0 = 不查条数，只查关键元素）
 *   close —— 'esc' 按 Esc；'outside' 点面板外面；'btn' 点它自己的关闭按钮
 */
const SURFACES = [
  { name: '文档下拉', open: { btn: '我的文档' }, panel: '.zh-docmenu', items: 1, close: 'outside' },
  { name: '保存/导出菜单', open: { btn: '保存' }, panel: '.zh-menu--save', items: 3, close: 'esc' },
  { name: '标题菜单', open: { btn: '标题' }, panel: '.zh-menu', items: 4, close: 'esc' },
  { name: '列表菜单', open: { btn: '列表' }, panel: '.zh-menu', items: 2, close: 'esc' },
  { name: '字体菜单', open: { btn: '正文字号' }, panel: '.zh-typomenu', items: 1, close: 'esc' },
  { name: '主题菜单', open: { btn: '主题' }, panel: '.zh-menu', items: 3, close: 'esc' },
  { name: '更多菜单', open: { btn: '更多' }, panel: '.zh-menu', items: 5, close: 'esc' },
  { name: '视频弹窗', open: { btn: '视频' }, panel: '.zh-modal-mask', items: 0, close: 'esc' },
  { name: '链接弹窗', open: { btn: '链接' }, panel: '.zh-link-form', items: 0, close: 'esc' },
  { name: '公式弹窗', open: { btn: '公式' }, panel: '.zh-modal--math', items: 1, close: 'esc' },
  { name: '表格弹窗', open: { btn: '表格' }, panel: '.zh-modal-mask', items: 0, close: 'esc' },
  { name: '知乎面板', open: { btn: '知乎' }, panel: '.zh-modal-mask', items: 0, close: 'esc' },
  { name: '大纲面板', open: { btn: '大纲' }, panel: '.zh-outline', items: 0, close: 'btn' },
  { name: '快捷键帮助', open: { btn: '更多', menu: '快捷键帮助' }, panel: '.zh-modal--help', items: 0, close: 'esc' },
  { name: '自定义快捷键', open: { btn: '更多', menu: '自定义快捷键' }, panel: '.zh-modal-mask', items: 0, close: 'esc' },
]

/** 清掉可能残留的弹层（上一步没关干净时，后面的点击会被蒙层挡住） */
const clearOverlays = async () => {
  for (let i = 0; i < 3; i += 1) {
    if ((await maskCount()) === 0 && (await openMenuCount()) === 0) return
    await page.keyboard.press('Escape')
    await page.waitForTimeout(200)
  }
  if ((await maskCount()) > 0) {
    const closeBtn = page.locator('.zh-modal__close, .zh-modal .zh-btn-plain').first()
    if ((await closeBtn.count()) > 0) await closeBtn.click({ timeout: 2000 }).catch(() => {})
    await page.mouse.click(20, 400)
    await page.waitForTimeout(200)
  }
}

const closeSurface = async (surface) => {
  if (surface.close === 'btn') {
    await page.locator('.zh-outline__close').click({ timeout: 4000 })
  } else if (surface.close === 'outside') {
    await page.mouse.click(680, 700)
  } else {
    await page.keyboard.press('Escape')
  }
  await page.waitForTimeout(300)
}

/** 打开 → 检查 → 关闭 → 检查没留渣。返回失败原因（null = 通过） */
const tour = async (surface) => {
  await clearOverlays()
  const btn = toolbarBtn(surface.open.btn)
  if ((await btn.count()) === 0) return `工具栏上没有「${surface.open.btn}」按钮`
  await btn.first().click({ timeout: 5000 })
  await page.waitForTimeout(250)
  if (surface.open.menu) {
    const item = page.locator('.zh-menu__item', { hasText: surface.open.menu })
    if ((await item.count()) === 0) return `「更多」里没有「${surface.open.menu}」`
    await item.first().click({ timeout: 5000 })
    await page.waitForTimeout(300)
  }
  const panel = page.locator(surface.panel).first()
  if ((await page.locator(surface.panel).count()) === 0) return `打开后没看到 ${surface.panel}`
  if (surface.items > 0) {
    const n = await page
      .locator(`${surface.panel} button, ${surface.panel} .zh-menu__item, ${surface.panel} .zh-docmenu__item`)
      .count()
    if (n < surface.items) return `${surface.panel} 里只有 ${n} 个可点项（期望 ≥ ${surface.items}）`
  }
  await closeSurface(surface)
  if (await panel.isVisible().catch(() => false)) return `关掉之后 ${surface.panel} 还在`
  if ((await maskCount()) > 0) return `关掉之后还留着 ${await maskCount()} 个蒙层`
  return null
}

await page.goto(BASE, { waitUntil: 'load', timeout: 60000 })
await ready()

/* ---------- 1. 逐个表面走一遍（每个表面单报一行，出问题一眼看出是哪个） ---------- */
for (const s of SURFACES) {
  const before = realErrors().length
  const reason = await tour(s)
  const fresh = realErrors().slice(before)
  check(`${s.name}：打得开 / 关得掉 / 不留蒙层`, reason === null && fresh.length === 0, reason ?? fresh.join(' | '))
}

/* ---------- 2. 菜单项逐项点一遍（只点安全的排版类菜单） ---------- */
{
  const before = realErrors().length
  let clicked = 0
  for (const btnTitle of ['标题', '列表', '主题']) {
    await toolbarBtn(btnTitle).first().click()
    await page.waitForTimeout(200)
    const labels = (await page.locator('.zh-menu__item').allInnerTexts()).map((t) => t.replace('✓', '').trim())
    await page.keyboard.press('Escape')
    await page.waitForTimeout(150)
    for (const label of labels) {
      await toolbarBtn(btnTitle).first().click()
      await page.waitForTimeout(180)
      const item = page.locator('.zh-menu__item', { hasText: label })
      if ((await item.count()) === 0) continue
      await item.first().click()
      await page.waitForTimeout(180)
      clicked += 1
      if ((await maskCount()) > 0) await page.keyboard.press('Escape')
    }
  }
  // 主题菜单点完可能停在深/浅色，后面的判定需要稳定的浅色，统一拉回来
  await page.keyboard.press('Escape')
  await page.locator('.zh-btn[title^="主题"]').click()
  await page.waitForTimeout(200)
  await page.locator('.zh-menu__item', { hasText: '跟随系统' }).click()
  await page.waitForTimeout(300)
  check(
    `标题 / 列表 / 主题菜单里的每一项都点过（${clicked} 项）且没报错`,
    clicked >= 8 && realErrors().length === before,
    `点了 ${clicked} 项，新报错 ${realErrors().length - before} 条`,
  )
}

/* ---------- 3. 同一个按钮连点三下：同时开着两个面板就算错 ---------- */
{
  const before = realErrors().length
  const btn = toolbarBtn('标题')
  await btn.first().click()
  await btn.first().click()
  await btn.first().click()
  await page.waitForTimeout(300)
  const menus = await openMenuCount()
  await page.keyboard.press('Escape')
  await page.waitForTimeout(200)
  check(
    '连点三下不会同时开两个面板',
    menus <= 1 && (await maskCount()) === 0 && realErrors().length === before,
    `同时开着 ${menus} 个菜单，新报错 ${realErrors().length - before} 条`,
  )
}

/* ---------- 4. 空文档上把所有表面再过一遍 ---------- */
{
  const before = realErrors().length
  await toolbarBtn('我的文档').first().click()
  await page.waitForSelector('.zh-docmenu', { timeout: 5000 })
  await page.locator('.zh-docmenu__new').click()
  await page.waitForTimeout(900)
  const title = await page.locator('.zh-title').inputValue().catch(() => '')
  const bad = []
  for (const s of SURFACES) {
    const reason = await tour(s)
    if (reason) bad.push(`${s.name}：${reason}`)
  }
  check(
    `空文档（新建的「${title || '未命名'}」）上这些表面照样能用`,
    bad.length === 0 && realErrors().length === before,
    bad.slice(0, 2).join('；') || `新报错 ${realErrors().length - before} 条`,
  )
}

/* ---------- 5. 光标在代码块里 / 表格里开菜单 ---------- */
{
  const before = realErrors().length
  await page.evaluate(() =>
    window.__EDITOR__.commands.setContent('```js\nconst a = 1\n```\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n', {
      contentType: 'markdown',
    }),
  )
  await page.waitForTimeout(500)
  const findings = []
  if ((await page.locator('.zh-codeblock__lang').count()) === 0) findings.push('代码块没渲染出语言按钮')

  await page.locator('.zh-codeblock code').first().click()
  await page.waitForTimeout(200)
  for (const s of SURFACES.slice(2, 8)) {
    const reason = await tour(s)
    if (reason) findings.push(`${s.name}（代码块里）：${reason}`)
  }

  await page.locator('.ProseMirror table td').first().click()
  await page.waitForTimeout(400)
  if ((await page.locator('.zh-tablemenu').count()) !== 1) findings.push('光标进表格后没浮出操作条')
  for (const s of SURFACES.slice(2, 8)) {
    const reason = await tour(s)
    if (reason) findings.push(`${s.name}（表格里）：${reason}`)
  }
  check(
    '代码块里 / 表格里开菜单也正常（含表格浮动操作条）',
    findings.length === 0 && realErrors().length === before,
    findings.slice(0, 2).join('；') || `新报错 ${realErrors().length - before} 条`,
  )
}

/* ---------- 6. 深色主题下整套再来一遍 ---------- */
{
  const before = realErrors().length
  await page.locator('.zh-btn[title^="主题"]').click()
  await page.waitForTimeout(250)
  await page.locator('.zh-menu__item', { hasText: '深色' }).click()
  await page.waitForTimeout(400)
  const theme = await page.evaluate(() => document.documentElement.dataset.theme)
  const bad = []
  for (const s of SURFACES) {
    const reason = await tour(s)
    if (reason) bad.push(`${s.name}：${reason}`)
  }
  check(
    '深色主题下这些表面照样能开能关',
    theme === 'dark' && bad.length === 0 && realErrors().length === before,
    bad.slice(0, 2).join('；') || `theme=${theme}，新报错 ${realErrors().length - before} 条`,
  )
  await page.locator('.zh-btn[title^="主题"]').click()
  await page.waitForTimeout(250)
  await page.locator('.zh-menu__item', { hasText: '浅色' }).click()
  await page.waitForTimeout(300)
}

/* ---------- 7. 收尾：焦点还在编辑器里，能接着打字 ---------- */
{
  await page.keyboard.press('Escape')
  await page.waitForTimeout(200)
  await page.evaluate(() => window.__EDITOR__.commands.focus('end'))
  await page.keyboard.press('Enter')
  await page.keyboard.type('巡游结束后还能写')
  await page.waitForTimeout(500)
  const md = await page.evaluate(() => window.__MD__())
  check('巡游结束后还能接着打字（焦点没被吃掉）', md.includes('巡游结束后还能写'), md.slice(-20).replace(/\n/g, '⏎'))
}

/* ---------- 8. 报错总账 ---------- */
{
  const rej = await rejections()
  check(
    '全程没有 console 报错 / 页面异常 / 未处理的 promise 拒绝',
    realErrors().length === 0 && rej.length === 0,
    [...realErrors(), ...rej].slice(0, 3).join(' | ') || `扫过全部表面${lastDialog ? `（期间弹过：${lastDialog}）` : ''}`,
  )
}

await browser.close()
const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} 通过`)
process.exit(failed.length ? 1 : 0)
