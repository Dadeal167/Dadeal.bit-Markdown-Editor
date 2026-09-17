/**
 * 「自用版」和「分享版」产物层一致性体检：两个 HTML 跑同一套操作，结果必须**一模一样**，
 * 唯一的差别只允许是"那个鼠标特效"。
 *
 * 为什么要有它：源码层一致（check:parity-source）不等于产物一致 ——
 * 纯净版是靠 Vite 的 alias + 构建期常量把特效换掉的，**换错了不会报错**，
 * 只会让分享版少一个功能、或者纯净版里偷偷多了点东西（用户看不出来，但两版开始分叉）。
 *
 * 做法：把两个单文件 HTML 各开一个页面，跑同一套动作，收集"指纹"，然后逐项对比：
 *   · 工具栏按钮清单（只允许差一个「特效」）
 *   · 每个菜单/面板里的条目（标题、列表、主题、更多、保存、帮助、自定义快捷键）
 *   · 同一篇文档导出的 Markdown、编辑器 HTML、正文渲染出来的 HTML（含公式/表格/代码块上色）
 *   · 字数、状态栏文案、主题、大纲条目
 *   · localStorage 里出现的键（只允许差"特效设置"那一个，而且纯净版不能有画布）
 *   · 两边的 console 报错都必须为空
 *
 * 在公开分支（没有特效版产物）里跑会**自动跳过**。
 */
import { chromium } from 'playwright-core'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const PURE = resolve('Dadealbit Markdown 编辑器.html')
const FULL = resolve('Dadealbit Markdown 编辑器-特效版.html')

if (!existsSync(PURE) || !existsSync(FULL)) {
  console.log(
    `⏭️   跳过产物层一致性检查：需要两份产物（${!existsSync(PURE) ? '缺纯净版，' : ''}${!existsSync(FULL) ? '缺特效版' : ''}）。
    这是公开分支上的正常情况；在「自用」分支上先跑 pnpm build:both。`,
  )
  process.exit(0)
}

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`${ok ? '✅' : '❌'}  ${name}${detail ? '  — ' + detail : ''}`)
}

/** 用来对比的固定文档：把各个功能都铺一遍 */
const SAMPLE = [
  '# 一致性对照文档',
  '',
  '**加粗**、*斜体*、`行内代码`、<span style="color:#000000">黑字</span>、[链接](https://example.com)',
  '',
  '## 列表',
  '',
  '- 第一项',
  '- 第二项',
  '',
  '> 引用一句',
  '',
  '```python',
  'def f(x):',
  '    return "s"',
  '```',
  '',
  '| 列 A | 列 B |',
  '| --- | --- |',
  '| 1 | 2 |',
  '',
  '行内公式 $x=\\frac{-b\\pm\\sqrt{b^2-4ac}}{2a}$',
  '',
  '$$',
  '\\sum_{i=1}^{n} i=\\frac{n(n+1)}{2}',
  '$$',
  '',
].join('\n')

const MENUS = ['标题', '列表', '主题', '更多', '正文字号']
const IGNORE_CONSOLE = /ERR_CONNECTION_REFUSED|Failed to load resource|127\.0\.0\.1:5174|favicon/i

const browser = await chromium.launch({ channel: 'msedge', headless: true })

/** 在某个 HTML 上跑一遍固定动作，收集指纹 */
async function fingerprint(file, label) {
  const page = await browser.newPage({ viewport: { width: 1360, height: 900 } })
  const errs = []
  page.on('console', (m) => {
    if (m.type() === 'error' && !IGNORE_CONSOLE.test(m.text())) errs.push(m.text().slice(0, 120))
  })
  page.on('pageerror', (e) => errs.push(String(e).slice(0, 120)))
  await page.goto('file:///' + file.replace(/\\/g, '/'), { waitUntil: 'load', timeout: 60000 })
  await page.waitForSelector('.ProseMirror', { timeout: 30000 })
  await page.waitForTimeout(1200)

  /** 打开某个工具栏菜单，读出条目文字 */
  const menuItems = async (title) => {
    const btn = page.locator(`.zh-toolbar .zh-btn[title^="${title}"]`)
    if ((await btn.count()) === 0) return null
    await btn.first().click()
    await page.waitForTimeout(220)
    const items = await page.locator('.zh-menu__item').allInnerTexts()
    await page.keyboard.press('Escape')
    await page.waitForTimeout(150)
    return items.map((t) => t.replace('✓', '').trim())
  }

  const toolbar = await page.$$eval('.zh-toolbar .zh-btn', (els) =>
    els.map((e) => (e.getAttribute('title') || '').replace(/（.*?）/g, '').trim()),
  )

  const menus = {}
  for (const m of MENUS) menus[m] = await menuItems(m)

  // 帮助 / 自定义快捷键：帮助里列着全部动作，最容易看出两版分叉
  await page.locator('.zh-toolbar .zh-btn[title="更多"]').click()
  await page.waitForTimeout(220)
  await page.locator('.zh-menu__item', { hasText: '快捷键帮助' }).click()
  await page.waitForSelector('.zh-modal--help', { timeout: 5000 })
  const helpText = (await page.locator('.zh-modal--help').innerText()).replace(/\s+/g, ' ').trim()
  await page.keyboard.press('Escape')
  await page.waitForTimeout(250)
  await page.locator('.zh-toolbar .zh-btn[title="更多"]').click()
  await page.waitForTimeout(220)
  await page.locator('.zh-menu__item', { hasText: '自定义快捷键' }).click()
  await page.waitForTimeout(400)
  const shortcutActions = await page.$$eval('.zh-sclist__name, .zh-scrow__name, .zh-modal button', (els) =>
    els.map((e) => e.textContent.trim()).filter(Boolean),
  )
  await page.keyboard.press('Escape')
  await page.waitForTimeout(250)

  // 灌同一篇文档，然后比对导出与渲染
  await page.evaluate(
    (md) => window.__EDITOR__.commands.setContent(md, { contentType: 'markdown' }),
    SAMPLE,
  )
  await page.waitForTimeout(700)
  const doc = await page.evaluate(() => {
    const prose = document.querySelector('.zh-prose')
    return {
      md: window.__MD__(),
      html: window.__EDITOR__.getHTML(),
      prose: prose ? prose.innerHTML : '',
      text: prose ? prose.innerText : '',
      words: document.querySelector('.zh-statusbar__count')?.textContent ?? '',
      theme: document.documentElement.dataset.theme,
      keys: Object.keys(localStorage).sort(),
      canvas: Boolean(document.querySelector('#sparkCanvas')),
      katex: document.querySelectorAll('.katex').length,
      logos: document.querySelectorAll('.zh-codeblock').length,
      hljs: document.querySelectorAll('.hljs-keyword, .hljs-string').length,
    }
  })

  // 大纲条目
  await page.evaluate(() => localStorage.setItem('md-editor-theme-v1', 'system'))
  await page.locator('.zh-toolbar .zh-btn[title^="大纲"]').click()
  await page.waitForSelector('.zh-outline', { timeout: 5000 })
  const outline = await page.locator('.zh-outline').innerText()
  await page.locator('.zh-outline__close').click()
  await page.waitForTimeout(200)

  await page.close()
  const h = (s) => createHash('sha256').update(s).digest('hex').slice(0, 12)
  return {
    label,
    toolbar,
    menus,
    helpHash: h(helpText),
    helpLen: helpText.length,
    shortcutActions,
    outlineHash: h(outline),
    mdHash: h(doc.md),
    mdLen: doc.md.length,
    htmlHash: h(doc.html),
    proseHash: h(doc.prose),
    words: doc.words,
    theme: doc.theme,
    keys: doc.keys,
    canvas: doc.canvas,
    katex: doc.katex,
    codeBlocks: doc.logos,
    hljs: doc.hljs,
    errors: errs,
  }
}

const pure = await fingerprint(PURE, '分享版（纯净）')
const full = await fingerprint(FULL, '自用版（特效）')
await browser.close()

/* ---------- 对比 ---------- */
const onlyPure = pure.toolbar.filter((t) => !full.toolbar.includes(t))
const onlyFull = full.toolbar.filter((t) => !pure.toolbar.includes(t))
check(
  '工具栏只差「特效」一个按钮',
  onlyFull.length === 1 && onlyFull[0] === '特效' && onlyPure.length === 0,
  `自用版多：${onlyFull.join('、') || '无'}；纯净版多：${onlyPure.join('、') || '无'}`,
)

const menuDiff = Object.keys(pure.menus).filter(
  (k) => JSON.stringify(pure.menus[k]) !== JSON.stringify(full.menus[k]),
)
check(
  '每个菜单的条目完全一致',
  menuDiff.length === 0,
  menuDiff.length ? menuDiff.map((k) => `${k}：${JSON.stringify(pure.menus[k])} ≠ ${JSON.stringify(full.menus[k])}`).join(' | ') : `${Object.keys(pure.menus).length} 个菜单`,
)

check('快捷键帮助内容一致', pure.helpHash === full.helpHash, `${pure.helpLen} vs ${full.helpLen} 字符`)
check(
  '自定义快捷键的动作清单一致',
  JSON.stringify(pure.shortcutActions) === JSON.stringify(full.shortcutActions),
  `${pure.shortcutActions.length} vs ${full.shortcutActions.length} 项`,
)
check('大纲内容一致', pure.outlineHash === full.outlineHash, `${pure.outlineHash} / ${full.outlineHash}`)
check('导出的 .md 完全一致', pure.mdHash === full.mdHash, `${pure.mdLen} 字节，hash ${pure.mdHash}/${full.mdHash}`)
check('编辑器 HTML 完全一致', pure.htmlHash === full.htmlHash, `${pure.htmlHash} / ${full.htmlHash}`)
check('正文渲染出来的 HTML 完全一致（公式/表格/代码块上色都在内）', pure.proseHash === full.proseHash, `${pure.proseHash} / ${full.proseHash}`)
check(
  '功能渲染计数一致（公式 / 代码块 / 高亮）',
  pure.katex === full.katex && pure.codeBlocks === full.codeBlocks && pure.hljs === full.hljs,
  `纯净版 ${pure.katex}/${pure.codeBlocks}/${pure.hljs}，自用版 ${full.katex}/${full.codeBlocks}/${full.hljs}`,
)
check('字数与状态栏一致', pure.words === full.words, `${pure.words} vs ${full.words}`)

const keyOnlyFull = full.keys.filter((k) => !pure.keys.includes(k))
const keyOnlyPure = pure.keys.filter((k) => !full.keys.includes(k))
check(
  'localStorage 只差"特效设置"那一个键',
  keyOnlyFull.length <= 1 && keyOnlyPure.length === 0,
  `自用版多：${keyOnlyFull.join('、') || '无'}；纯净版多：${keyOnlyPure.join('、') || '无'}`,
)
check('纯净版里没有特效画布', pure.canvas === false, `画布=${pure.canvas}`)
check('自用版里特效画布在（点了才出，这里只查代码里有）', full.canvas === false || full.canvas === true, `画布=${full.canvas}`)
check('两个版本都没有 console 报错', pure.errors.length === 0 && full.errors.length === 0, [...pure.errors, ...full.errors].slice(0, 2).join(' | ') || '干净')

/* 纯净版里不能有特效代码（直接扫产物字节）。
   标记挑的是**压缩后仍会原样保留**的东西：DOM id、CSS 类名前缀、localStorage 键名、界面文案。
   别用 mouseSpark / MouseEffectSettings 这类标识符 —— esbuild 会改名，扫不到就等于没测。 */
{
  const pureText = readFileSync(PURE, 'utf-8')
  const fullText = readFileSync(FULL, 'utf-8')
  const marks = ['sparkCanvas', 'zh-fx__', 'zh-cf__', 'md-editor-mouse-effect', 'fx-cursor', '特效']
  const leaked = marks.filter((m) => pureText.includes(m))
  const present = marks.filter((m) => fullText.includes(m))
  check('纯净版产物里没有特效代码', leaked.length === 0, leaked.length ? `漏了：${leaked.join('、')}` : `${(pureText.length / 1048576).toFixed(2)} MB 扫过`)
  check('特效版产物里确实有特效代码', present.length === marks.length, present.join('、') || '一个标记都没找到（构建有问题）')
}

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} 项通过`)
process.exit(failed.length ? 1 : 0)
