/**
 * 多文档管理体检：新建 / 切换 / 删除 / 旧草稿迁移 / 刷新保持 / 打开文件成新文档
 * 前提：pnpm dev 已运行
 */
import { chromium } from 'playwright-core'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { tmpdir } from 'node:os'

const OUT = resolve('.probe')
mkdirSync(OUT, { recursive: true })
const BASE = 'http://127.0.0.1:5173/'
const DOCS_KEY = 'md-editor-docs-v1'
const LEGACY_KEY = 'md-editor-draft-v1'

const results = []
const record = (name, ok, detail = '') => {
  results.push({ name, ok, detail })
  console.log(`${ok ? '✅' : '❌'}  ${name}${detail ? '  — ' + detail : ''}`)
}

const browser = await chromium.launch({ channel: 'msedge', headless: true })

/* ---------- 1. 旧单草稿迁移（要在页面加载前就把旧数据塞进去） ----------
   注意：不能先开页面再改 localStorage——reload 会触发 beforeunload 保存，
   把当前（示例）文档写回新存储，迁移分支就永远走不到了。 */
const migrationCtx = await browser.newContext({ viewport: { width: 1360, height: 900 } })
await migrationCtx.addInitScript(
  ([docsKey, legacyKey]) => {
    if (!sessionStorage.getItem('__seeded')) {
      sessionStorage.setItem('__seeded', '1')
      localStorage.removeItem(docsKey)
      localStorage.setItem(
        legacyKey,
        JSON.stringify({ title: '旧草稿标题', md: '# 旧草稿\n\n这是老版本留下的内容。', at: Date.now() - 86400000 }),
      )
    }
  },
  [DOCS_KEY, LEGACY_KEY],
)
const migPage = await migrationCtx.newPage()
await migPage.goto(BASE, { waitUntil: 'load', timeout: 60000 })
await migPage.waitForSelector('.ProseMirror', { timeout: 30000 })
await migPage.waitForTimeout(1300)
const migrated = await migPage.evaluate((k) => {
  const raw = localStorage.getItem(k)
  return raw ? JSON.parse(raw) : null
}, DOCS_KEY)
record(
  '旧单草稿自动迁移成文档',
  !!migrated && migrated.docs.length === 1 && migrated.docs[0].md.includes('老版本留下的内容'),
  migrated ? `${migrated.docs.length} 篇，标题="${migrated.docs[0].title}"` : '没有迁移',
)
record('迁移后标题一并恢复', (await migPage.locator('.zh-title').inputValue()) === '旧草稿标题')
await migrationCtx.close()

/* ---------- 其余检查：全新浏览器上下文 ---------- */
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
const store = () =>
  page.evaluate((k) => {
    const raw = localStorage.getItem(k)
    return raw ? JSON.parse(raw) : null
  }, DOCS_KEY)
const openMenu = async () => {
  // 幂等：已经开着就别再点（再点会把它收起来）
  if (await page.locator('.zh-docmenu').isVisible().catch(() => false)) return
  await page.locator('.zh-btn[title^="我的文档"]').click()
  await page.waitForSelector('.zh-docmenu', { timeout: 4000 })
}
const closeMenu = async () => {
  await page.keyboard.press('Escape')
  await page.waitForTimeout(200)
}

await page.goto(BASE, { waitUntil: 'load', timeout: 60000 })
await ready()

/* ---------- 2. 新建文档 ---------- */
await openMenu()
const countBefore = (await store()).docs.length
await page.locator('.zh-docmenu__new').click()
await page.waitForTimeout(700)
const afterCreate = await store()
record(
  '新建文档：数量 +1 且切换过去',
  afterCreate.docs.length === countBefore + 1 && afterCreate.currentId === afterCreate.docs[0].id,
  `${countBefore} → ${afterCreate.docs.length} 篇`,
)
record('新建后正文是空的', (await md()).trim() === '' && (await page.locator('.zh-title').inputValue()) === '')

/* ---------- 3. 在新文档里写内容，再切回旧文档 ---------- */
await page.evaluate(() => window.__EDITOR__.commands.focus('start'))
await page.keyboard.type('新文档里的内容')
await page.locator('.zh-title').fill('函数笔记')
await page.waitForTimeout(1800)
await openMenu()
const listText = await page.locator('.zh-docmenu__list').innerText()
record('列表显示标题与时间', listText.includes('函数笔记'), listText.replace(/\n/g, ' | ').slice(0, 80))
await page.screenshot({ path: resolve(OUT, 'docs-menu.png') })

await page.locator('.zh-docmenu__open', { hasText: '欢迎使用' }).click()
await page.waitForTimeout(800)
const backMd = await md()
record('切回另一篇：内容还在', backMd.includes('欢迎使用'), `md 长度 ${backMd.length}`)
record('切回另一篇：标题跟着切', (await page.locator('.zh-title').inputValue()) === '')

/* ---------- 4. 再切到新文档：刚才写的内容在 ---------- */
await openMenu()
await page.locator('.zh-docmenu__open', { hasText: '函数笔记' }).click()
await page.waitForTimeout(800)
record('切回新文档：写的内容还在', (await md()).includes('新文档里的内容'))

/* ---------- 5. 刷新后仍停在当前这篇 ---------- */
await page.reload({ waitUntil: 'load' })
await ready()
record(
  '刷新后仍停在当前文档',
  (await page.locator('.zh-title').inputValue()) === '函数笔记' && (await md()).includes('新文档里的内容'),
)

/* ---------- 6. 打开 .md 变成新文档 ---------- */
const importedFile = resolve(tmpdir(), 'multi-doc-import.md')
writeFileSync(importedFile, '# 导入的文档\n\n来自外部文件。$a^2+b^2=c^2$\n', 'utf-8')
const countBeforeImport = (await store()).docs.length
const [chooser] = await Promise.all([
  page.waitForEvent('filechooser', { timeout: 6000 }),
  page.locator('.zh-btn[title="打开"]').click(),
])
await chooser.setFiles(importedFile)
await page.waitForTimeout(1200)
const afterImport = await store()
record(
  '打开 .md 变成一篇新文档（不覆盖原文档）',
  afterImport.docs.length === countBeforeImport + 1 && (await md()).includes('来自外部文件'),
  `${countBeforeImport} → ${afterImport.docs.length} 篇`,
)
record('导入文档的标题取自文件名', (await page.locator('.zh-title').inputValue()) === 'multi-doc-import')
record(
  '导入后原文档内容未被覆盖',
  afterImport.docs.some((d) => d.title === '函数笔记' && d.md.includes('新文档里的内容')),
)

/* ---------- 7. 删除文档 ---------- */
await openMenu()
const countBeforeDel = (await store()).docs.length
page.once('dialog', (d) => d.accept())
await page.locator('.zh-docmenu__item', { hasText: 'multi-doc-import' }).locator('.zh-docmenu__del').click()
await page.waitForTimeout(800)
const afterDel = await store()
record(
  '删除文档：数量 -1 并自动切到别的文档',
  afterDel.docs.length === countBeforeDel - 1 && afterDel.docs.some((d) => d.id === afterDel.currentId),
  `${countBeforeDel} → ${afterDel.docs.length} 篇`,
)
record('删除后编辑器内容跟着换', (await md()).length > 0)

/* ---------- 8. 只剩一篇时不允许再删（全程走 UI，不直接改存储） ---------- */
let guard = 0
while ((await store()).docs.length > 1 && guard < 6) {
  await openMenu()
  page.once('dialog', (d) => d.accept())
  // 删非当前那一篇，避免切文档干扰
  const current = (await store()).currentId
  const items = page.locator('.zh-docmenu__item')
  const total = await items.count()
  let clicked = false
  for (let i = 0; i < total; i += 1) {
    const row = items.nth(i)
    const isActive = (await row.getAttribute('class'))?.includes('--active')
    if (!isActive) {
      await row.locator('.zh-docmenu__del').click()
      clicked = true
      break
    }
  }
  await page.waitForTimeout(700)
  if (!clicked) break
  guard += 1
}
const leftCount = (await store()).docs.length
record('可以一路删到只剩一篇', leftCount === 1, `剩 ${leftCount} 篇（当前 ${(await store()).currentId}）`)

await openMenu()
let alerted = ''
page.once('dialog', (d) => {
  alerted = d.message()
  d.accept()
})
await page.locator('.zh-docmenu__del').first().click()
await page.waitForTimeout(600)
record(
  '只剩一篇时拦下删除',
  (await store()).docs.length === 1 && alerted.includes('至少要留一篇'),
  `alert="${alerted}"`,
)
await closeMenu()

await closeMenu()
record('全程控制台无错误', errors.length === 0, errors.length ? errors.slice(0, 3).join(' | ').slice(0, 240) : '无')

await browser.close()
for (const r of results) if (!r.ok) console.log(`\n待修：${r.name} — ${r.detail}`)
const failed = results.filter((r) => !r.ok).length
console.log(`\n${results.length - failed}/${results.length} 通过`)
process.exit(failed ? 1 : 0)
