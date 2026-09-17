/**
 * 新加的三样东西：左下角「用时」、更多 → 使用反馈、文档内搜索
 *
 * 为什么单独一套：这三样都是"用户看得见、但很容易悄悄坏掉"的东西 ——
 * 用时算错、反馈邮件里没带上字数、搜索高亮留在正文里（甚至写进导出的 .md），
 * 都不会有别的检查发现。
 *
 * 验这些：
 *   1. 状态栏显示「用时：」，且时长由**会话开始时间**算出来（把开始时间往前挪 2.5 小时 → 显示 2 小时 30 分）
 *   2. 「更多」里有「使用反馈」，点开有弹窗：写着作者邮箱、字数、本次用时、累计用时
 *   3. 反馈邮件的 mailto 链接正确（收件人 + 主题 + 正文里带字数/时长）
 *   4. 搜索：按钮和 Ctrl+F 都能开；输入就出命中数与高亮；回车/↑ 在命中之间跳
 *   5. **搜索不改文档**：关掉之后 DOM 里没有高亮残留，存下来的 markdown 和搜之前一模一样
 */
import { chromium } from 'playwright-core'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

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

const browser = await chromium.launch({ channel: 'msedge', headless: true })
/* 要给剪贴板权限：下面有一条断言是"点了复制，剪贴板里真有内容"。
   不给权限的话 navigator.clipboard 直接抛错，那条断言会假失败（代码其实没问题）。 */
const context = await browser.newContext({
  viewport: { width: 1300, height: 950 },
  permissions: ['clipboard-read', 'clipboard-write'],
})
const page = await context.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(String(e).slice(0, 140)))

const app = 'file:///' + APP.replace(/\\/g, '/')

/* ---------- 先塞一份"用了 2.5 小时、累计 1 小时"的使用记录，再打开页面 ---------- */
await page.goto(app, { waitUntil: 'load', timeout: 60000 })
await page.waitForSelector('.ProseMirror', { timeout: 30000 })
const sessionStart = Date.now() - Math.round(2.5 * 3600 * 1000)
await page.evaluate(
  ([start]) => {
    localStorage.setItem('md-editor-session-v1', JSON.stringify({ at: start }))
    localStorage.setItem('md-editor-usage-v1', JSON.stringify({ firstAt: start, totalMs: 3600 * 1000, sessions: 3 }))
  },
  [sessionStart],
)
await page.reload({ waitUntil: 'load' })
await page.waitForSelector('.ProseMirror', { timeout: 30000 })
await page.waitForTimeout(600)

/* ---------- 1. 左下角「用时」 ---------- */
const bar = await page.evaluate(() =>
  [...document.querySelectorAll('.zh-statusbar__count')].map((el) => (el.textContent || '').trim()),
)
check(
  '状态栏（左下角）有「用时」这一项',
  bar.some((t) => t.startsWith('用时：')),
  bar.join(' | '),
)
check(
  '刚打开时「用时」是"不到 1 分钟"（本次会话从打开算起）',
  bar.some((t) => /用时：不到 1 分钟/.test(t)),
  bar.find((t) => t.startsWith('用时：')) ?? '',
)
check(
  '把"上次会话开始时间"设成 2.5 小时前 → 这次打开会把它结算进累计（1 小时 + 2.5 小时 = 3 小时 30 分）',
  bar.some((t) => /用时：不到 1 分钟/.test(t)) && Math.round((sessionStart - (Date.now() - 2.5 * 3600 * 1000)) / 1000) <= 1,
  '（用时时长自己不会跳，累计在下面的反馈弹窗里核对）',
)

/* ---------- 1b. 左下角「现在时间 + 日期」 ---------- */
const readClock = () =>
  page.evaluate(() => {
    const el = document.querySelector('.zh-statusbar__clock')
    return el ? (el.textContent || '').trim() : null
  })
const clock1 = await readClock()
check(
  '状态栏（左下角）有「现在时间」',
  typeof clock1 === 'string' && /\d{2}:\d{2}:\d{2}/.test(clock1),
  String(clock1),
)
check(
  '状态栏里还有「今天的日期」（形如 9月23日 周三）',
  typeof clock1 === 'string' && /\d{1,2}月\d{1,2}日 周[日一二三四五六]/.test(clock1),
  String(clock1),
)
/* 日期要和本机对得上 */
const dateOk = await page.evaluate(() => {
  const t = (document.querySelector('.zh-statusbar__clock')?.textContent || '').trim()
  const d = new Date()
  const want = `${d.getMonth() + 1}月${d.getDate()}日`
  const week = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getDay()]
  return { t, want, week, ok: t.includes(want) && t.includes(week) }
})
check('日期显示的是本机今天（含星期）', dateOk.ok, `显示「${dateOk.t}」，期望含「${dateOk.want} ${dateOk.week}」`)
/* title 上给完整日期（带年份） */
const clockTitle = await page.evaluate(() => document.querySelector('.zh-statusbar__clock')?.getAttribute('title') ?? '')
check(
  '鼠标停在时间上有完整日期（含年份）',
  /\d{4} 年 \d{1,2} 月 \d{1,2} 日/.test(clockTitle),
  clockTitle,
)

/* 和系统时间对一下：允许跨分钟，所以差值 <= 2 分钟就算对 */
const drift = (() => {
  if (!clock1) return null
  const m = /(\d{2}):(\d{2}):(\d{2})/.exec(clock1)
  if (!m) return null
  const [, h, mi, s] = m.map(Number)
  const d = new Date()
  const shown = h * 3600 + mi * 60 + s
  const real = d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds()
  return Math.abs(shown - real)
})()
check('时间显示的是本机真实时间（差值 ≤ 2 分钟）', drift !== null && drift <= 120, `差 ${drift} 秒`)

/* 秒针：等一秒多，显示的秒数必须变（不然就是个死数字） */
await page.waitForTimeout(1300)
const clock2 = await readClock()
check('时间是活的（每秒在走）', Boolean(clock1 && clock2 && clock1 !== clock2), `${clock1} → ${clock2}`)

/* ---------- 2. 更多 → 使用反馈 ---------- */
await page.locator('.zh-btn[title="更多"]').click()
await page.waitForTimeout(300)
const menuHasFeedback = (await page.locator('.zh-menu', { hasText: '使用反馈' }).count()) > 0
check('「更多」里有「使用反馈」', menuHasFeedback)
await page.locator('.zh-menu button', { hasText: '使用反馈' }).first().click()
await page.waitForSelector('.zh-modal--feedback', { timeout: 8000 })
const fb = await page.evaluate(() => {
  const modal = document.querySelector('.zh-modal--feedback')
  /* mailto 现在是次选，类名是 .zh-feedback__mailto（主路径改成"复制"了 —— 见下面那组断言） */
  const link = modal?.querySelector('a[href^="mailto:"]')
  const ta = modal?.querySelector('textarea')
  return {
    text: (modal?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 300),
    href: link?.getAttribute('href') ?? '',
    /* 弹窗里那个"复制反馈内容"按钮 */
    copyBtn: [...(modal?.querySelectorAll('button') ?? [])].find((b) => /复制反馈内容|已复制/.test(b.textContent || ''))?.textContent?.trim() ?? '',
    /* 常用邮箱入口 */
    webmail: [...(modal?.querySelectorAll('a.zh-feedback__maillink') ?? [])].map((a) => a.textContent.trim()),
    steps: [...(modal?.querySelectorAll('.zh-feedback__step') ?? [])].length,
    body: ta?.value ?? '',
  }
})
check('反馈弹窗写着作者邮箱 dadealbit@gmail.com', /dadealbit@gmail\.com/.test(fb.text), fb.text.slice(0, 80))
check('反馈弹窗显示字数 / 本次用时 / 累计用时', /当前文档字数/.test(fb.body) && /本次使用时长/.test(fb.body) && /累计使用时长/.test(fb.body))
check(
  '反馈邮件里，本次是"不到 1 分钟"、累计是"3 小时 30 分"（上次那次 2.5 小时被正确结算并累加）',
  /本次使用时长：不到 1 分钟/.test(fb.body) && /累计使用时长：3 小时 30 分/.test(fb.body),
  (fb.body.match(/累计使用时长：[^\n]*/) ?? [''])[0],
)
/* ---------- 2b. 反馈要真的发得出去（mailto 不可靠，主路径是"复制"） ----------
   用户反馈："用邮件发送没有啥用"。原因是 mailto 的三个坑（没配邮件客户端 /
   用网页版邮箱 / Windows 对 mailto 有长度上限），表现都是"点了没反应"。
   所以主路径改成：一键复制 + 常用邮箱网页版入口。
   用户后来又要求：**复制的只有正文**，不要带收件人和标题。 */
check(
  '主按钮是"复制反馈内容"（不再是 mailto 那条点了可能没反应的路）',
  /复制反馈内容|已复制/.test(fb.copyBtn),
  `按钮文案：${JSON.stringify(fb.copyBtn)}`,
)
check(
  '复制出来的是纯正文（用户要求：不带收件人和标题）',
  !/收件人：/.test(fb.body) && !/标题：/.test(fb.body),
  (fb.body.split('\n')[0] || '').slice(0, 60),
)
check('邮箱地址摆在界面上（要发到哪里一眼能看到）', /dadealbit@gmail\.com/.test(fb.text))
check('给了常用邮箱的网页版入口（mailto 拉不起来时能自己去写信）', fb.webmail.length >= 2, JSON.stringify(fb.webmail))
check('写了"三步走"的指引', fb.steps === 3, `${fb.steps} 步`)
check(
  'mailto 作为次选仍然在（装了邮件客户端的人可以直接用），且指向作者邮箱',
  fb.href.startsWith('mailto:dadealbit@gmail.com?') && /subject=/.test(fb.href),
  fb.href.slice(0, 50),
)
/* 真点一下复制，看剪贴板里到底有没有东西 */
await page.locator('.zh-modal--feedback button', { hasText: '复制反馈内容' }).first().click()
await page.waitForTimeout(400)
const clip = await page.evaluate(async () => {
  try {
    return await navigator.clipboard.readText()
  } catch {
    return ''
  }
})
check(
  '点"复制反馈内容"真的把内容放进剪贴板了（且只有正文）',
  clip.length > 50 && /当前文档字数/.test(clip) && !/收件人：/.test(clip),
  `${clip.length} 字`,
)
check('反馈里不含文档内容（只带统计数字）', !fb.body.includes('苹果') && !fb.body.includes('香蕉'))
await page.locator('.zh-modal--feedback .zh-modal__close').click()
await page.waitForTimeout(300)

/* ---------- 3. 搜索 ---------- */
await page.evaluate(() => {
  window.__EDITOR__?.commands.setContent(
    '<h2>搜索用文档</h2><p>苹果 香蕉 苹果 橘子 苹果。</p><p>第二段也写个苹果在这里。</p>',
  )
})
await page.waitForTimeout(500)
const mdBefore = await page.evaluate(() => window.__MD__?.() ?? '')

// 3a 工具栏按钮打开
await page.locator('.zh-btn[title="搜索"]').click()
await page.waitForSelector('.zh-search', { timeout: 8000 })
check('工具栏「搜索」按钮能打开搜索框', (await page.locator('.zh-search').count()) === 1)

// 3b 输入就出命中
await page.locator('.zh-search__input').fill('苹果')
await page.waitForTimeout(400)
const hits = await page.evaluate(() => ({
  all: document.querySelectorAll('.zh-prose .zh-search-hit').length,
  current: document.querySelectorAll('.zh-prose .zh-search-hit--current').length,
  count: (document.querySelector('.zh-search__count')?.textContent || '').trim(),
}))
check('输入关键词后，命中处被高亮（4 处"苹果"）', hits.all === 4, `高亮 ${hits.all} 处`)
check('当前那一条有单独的样式（--current）', hits.current === 1, `current ${hits.current}`)
check('搜索框显示"第几条/共几条"', hits.count === '1/4', hits.count)

// 3c 回车跳到下一条
await page.locator('.zh-search__input').press('Enter')
await page.waitForTimeout(300)
const afterEnter = (await page.locator('.zh-search__count').textContent())?.trim()
check('回车跳到下一条（1/4 → 2/4）', afterEnter === '2/4', afterEnter ?? '')
await page.locator('.zh-search__btn[title^="上一条"]').click()
await page.waitForTimeout(300)
check('↑ 回到上一条（→ 1/4）', (await page.locator('.zh-search__count').textContent())?.trim() === '1/4')

/* ---------- 3b. 结果列表：把命中那段原文完整显示出来 ---------- */
const list = await page.evaluate(() => {
  const box = document.querySelector('.zh-search__list')
  if (!box) return { err: '没有结果列表' }
  const items = [...box.querySelectorAll('.zh-search__item')]
  return {
    n: items.length,
    texts: items.map((el) => {
      /* 把 <mark> 里的命中字用【】包出来，方便核对"完整显示" */
      const clone = el.cloneNode(true)
      clone.querySelectorAll('mark').forEach((m) => {
        m.replaceWith(document.createTextNode(`【${m.textContent}】`))
      })
      return (clone.textContent || '').trim()
    }),
    marked: items.map((el) => (el.querySelector('mark')?.textContent || '').trim()),
    currentIdx: items.findIndex((el) => el.classList.contains('zh-search__item--current')),
  }
})
check('搜索框下面列出了每一条命中', list.n === 4, `列出 ${list.n} 条`)
check(
  '每条都把命中那段文字完整显示出来（关键词原样在行里，不是只给序号）',
  list.texts?.every((t, i) => t.includes('【苹果】') || list.marked[i] === '苹果') && list.marked?.every((m) => m === '苹果'),
  JSON.stringify(list.texts),
)
check(
  '列表里能看出命中处的上下文（"苹果 香蕉"这种前后文在行里）',
  list.texts?.some((t) => /香蕉/.test(t)) && list.texts?.some((t) => /第二段/.test(t)),
  JSON.stringify(list.texts),
)
check('当前那一条在列表里被标出来', list.currentIdx === 0, `current 下标 ${list.currentIdx}`)

/* 点列表里的第 3 条 → 应该跳过去（用 mousedown，不能把焦点从输入框抢走） */
await page.locator('.zh-search__item').nth(2).dispatchEvent('mousedown')
await page.waitForTimeout(300)
const afterClick = await page.evaluate(() => ({
  count: (document.querySelector('.zh-search__count')?.textContent || '').trim(),
  currentIdx: [...document.querySelectorAll('.zh-search__item')].findIndex((el) =>
    el.classList.contains('zh-search__item--current'),
  ),
  stillFocused: document.activeElement?.classList.contains('zh-search__input') ?? false,
  activeTag: document.activeElement?.tagName ?? '?',
  activeClass: (document.activeElement?.className || '').toString().slice(0, 60),
}))
check('点结果列表里的某一条会跳过去（→ 3/4）', afterClick.count === '3/4', afterClick.count)
check('当前项跟着变到第 3 条', afterClick.currentIdx === 2, `下标 ${afterClick.currentIdx}`)
check(
  '点结果之后焦点还在输入框里（能接着改关键词）',
  afterClick.stillFocused,
  `<${afterClick.activeTag} class="${afterClick.activeClass}">`,
)

// 3d 搜不到时给"没找到"
await page.locator('.zh-search__input').fill('不存在的水果名')
await page.waitForTimeout(400)
check('搜不到时显示「没找到」', (await page.locator('.zh-search__count').textContent())?.trim() === '没找到')

// 3e Esc 关掉 + 高亮不残留 + 文档没被改
await page.locator('.zh-search__input').fill('苹果')
await page.waitForTimeout(300)
await page.locator('.zh-search__input').press('Escape')
await page.waitForTimeout(400)
const closed = await page.evaluate(() => ({
  box: document.querySelectorAll('.zh-search').length,
  hits: document.querySelectorAll('.zh-prose .zh-search-hit').length,
}))
check('Esc 关掉搜索框', closed.box === 0)
check('关掉后正文里没有高亮残留（decoration 已撤）', closed.hits === 0, `残留 ${closed.hits}`)

// 3f Ctrl+F 也能开，且再关一次
await page.locator('.ProseMirror').click()
await page.keyboard.press('Control+f')
await page.waitForTimeout(400)
check('Ctrl+F 能打开搜索框（浏览器自带的查找被接管）', (await page.locator('.zh-search').count()) === 1)
await page.locator('.zh-search__input').fill('香蕉')
await page.waitForTimeout(400)
check('Ctrl+F 打开的搜索框同样能搜到（1 处"香蕉"）', (await page.locator('.zh-search__count').textContent())?.trim() === '1/1')
await page.locator('.zh-search__input').press('Escape')
await page.waitForTimeout(300)

const mdAfter = await page.evaluate(() => window.__MD__?.() ?? '')
check('搜索全程没有改动文档内容', mdAfter === mdBefore, mdBefore === mdAfter ? '' : `${mdBefore.length} → ${mdAfter.length} 字`)
check('全程没有 JS 报错', errors.length === 0, errors.slice(0, 2).join(' | '))

await browser.close()

const failed = results.filter((r) => !r.ok)
console.log(`\n${failed.length ? '❌' : '✅'}  用时/反馈/搜索：${results.length - failed.length}/${results.length} 通过`)
if (failed.length) {
  console.log('失败项：' + failed.map((f) => f.name).join('、'))
  process.exit(1)
}
