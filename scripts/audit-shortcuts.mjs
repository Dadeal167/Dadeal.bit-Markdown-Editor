/**
 * 自定义快捷键体检：默认键位 / 改键 / 旧键失效 / 冲突处理 / 清除 / 持久化 / 恢复默认 / 帮助同步
 * 前提：pnpm dev 已运行
 */
import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

const OUT = resolve('.probe')
mkdirSync(OUT, { recursive: true })
const BASE = 'http://127.0.0.1:5173/'
const KEY = 'md-editor-shortcuts-v1'

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
const stored = () =>
  page.evaluate((k) => {
    const raw = localStorage.getItem(k)
    return raw ? JSON.parse(raw) : null
  }, KEY)
const focusEnd = () => page.evaluate(() => window.__EDITOR__.commands.focus('end'))
const openShortcuts = async () => {
  if (await page.locator('.zh-modal--shortcuts').isVisible().catch(() => false)) return
  if (await page.locator('.zh-modal-mask').isVisible().catch(() => false)) {
    await page.keyboard.press('Escape')
    await page.waitForTimeout(200)
  }
  await page.locator('.zh-btn[title="更多"]').click()
  await page.waitForTimeout(200)
  await page.locator('.zh-menu__item', { hasText: '自定义快捷键' }).click()
  await page.waitForSelector('.zh-modal--shortcuts', { timeout: 4000 })
}
/** 设置里某一行的按键按钮 / 当前显示 */
const keyButton = (label) => page.locator('.zh-scrow', { hasText: label }).first().locator('.zh-sckey')
const keyText = (label) => keyButton(label).innerText()
const clearDoc = async () => {
  await page.evaluate(() => window.__EDITOR__.commands.clearContent())
  await page.waitForTimeout(250)
}
/** 清空并把残留的 stored marks（比如上次按了加粗）也清掉，否则测不出真实的按键效果 */
const resetForTyping = async () => {
  await clearDoc()
  await page.evaluate(() => {
    const ed = window.__EDITOR__
    if (ed.state.storedMarks?.length) ed.chain().unsetAllMarks().run()
    ed.commands.focus('end')
  })
  await page.waitForTimeout(200)
}

await page.goto(BASE, { waitUntil: 'load', timeout: 60000 })
await ready()
await page.evaluate((k) => localStorage.removeItem(k), KEY)
await page.reload({ waitUntil: 'load' })
await ready()

/* ---------- 1. 默认键位 ---------- */
await resetForTyping()
await page.keyboard.press('Control+b')
await page.keyboard.type('加粗X')
await page.waitForTimeout(300)
const boldMd = await md()
record('默认 Ctrl+B 能加粗', boldMd.includes('**加粗X**'), `md="${boldMd.trim().slice(-20)}"`)

/* ---------- 2. 面板显示默认键位 ---------- */
await openShortcuts()
record('设置面板列出动作', (await page.locator('.zh-scrow').count()) >= 25, `${await page.locator('.zh-scrow').count()} 项`)
record('加粗当前显示 Ctrl + B', (await keyText('加粗')) === 'Ctrl + B', await keyText('加粗'))

/* ---------- 3. 录制时按 Escape 取消 ---------- */
await keyButton('加粗').click()
await page.waitForTimeout(200)
const recordingText = await keyText('加粗')
await page.keyboard.press('Escape')
await page.waitForTimeout(200)
record(
  '录制中显示提示且 Esc 可取消',
  recordingText.includes('按下新键') && (await keyText('加粗')) === 'Ctrl + B',
  `录制态="${recordingText}"，取消后="${await keyText('加粗')}"`,
)

/* ---------- 4. 无修饰键被拒绝 ---------- */
await keyButton('加粗').click()
await page.keyboard.press('k')
await page.waitForTimeout(250)
const noteText = await page.locator('.zh-scnote').innerText()
await page.keyboard.press('Escape')
await page.waitForTimeout(200)
record('不带动词键的按键被拒绝', noteText.includes('Ctrl'), `提示="${noteText.slice(0, 30)}"`)

/* ---------- 5. 改键：加粗 → Ctrl+Shift+B ---------- */
await keyButton('加粗').click()
await page.keyboard.press('Control+Shift+b')
await page.waitForTimeout(300)
record('改键后显示新键位', (await keyText('加粗')) === 'Ctrl + Shift + B', await keyText('加粗'))
await page.keyboard.press('Escape') // 关闭设置面板
await page.waitForTimeout(300)
if (await page.locator('.zh-modal--shortcuts').isVisible().catch(() => false)) {
  await page.locator('.zh-modal--shortcuts .zh-btn-confirm').click()
  await page.waitForTimeout(300)
}
record('改完键后能关闭设置面板', !(await page.locator('.zh-modal--shortcuts').isVisible().catch(() => false)))

await resetForTyping()
await page.keyboard.press('Control+Shift+b')
await page.keyboard.type('新键X')
await page.waitForTimeout(300)
const newKeyMd = await md()
record('新键位生效（Ctrl+Shift+B 加粗）', newKeyMd.includes('**新键X**'), `md="${newKeyMd.trim().slice(-20)}"`)

await resetForTyping()
await page.keyboard.press('Control+b')
await page.keyboard.type('旧键Y')
await page.waitForTimeout(300)
const staleMd = await md()
record(
  '旧键位不再触发（被吞掉）',
  staleMd.includes('旧键Y') && !staleMd.includes('**旧键Y**'),
  `md="${staleMd.trim().slice(-20)}"`,
)

/* ---------- 6. 冲突处理 ---------- */
await openShortcuts()
await keyButton('斜体').click()
await page.keyboard.press('Control+Shift+b')
await page.waitForTimeout(300)
const conflictNote = await page.locator('.zh-scnote').innerText()
const boldAfter = await keyText('加粗')
record(
  '冲突键会解绑原来的动作并提示',
  conflictNote.includes('加粗') && boldAfter === '未绑定',
  `提示="${conflictNote}"，加粗=${boldAfter}`,
)
// 「全部恢复默认」收尾
await page.locator('.zh-scftmp, .zh-scfoot button', { hasText: '全部恢复默认' }).click()
await page.waitForTimeout(300)
record('全部恢复默认', (await keyText('加粗')) === 'Ctrl + B' && (await keyText('斜体')) === 'Ctrl + I')

// 默认键位必须和规范化格式一致（曾经因为默认写成小写 Mod-b、规范化输出大写 Mod-B，
// 导致所有快捷键都匹配不上——加这条防止再犯）
const allKeys = await page.locator('.zh-sckey').allInnerTexts()
const badCase = allKeys.filter((k) => /[a-z]/.test(k.replace(/Ctrl|Alt|Shift|未绑定|按下新键…/g, '')))
record(
  '默认键位格式统一（无小写残留）',
  badCase.length === 0,
  badCase.length ? `可疑：${badCase.join(' / ')}` : `${allKeys.length} 项全部规范`,
)

/* ---------- 7. 清除某个快捷键 ---------- */
await page.locator('.zh-scrow', { hasText: '代码块' }).first().locator('.zh-scrow__clear').click()
await page.waitForTimeout(300)
record('可以清除单项快捷键', (await keyText('代码块')) === '未绑定', await keyText('代码块'))
await page.locator('.zh-scrow', { hasText: '代码块' }).first().locator('.zh-scrow__reset').click()
await page.waitForTimeout(300)
record('可以单项恢复默认', (await keyText('代码块')) === 'Ctrl + Alt + C', await keyText('代码块'))

/* ---------- 8. 持久化 ---------- */
await keyButton('加粗').click()
await page.keyboard.press('Control+Alt+b')
await page.waitForTimeout(300)
await page.keyboard.press('Escape')
await page.waitForTimeout(300)
const saved = await stored()
record('设置写入 localStorage', saved?.bold === 'Mod-Alt-B', JSON.stringify(saved?.bold))

await page.reload({ waitUntil: 'load' })
await ready()
await resetForTyping()
await page.keyboard.press('Control+Alt+b')
await page.keyboard.type('持久X')
await page.waitForTimeout(300)
const persistMd = await md()
record('刷新后自定义键位仍生效', persistMd.includes('**持久X**'), `md="${persistMd.trim().slice(-20)}"`)

/* ---------- 9. 非编辑类：Ctrl+S 保存 ---------- */
await page.evaluate(() => window.__EDITOR__.commands.setContent('# 快捷键保存测试'))
await page.waitForTimeout(600)
const [dl] = await Promise.all([
  page.waitForEvent('download', { timeout: 8000 }),
  page.keyboard.press('Control+s'),
])
record('Ctrl+S 触发保存 .md', dl.suggestedFilename().endsWith('.md'), dl.suggestedFilename())

/* ---------- 10. 帮助弹窗显示当前键位 ---------- */
await page.locator('.zh-btn[title="更多"]').click()
await page.waitForTimeout(200)
await page.locator('.zh-menu__item', { hasText: '快捷键帮助' }).click()
await page.waitForSelector('.zh-modal--help', { timeout: 4000 })
const helpText = await page.locator('.zh-modal--help').innerText()
record('帮助里显示的是用户改过的键位', helpText.includes('Ctrl + Alt + B'), helpText.split('\n').slice(0, 6).join(' / '))
await page.screenshot({ path: resolve(OUT, 'shortcuts-help.png') })
await page.keyboard.press('Escape')
await page.waitForTimeout(300)
record('弹窗支持 Esc 关闭', !(await page.locator('.zh-modal--help').isVisible().catch(() => false)))

/* ---------- 11. 在标题框里按 Ctrl+B 不该加粗正文 ---------- */
await page.locator('.zh-title').click()
await focusEnd()
const beforeTitle = await md()
await page.keyboard.press('Control+Alt+b')
await page.waitForTimeout(300)
record('焦点在标题里时不触发编辑类快捷键', (await md()) === beforeTitle)

await openShortcuts()
await page.screenshot({ path: resolve(OUT, 'shortcuts-modal.png') })
record('全程控制台无错误', errors.length === 0, errors.length ? errors.slice(0, 3).join(' | ').slice(0, 240) : '无')

await browser.close()
for (const r of results) if (!r.ok) console.log(`\n待修：${r.name} — ${r.detail}`)
const failed = results.filter((r) => !r.ok).length
console.log(`\n${results.length - failed}/${results.length} 通过`)
process.exit(failed ? 1 : 0)
