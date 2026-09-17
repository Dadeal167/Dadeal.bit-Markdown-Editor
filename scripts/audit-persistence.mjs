/**
 * 持久化体检：模拟"关掉浏览器再打开"，看上次的工作是否还在。
 *
 * 用 launchPersistentContext（真实配置文件）打开**双击版单文件**（file://），
 * 写入文档 / 排版 / 主题 / 自定义字体 / 快捷键 → 关闭 → 重新打开 → 逐项核对。
 */
import { chromium } from 'playwright-core'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { tmpdir } from 'node:os'

const friendly = resolve('Dadealbit Markdown 编辑器.html')
const fileUrl = 'file:///' + friendly.replace(/\\/g, '/')
const katexFont = resolve('node_modules', 'katex', 'dist', 'fonts', 'KaTeX_Main-Regular.woff2')

if (!existsSync(friendly) || !existsSync(katexFont)) {
  console.error('需要先 pnpm build，并且 node_modules/katex 要在')
  process.exit(1)
}

const results = []
const record = (name, ok, detail = '') => {
  results.push({ name, ok, detail })
  console.log(`${ok ? '✅' : '❌'}  ${name}${detail ? '  — ' + detail : ''}`)
}

const profile = mkdtempSync(resolve(tmpdir(), 'md-editor-profile-'))
const opts = { channel: 'msedge', headless: true, viewport: { width: 1360, height: 900 }, acceptDownloads: true }

const ready = async (page) => {
  await page.waitForSelector('.ProseMirror', { timeout: 30000 })
  await page.waitForTimeout(1400)
}
const md = (page) => page.evaluate(() => window.__MD__?.() ?? '')
const snapshot = (page) =>
  page.evaluate(() => {
    const prose = document.querySelector('.zh-prose')
    return {
      theme: document.documentElement.dataset.theme,
      fontSize: prose ? getComputedStyle(prose).fontSize : null,
      fontFamily: prose ? getComputedStyle(prose).fontFamily : null,
      title: document.querySelector('.zh-title')?.value ?? null,
      customFontFaces: [...document.fonts].filter((f) => f.family.startsWith('userfont-')).length,
    }
  })

/* ================= 第一次运行：写入各类数据 ================= */
console.log('--- 第一次打开（全新配置文件）---')
let ctx = await chromium.launchPersistentContext(profile, opts)
let page = await ctx.newPage()
await page.goto(fileUrl, { waitUntil: 'load', timeout: 60000 })
await ready(page)

// 1. 写标题 + 正文
await page.locator('.zh-title').fill('持久化测试笔记')
await page.evaluate(() => window.__EDITOR__.commands.focus('end'))
await page.waitForTimeout(400)
await page.keyboard.press('Enter')
await page.keyboard.type('关闭浏览器之后这段字必须还在。')
await page.waitForTimeout(1800)

// 2. 新建第二篇文档并写内容
await page.locator('.zh-btn[title^="我的文档"]').click()
await page.waitForSelector('.zh-docmenu', { timeout: 4000 })
await page.locator('.zh-docmenu__new').click()
await page.waitForTimeout(900)
await page.locator('.zh-title').fill('第二篇：错题本')
await page.evaluate(() => window.__EDITOR__.commands.focus('start'))
await page.waitForTimeout(400) // 等焦点真的落到编辑器上，否则第一个字会打进标题框
await page.keyboard.type('错题本内容')
await page.waitForTimeout(1800)

// 3. 排版：字号「大」+ 楷体
await page.locator('.zh-btn[title="正文字号 / 字体 / 文字颜色"]').click()
await page.waitForSelector('.zh-typomenu', { timeout: 4000 })
await page.locator('.zh-typomenu__chip', { hasText: '大' }).first().click()
await page.locator('.zh-typomenu__item', { hasText: '楷体' }).click()
await page.waitForTimeout(400)

// 4. 安装一个自定义字体（用 KaTeX 自带的 woff2 当素材）
const [chooser] = await Promise.all([
  page.waitForEvent('filechooser', { timeout: 8000 }),
  page.locator('.zh-typomenu__install').click(),
])
await chooser.setFiles(katexFont)
await page.waitForTimeout(1500)
const installedName = await page.evaluate(() => {
  const el = document.querySelector('.zh-typecustom__pick')
  return el ? el.innerText.replace(/\n/g, ' ') : null
})
record('能安装自定义字体', !!installedName, installedName ?? '没装上')

// 5. 主题切深色
await page.keyboard.press('Escape')
await page.waitForTimeout(300)
await page.locator('.zh-btn[title^="主题"]').click()
await page.waitForTimeout(200)
await page.locator('.zh-menu__item', { hasText: '深色' }).click()
await page.waitForTimeout(400)

// 6. 改一个快捷键（加粗 → Ctrl+Alt+B）
await page.locator('.zh-btn[title="更多"]').click()
await page.waitForTimeout(200)
await page.locator('.zh-menu__item', { hasText: '自定义快捷键' }).click()
await page.waitForSelector('.zh-modal--shortcuts', { timeout: 4000 })
await page.locator('.zh-scrow', { hasText: '加粗' }).first().locator('.zh-sckey').click()
await page.keyboard.press('Control+Alt+b')
await page.waitForTimeout(400)
await page.keyboard.press('Escape')
await page.waitForTimeout(400)

const before = await snapshot(page)
const beforeMd = await md(page)
const beforeDocs = await page.evaluate(() => {
  const raw = localStorage.getItem('md-editor-docs-v1')
  const s = raw ? JSON.parse(raw) : null
  return s ? { count: s.docs.length, titles: s.docs.map((d) => d.title), current: s.currentId } : null
})
console.log('关闭前：', JSON.stringify({ ...before, mdTail: beforeMd.slice(-14) }), JSON.stringify(beforeDocs))

await ctx.close()

/* ================= 第二次运行：同一配置文件，重新打开 ================= */
console.log('\n--- 重新打开（同一个配置文件）---')
ctx = await chromium.launchPersistentContext(profile, opts)
page = await ctx.newPage()
await page.goto(fileUrl, { waitUntil: 'load', timeout: 60000 })
await ready(page)
await page.waitForTimeout(800)

const after = await snapshot(page)
const afterMd = await md(page)
const afterDocs = await page.evaluate(() => {
  const raw = localStorage.getItem('md-editor-docs-v1')
  const s = raw ? JSON.parse(raw) : null
  return s ? { count: s.docs.length, titles: s.docs.map((d) => d.title), current: s.currentId } : null
})
console.log('重开后：', JSON.stringify({ ...after, mdTail: afterMd.slice(-14) }), JSON.stringify(afterDocs))

record('两篇文档都还在', afterDocs?.count === 2, JSON.stringify(afterDocs?.titles))
record(
  '停在上次编辑的那一篇',
  !!afterDocs?.current && afterDocs.current === beforeDocs?.current,
  `关闭前 ${String(beforeDocs?.current).slice(0, 8)}… → 重开后 ${String(afterDocs?.current).slice(0, 8)}…`,
)
record('正文内容还在', afterMd.includes('错题本内容'), afterMd.slice(-14).replace(/\n/g, '⏎'))
record('标题还在', after.title === '第二篇：错题本', String(after.title))
record('字号设置还在（18px）', after.fontSize === '18px', String(after.fontSize))
record('主题还在（深色）', after.theme === 'dark', String(after.theme))
record(
  '已安装的字体重新注册成功',
  after.customFontFaces >= 1,
  `document.fonts 里有 ${after.customFontFaces} 个自定义字体`,
)
const boldBinding = await page.evaluate(() => {
  const raw = localStorage.getItem('md-editor-shortcuts-v1')
  return raw ? JSON.parse(raw).bold : null
})
record('自定义快捷键还在', boldBinding === 'Mod-Alt-B', String(boldBinding))

// 自定义字体真的能渲染（量一下同字符串在自定义字体与默认字体下的宽度差）
const fontWorks = await page.evaluate(async () => {
  const fam = [...document.fonts].find((f) => f.family.startsWith('userfont-'))?.family
  if (!fam) return { ok: false, why: '没有自定义字体' }
  const canvas = document.createElement('canvas')
  const ctx2 = canvas.getContext('2d')
  ctx2.font = `32px "${fam}"`
  const a = ctx2.measureText('AMBIGUOUS 123').width
  ctx2.font = '32px monospace'
  const b = ctx2.measureText('AMBIGUOUS 123').width
  return { ok: Math.abs(a - b) > 0.5, a: Math.round(a), b: Math.round(b), fam }
})
record('自定义字体能真正渲染', fontWorks.ok, `宽度 ${fontWorks.a} vs ${fontWorks.b}（${fontWorks.fam ?? ''}）`)

// 换个浏览器配置打开：数据不该串（说明确实存在本地配置文件里，而不是内存里）
await ctx.close()
const otherProfile = mkdtempSync(resolve(tmpdir(), 'md-editor-profile2-'))
const ctx3 = await chromium.launchPersistentContext(otherProfile, opts)
const page3 = await ctx3.newPage()
await page3.goto(fileUrl, { waitUntil: 'load', timeout: 60000 })
await ready(page3)
const fresh = await snapshot(page3)
record(
  '换个浏览器配置一切从零（数据确实存在本地）',
  fresh.title === '' && fresh.fontSize === '16px',
  `title="${fresh.title}" 字号=${fresh.fontSize}`,
)
await ctx3.close()

rmSync(profile, { recursive: true, force: true })
rmSync(otherProfile, { recursive: true, force: true })

for (const r of results) if (!r.ok) console.log(`\n待修：${r.name} — ${r.detail}`)
const failed = results.filter((r) => !r.ok).length
console.log(`\n${results.length - failed}/${results.length} 通过`)
process.exit(failed ? 1 : 0)
