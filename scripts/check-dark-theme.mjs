/**
 * 深色模式体检：每个面板在深色下**底色必须够暗、字色必须够亮**。
 *
 * 为什么需要这个套件：深色主题是靠覆盖设计 token 实现的，只要哪个组件写死了浅色
 * （或者引用了不存在的变量），它在深色下就是一块白板。用户实际报过这个：
 *   "在深色模式下，其他的背景也应该变成黑色，字体变成白色的，要不然看不清"
 * 当时搜出来的是搜索框 —— 它写着 `background: var(--zh-panel, #fff)`，
 * 而 `--zh-panel` **从来没定义过**，于是永远回退成白色。
 * 这种"写死的浅色"肉眼一个个点很费劲，所以做成脚本量**计算样式**。
 *
 * 判定：底色亮度 < 90 且字色亮度 > 140 才算过（深色下）。
 * 走的是**用户真实路径** —— 点工具栏「主题」→ 菜单里选「深色」，
 * 而不是直接改 localStorage（直接改存档会绕过主题初始化，量出来的不可信）。
 */
import { chromium } from 'playwright-core'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const APP = resolve('Dadealbit Markdown 编辑器.html')
if (!existsSync(APP)) {
  console.error('先跑 pnpm build:pure（这个套件量的是纯净版产物）')
  process.exit(1)
}
const OUT = resolve('.probe', 'out')
mkdirSync(OUT, { recursive: true })

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`${ok ? '✅' : '❌'}  ${name}${detail ? '  — ' + detail : ''}`)
}

const browser = await chromium.launch({ channel: 'msedge', headless: true })
const page = await browser.newPage({ viewport: { width: 1280, height: 860 } })
const errors = []
page.on('pageerror', (e) => errors.push(String(e).slice(0, 140)))

await page.goto('file:///' + APP.replace(/\\/g, '/'), { waitUntil: 'load', timeout: 60000 })
await page.waitForSelector('.ProseMirror', { timeout: 30000 })
/* 从浅色开始，保证待会儿是"真的切过去" */
await page.evaluate(() => localStorage.removeItem('md-editor-theme-v1'))
await page.reload({ waitUntil: 'load' })
await page.waitForSelector('.ProseMirror', { timeout: 30000 })
await page.waitForTimeout(1000)

const themeNow = () => page.evaluate(() => document.documentElement.dataset.theme)
check('默认是浅色（切之前的基线）', (await themeNow()) === 'light', await themeNow())

/* 真实路径：工具栏「主题」→ 菜单里「深色」 */
await page.locator('.zh-btn[title^="主题"]').click()
await page.waitForTimeout(300)
await page.locator('.zh-menu button', { hasText: '深色' }).first().click()
await page.waitForTimeout(600)
check('点「主题 → 深色」能切到深色', (await themeNow()) === 'dark', await themeNow())

/** 读一个元素"看起来的底色"与字色，换算成亮度（0 黑 ~ 255 白） */
const look = (sel) =>
  page.evaluate((s) => {
    const el = document.querySelector(s)
    if (!el) return null
    const parse = (c) => {
      const m = /rgba?\(([^)]+)\)/.exec(c)
      if (!m) return null
      const p = m[1].split(',').map(Number)
      if (p.length > 3 && p[3] === 0) return null // 全透明
      return p.slice(0, 3)
    }
    const lum = (v) => (v ? Math.round(v[0] * 0.299 + v[1] * 0.587 + v[2] * 0.114) : null)
    const cs = getComputedStyle(el)
    let bg = parse(cs.backgroundColor)
    /* 自己透明就往上找第一个有底色的祖先 —— 那才是"看见的底" */
    let w = el
    while (!bg && w && w !== document.documentElement) {
      w = w.parentElement
      bg = parse(getComputedStyle(w).backgroundColor)
    }
    return { bgLum: lum(bg), fgLum: lum(parse(cs.color)), bg: bg ? `rgb(${bg.join(',')})` : null }
  }, sel)

/** 深色下的判定：底够暗 + 字够亮 */
const darkOk = async (sel, label) => {
  const r = await look(sel)
  if (!r) {
    /* 元素不存在（这个面板这一版没有）不算失败 */
    return
  }
  const ok = r.bgLum !== null && r.bgLum < 90 && r.fgLum !== null && r.fgLum > 140
  check(`${label} 在深色下是暗底亮字`, ok, `底 ${r.bg}（亮度 ${r.bgLum}）/ 字亮度 ${r.fgLum}`)
}

await darkOk('.zh-toolbar', '顶部工具栏')
await darkOk('.zh-statusbar', '底部状态栏')
await darkOk('.editor-card', '正文卡片')

/* ---------- 状态栏不许折成两行 / 不许重叠 ----------
   用户截图反馈："这下面有一个长条，为什么要两行呢？不挤吗"
   根因是**两个坑叠在一起**：
     1. white-space:normal —— 中文能在标点后换行，「字数：4242」就变成两行
     2. flex 默认会压缩 —— 只加 nowrap 还不够，盒子仍会被压到比内容窄，
        溢出的部分被后一个元素盖住（实测日期时间的秒数被开关盖掉）
   修法：每项 nowrap + flex:none，并把状态栏放宽到 780px（六项共需约 740px）。
   ⚠️ 这一段要**放在打开各种弹窗之前**：体检提示条浮出来时会把状态栏挤窄，
      那时量出来的溢出不是布局问题。 */
{
  const barAt = async (w) => {
    await page.setViewportSize({ width: w, height: 900 })
    await page.waitForTimeout(500)
    return page.evaluate(() => {
      const inner = document.querySelector('.zh-statusbar__inner')
      if (!inner) return null
      const ir = inner.getBoundingClientRect()
      const padR = parseFloat(getComputedStyle(inner).paddingRight)
      const vis = [...inner.children].filter((el) => getComputedStyle(el).display !== 'none')
      const lines = (el) => {
        const tops = new Set()
        const walk = (n) => {
          if (n.nodeType === 3) {
            const r = document.createRange()
            r.selectNodeContents(n)
            for (const x of r.getClientRects()) tops.add(Math.round(x.top))
            return
          }
          for (const c of n.childNodes) walk(c)
        }
        walk(el)
        return tops.size
      }
      let overlap = 0
      for (let i = 1; i < vis.length; i++) {
        const a = vis[i - 1].getBoundingClientRect()
        const b = vis[i].getBoundingClientRect()
        if (b.left < a.right - 1) overlap += 1
      }
      const last = vis[vis.length - 1]
      return {
        h: Math.round(ir.height),
        overflow: Math.round(last.getBoundingClientRect().right - (ir.right - padR)),
        overlap,
        maxLines: vis.length ? Math.max(...vis.map(lines)) : 0,
        parts: vis.length,
      }
    })
  }

  for (const w of [1280, 900, 760]) {
    const r = await barAt(w)
    if (!r) {
      check(`状态栏在 ${w}px 宽下正常`, false, '找不到状态栏')
      continue
    }
    check(
      `状态栏在 ${w}px 宽下：每项一行、不重叠、不溢出`,
      r.h === 52 && r.maxLines === 1 && r.overlap === 0 && r.overflow <= 1,
      `高 ${r.h}px（${r.parts} 项），最多 ${r.maxLines} 行，重叠 ${r.overlap} 处，溢出 ${r.overflow}px`,
    )
  }
  await page.setViewportSize({ width: 1280, height: 860 })
  await page.waitForTimeout(400)
}


/* ---------- 一批"白底次要按钮 / 小浮层"也要跟上深色 ----------
   这一组是**静态扫描 + 实测**一起找出来的：index.css 里写死了 `background: #fff`
   而 dark.css 没覆盖，深色下就是一块白。第一版扫描器用"选择器互相包含"判覆盖，
   被 `html`/`body` 这种宽选择器骗过去、一条都报不出来（假信号）——
   后来改成精确匹配，并用"故意植入一条白底规则"验证过它确实抓得到。
   抓出来的就是下面这些。 */
await page.locator('.zh-btn[title="公式"]').click()
await page.waitForSelector('.zh-modal--math', { timeout: 5000 })
await page.waitForTimeout(400)
await darkOk('.zh-modal--math .zh-btn-plain', '公式弹窗·取消按钮')
await darkOk('.zh-mathmode__btn', '公式弹窗·行内/行间按钮')

/* 公式补全下拉：在公式输入框里打字才会出现 */
await page.locator('.zh-mathsource').click()
await page.keyboard.type('\\sqrt')
await page.waitForTimeout(600)
await darkOk('.zh-autocomplete', '公式补全下拉')
for (let i = 0; i < 4 && (await page.locator('.zh-modal--math').count()) > 0; i++) {
  await page.keyboard.press('Escape')
  await page.waitForTimeout(250)
}
await page.waitForTimeout(300)

/* 字体面板 */
await page.locator('.zh-btn[title="正文字号 / 字体 / 文字颜色"]').click()
await page.waitForSelector('.zh-typomenu', { timeout: 5000 })
await page.waitForTimeout(400)
await darkOk('.zh-typomenu__clear', '字体面板·清除颜色')
await darkOk('.zh-typomenu__install', '字体面板·安装字体')
await page.keyboard.press('Escape')
await page.waitForTimeout(400)

/* 文档菜单 */
await page.locator('.zh-btn[title^="我的文档"]').first().click()
await page.waitForTimeout(400)
await darkOk('.zh-docmenu__new', '文档菜单·新建')
await page.keyboard.press('Escape')
await page.waitForTimeout(400)

/* 搜索框（就是当初出问题那个） */
await page.locator('.zh-btn[title="搜索"]').click()
await page.waitForSelector('.zh-search', { timeout: 5000 })
await page.waitForTimeout(400)
await darkOk('.zh-search', '搜索框')
await darkOk('.zh-search__input', '  搜索输入框')
await page.keyboard.press('Escape')
await page.waitForTimeout(300)

/* 公式弹窗 */
await page.locator('.zh-btn[title="公式"]').click()
await page.waitForSelector('.zh-modal--math', { timeout: 5000 })
await page.waitForTimeout(400)
await darkOk('.zh-modal--math', '公式弹窗')
await darkOk('.zh-mathsource', '  TeX 输入框')
await page.keyboard.press('Escape')
await page.waitForTimeout(300)

/* 更多菜单 */
await page.locator('.zh-btn[title="更多"]').click()
await page.waitForTimeout(300)
await darkOk('.zh-menu', '「更多」菜单')
await page.keyboard.press('Escape')
await page.waitForTimeout(250)

/* 使用反馈弹窗 */
await page.locator('.zh-btn[title="更多"]').click()
await page.waitForTimeout(250)
await page.locator('.zh-menu button', { hasText: '使用反馈' }).first().click()
await page.waitForSelector('.zh-modal--feedback', { timeout: 5000 })
await page.waitForTimeout(400)
await darkOk('.zh-modal--feedback', '使用反馈弹窗')
await darkOk('.zh-feedback__todo', '  三步走区块')
await page.keyboard.press('Escape')
await page.waitForTimeout(300)

/* 大纲 */
await page.locator('.zh-btn[title="大纲"]').click()
await page.waitForTimeout(400)
await darkOk('.zh-outline', '大纲面板')
await page.keyboard.press('Escape')
await page.waitForTimeout(250)

/* 表格浮动条 */
await page.evaluate(() => window.__EDITOR__.commands.insertTable({ rows: 2, cols: 2, withHeaderRow: true }))
await page.waitForTimeout(500)
await darkOk('.zh-tablemenu', '表格浮动操作条')
await darkOk('.zh-prose th', '正文表格表头')

/* 切回浅色也要正常（别修深色把浅色弄坏了） */
await page.locator('.zh-btn[title^="主题"]').click()
await page.waitForTimeout(300)
await page.locator('.zh-menu button', { hasText: '浅色' }).first().click()
await page.waitForTimeout(600)
const lightBar = await look('.zh-toolbar')
check(
  '切回浅色后工具栏恢复浅底深字（没把浅色弄坏）',
  lightBar && lightBar.bgLum > 140 && lightBar.fgLum < 120,
  `底亮度 ${lightBar?.bgLum} / 字亮度 ${lightBar?.fgLum}`,
)
const lightSearch = await (async () => {
  await page.locator('.zh-btn[title="搜索"]').click()
  await page.waitForSelector('.zh-search', { timeout: 5000 })
  await page.waitForTimeout(400)
  const r = await look('.zh-search')
  await page.keyboard.press('Escape')
  return r
})()
check(
  '浅色下搜索框是浅底深字',
  lightSearch && lightSearch.bgLum > 140,
  `底亮度 ${lightSearch?.bgLum}`,
)

check('全程没有 JS 报错', errors.length === 0, errors.slice(0, 2).join(' | '))

await browser.close()
const failed = results.filter((r) => !r.ok)
console.log(`\n${failed.length ? '❌' : '✅'}  深色模式：${results.length - failed.length}/${results.length} 通过`)
if (failed.length) {
  console.log('失败项：' + failed.map((f) => f.name).join('、'))
  writeFileSync(resolve(OUT, 'dark-theme-fail.json'), JSON.stringify(failed, null, 2), 'utf-8')
  process.exit(1)
}
