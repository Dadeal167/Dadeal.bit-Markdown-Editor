import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { chromium } from 'playwright-core'

const app = resolve('Dadealbit Markdown 编辑器.html')
const browser = await chromium.launch({ channel: 'msedge' })
const long = (name) => ['# ' + name, ...Array.from({ length: 90 }, (_, index) => `${name}第 ${index + 1} 段，验证光标和滚动位置。`)].join('\n\n')
const fixture = (name, source) => ({ name: name + '.md', mimeType: 'text/markdown', buffer: Buffer.from(source) })

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 820 }, acceptDownloads: true })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  const mode = page.locator('.zh-statusbar__mode')
  const tabs = page.getByRole('tablist', { name: '打开的文档' })
  const tab = (name) => tabs.getByRole('tab', { name, exact: true })
  const select = async (name) => {
    await tab(name).click()
    await tab(name).and(page.getByRole('tab', { selected: true })).waitFor()
  }
  const openMenu = () => page.getByRole('button', { name: '打开方式', exact: true }).click()
  const choose = async (entry, name, source) => {
    const pending = page.waitForEvent('filechooser')
    if (entry) {
      await openMenu()
      await page.getByRole('button', { name: entry, exact: true }).click()
    } else await page.getByTitle('打开', { exact: true }).click()
    await (await pending).setFiles(fixture(name, source))
    await tab(name).and(page.getByRole('tab', { selected: true })).waitFor()
  }
  const view = () => page.evaluate(() => ({ y: window.scrollY, cursor: window.__EDITOR__.state.selection.from }))
  const prepareView = (line) => page.evaluate((line) => {
    const editor = window.__EDITOR__
    let position
    editor.state.doc.forEach((node, offset, index) => { if (index === line) position = offset + 2 })
    editor.commands.setTextSelection(position)
    const rect = editor.view.coordsAtPos(position)
    window.scrollTo({ top: window.scrollY + rect.top - 245, behavior: 'instant' })
    return { y: window.scrollY, cursor: editor.state.selection.from }
  }, line)

  await page.goto(pathToFileURL(app).href)
  await mode.getByText('浏览器草稿', { exact: true }).waitFor()
  await choose(undefined, '题目', long('题目'))
  const first = await prepareView(35)
  await choose('导入为浏览器草稿', '解析', long('解析'))
  const second = await prepareView(24)
  await select('题目')
  assert.deepEqual(await view(), first)
  await select('解析')
  assert.deepEqual(await view(), second)

  const docBeforeUndo = await page.evaluate(() => window.__MD__())
  await page.locator('.ProseMirror').press('Control+z')
  assert.equal(await page.evaluate(() => window.__MD__()), docBeforeUndo)
  const title = page.locator('.zh-title')
  await title.fill('解析修订')
  await tab('解析修订').locator('.zh-document-tab__pending').waitFor()
  await tab('解析修订').locator('.zh-document-tab__pending').waitFor({ state: 'hidden' })
  const draftDownload = page.waitForEvent('download')
  await title.press('Control+s')
  assert.match(await readFile(await (await draftDownload).path(), 'utf8'), /# 解析/)
  await tab('解析修订').focus()
  await tab('解析修订').press('ArrowLeft')
  await tab('题目').and(page.getByRole('tab', { selected: true })).waitFor()
  await select('解析修订')
  await page.getByRole('button', { name: '关闭「解析修订」标签页' }).click()
  assert.equal(await tab('解析修订').count(), 0)
  await tab('题目').and(page.getByRole('tab', { selected: true })).waitFor()
  await page.getByRole('button', { name: '文档', exact: true }).click()
  await page.locator('.zh-docmenu__open').filter({ hasText: '解析修订' }).click()
  assert.equal(await tab('解析修订').getAttribute('aria-selected'), 'true')
  await page.keyboard.press('Control+Alt+r')
  assert.equal(await tabs.isVisible(), false)
  await page.keyboard.press('Escape')
  await page.reload()
  await tab('题目').waitFor()
  await tab('解析修订').waitFor()
  assert.deepEqual(errors, [])
  console.log('PASS: 本地草稿导入、保存下载、视图恢复、关闭与重开、撤销隔离、键盘导航和阅读模式。')

  const origin = 'http://127.0.0.1:51749/'
  const linked = await browser.newPage({ viewport: { width: 1280, height: 820 } })
  await linked.route(origin, (route) => route.fulfill({ path: app, contentType: 'text/html; charset=utf-8' }))
  await linked.addInitScript(() => {
    window.fixtureFile = async (name) => (await navigator.storage.getDirectory()).getFileHandle(name, { create: true })
    window.showOpenFilePicker = async () => { window.lastPicker = 'file'; return [await window.fixtureFile('关联文件.md')] }
    window.showDirectoryPicker = async () => {
      window.lastPicker = 'folder'
      const root = await navigator.storage.getDirectory()
      return root.getDirectoryHandle('资料', { create: true })
    }
    Object.defineProperty(FileSystemFileHandle.prototype, 'requestPermission', { configurable: true, value: async () => 'granted' })
  })
  await linked.goto(origin)
  await linked.waitForFunction(() => window.__EDITOR__?.isInitialized && window.__DOCSTORE__?.backend === 'indexeddb')
  await linked.evaluate(async () => {
    const file = await window.fixtureFile('关联文件.md')
    const writer = await file.createWritable()
    await writer.write('# 关联文件\n\n原文。\n')
    await writer.close()
    const folder = await (await navigator.storage.getDirectory()).getDirectoryHandle('资料', { create: true })
    const doc = await folder.getFileHandle('目录笔记.md', { create: true })
    const stream = await doc.createWritable()
    await stream.write('# 目录笔记\n\n来自文档文件夹。\n')
    await stream.close()
  })
  const linkedMode = linked.locator('.zh-statusbar__mode')
  const method = async (name) => {
    await linked.getByRole('button', { name: '打开方式', exact: true }).click()
    await linked.getByRole('button', { name, exact: true }).click()
  }
  const linkedTabs = linked.getByRole('tablist', { name: '打开的文档' })
  await method('打开原文件（可写回）')
  await linkedMode.getByText('已关联原文件', { exact: true }).waitFor()
  await linked.locator('.zh-statusbar__file').getByText('已保存到原文件', { exact: true }).waitFor()
  const prose = linked.locator('.ProseMirror')
  await prose.press('Control+End')
  await linked.keyboard.insertText('写回验证。')
  const linkedTab = linkedTabs.getByRole('tab', { name: '关联文件', exact: true })
  await linkedTab.locator('.zh-document-tab__pending').waitFor()
  await method('打开文档文件夹')
  await linkedTabs.getByRole('tab', { name: '目录笔记', selected: true }).waitFor()
  assert.equal(await linked.evaluate(() => window.lastPicker), 'folder')
  await linkedTab.locator('.zh-document-tab__pending').waitFor()
  await linkedTab.click()
  await prose.press('Control+s')
  await linked.locator('.zh-statusbar__file').getByText('已保存到原文件', { exact: true }).waitFor()
  await linkedTab.locator('.zh-document-tab__pending').waitFor({ state: 'hidden' })
  const diskContent = await linked.evaluate(async () => (await (await window.fixtureFile('关联文件.md')).getFile()).text())
  assert.match(diskContent, /写回验证。/)
  console.log('PASS: 原文件与文件夹入口、标签页待写回标记、切回后保存到原文件。')
} finally {
  await browser.close()
}
