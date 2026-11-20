import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { unzipSync } from 'fflate'
import { chromium } from 'playwright-core'

const browser = await chromium.launch({ channel: 'msedge' })
try {
  const page = await browser.newPage({ viewport: { width: 1320, height: 900 }, acceptDownloads: true, offline: true })
  page.setDefaultTimeout(12000)
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => { if (message.type() === 'error') console.log(message.text()) })
  await page.addInitScript(() => {
    window.print = () => {
      window.testPrint = {
        filtered: document.body.dataset.editionPrinting === 'true',
        html: document.querySelector('.zh-edition-print')?.innerHTML,
        title: document.title,
      }
    }
  })
  const app = pathToFileURL(resolve('Dadealbit Markdown 编辑器.html')).href
  const waitReady = () => page.waitForFunction(() => window.__EDITOR__?.isInitialized && window.__DOCSTORE__?.backend === 'indexeddb')
  const more = async (label) => {
    await page.getByTitle('更多', { exact: true }).click()
    await page.getByRole('button', { name: label, exact: true }).click()
  }
  const saveFormat = async (format) => {
    await page.getByTitle('保存', { exact: true }).click()
    await page.locator(`button[data-format="${format}"]`).click()
  }
  const downloaded = async (action) => {
    const pending = page.waitForEvent('download')
    await action()
    const file = await pending.catch(async (error) => {
      console.log('导出状态', await page.getByRole('alert').allTextContents(), await edition.allTextContents())
      throw error
    })
    return { name: file.suggestedFilename(), data: await readFile(await file.path()) }
  }
  const setSource = async (md) => {
    await more('编辑 Markdown 源码')
    const source = page.getByRole('dialog', { name: 'Markdown 源码' })
    await source.getByRole('textbox', { name: '编辑 Markdown 源码' }).fill(md)
    await source.getByRole('button', { name: '应用更改', exact: true }).click()
  }
  const edition = page.getByRole('dialog', { name: '一稿多版', exact: true })
  const studentPreview = page.frameLocator('iframe[title="学生版预览"]').locator('body')
  const teacherPreview = page.frameLocator('iframe[title="教师版预览"]').locator('body')
  const chooseEdition = (value) => edition.getByLabel('版本', { exact: true }).selectOption(value)
  const chooseFormat = (value) => edition.getByLabel('格式', { exact: true }).selectOption(value)
  const materials = [
    '## 练习题', '', '这道题应始终保留。', '',
    '$$\na=1\\label{eq:first}\n$$', '', '可用因式分解。', '',
    '<!-- dadealbit:edition answer -->', '', '唯一答案是四十二。', '', '<!-- /dadealbit:edition -->', '',
    '<!-- dadealbit:edition solution -->', '', '这里写完整推导。', '', '$$', 'b=42\\label{eq:hidden}', '$$', '',
    '|条件|结论|', '|---|---|', '| $\\lvert t\\rvert$ | $|x|$ |', '', '<!-- /dadealbit:edition -->', '',
    '以下是下一问。', '', '$$\nc=3\\label{eq:last}\n$$', '', '见 $\\eqref{eq:last}$。', '',
  ].join('\n')
  await page.goto(app)
  await waitReady()
  await page.locator('.zh-title').fill('分版练习')
  await setSource(materials)
  const blocks = page.locator('.ProseMirror .zh-edition-block')
  assert.equal(await blocks.count(), 2)
  await page.evaluate(() => {
    const editor = window.__EDITOR__
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'paragraph' && node.textContent === '可用因式分解。') {
        editor.commands.setTextSelection({ from: pos + 1, to: pos + node.nodeSize - 1 })
      }
    })
  })
  await more('标记提示、答案或解析')
  await page.getByRole('button', { name: '标记为提示', exact: true }).click()
  assert.equal(await blocks.count(), 3)
  const hint = blocks.filter({ hasText: '可用因式分解。' })
  assert.equal(await hint.getByLabel('分版块类型').inputValue(), 'hint')
  await hint.getByLabel('分版块类型').selectOption('answer')
  await hint.getByRole('button', { name: '转为正文' }).click()
  assert.equal(await blocks.count(), 2)
  await page.keyboard.press('Control+z')
  assert.equal(await blocks.count(), 3)
  await hint.getByLabel('分版块类型').selectOption('hint')

  const archive = await downloaded(() => saveFormat('plain'))
  const master = archive.data.toString('utf8')
  for (const key of ['hint', 'answer', 'solution']) assert.match(master, new RegExp(`<!-- dadealbit:edition ${key} -->`))
  assert.match(master, /\\\|x\\\|/)
  await setSource(master)
  assert.equal(await blocks.count(), 3)
  await page.getByText('草稿已自动保存', { exact: true }).waitFor()
  await page.reload()
  await waitReady()
  assert.equal(await blocks.count(), 3)
  const current = () => page.evaluate(() => window.__EDITOR__.getJSON())
  const original = await current()

  await saveFormat('docx')
  await studentPreview.getByText('这道题应始终保留。').waitFor()
  assert.equal(await studentPreview.getByText(/因式分解|四十二|完整推导/).count(), 0)
  assert.match(await studentPreview.innerText(), /见 \(2\)/)
  await chooseEdition('teacher')
  await teacherPreview.getByText('唯一答案是四十二。').waitFor()
  assert.match(await teacherPreview.innerText(), /见 \(3\)/)
  await chooseFormat('plain')
  const teacher = await downloaded(() => edition.getByRole('button', { name: '导出教师版', exact: true }).click())
  assert.match(teacher.name, /教师版\.md$/)
  assert.match(teacher.data.toString('utf8'), /完整推导/)
  assert.doesNotMatch(teacher.data.toString('utf8'), /dadealbit:edition/)

  await saveFormat('docx')
  const student = await downloaded(() => edition.getByRole('button', { name: '导出学生版', exact: true }).click())
  assert.match(student.name, /学生版\.docx$/)
  const word = unzipSync(student.data)
  const xml = new TextDecoder().decode(word['word/document.xml'])
  assert.match(xml, /这道题应始终保留/)
  assert.doesNotMatch(xml, /因式分解|四十二|完整推导/)
  assert.match(xml, /<m:oMath/)

  await saveFormat('pdf')
  await edition.getByRole('button', { name: '导出学生版', exact: true }).click()
  await page.waitForFunction(() => window.testPrint)
  const print = await page.evaluate(() => window.testPrint)
  assert.equal(print.filtered, true)
  assert.match(print.title, /学生版$/)
  assert.match(print.html, /这道题应始终保留/)
  assert.doesNotMatch(print.html, /因式分解|四十二|完整推导/)
  assert.equal(await page.locator('.zh-edition-print').count(), 0)

  await saveFormat('editions')
  await chooseEdition('zhihu')
  const zhihu = await downloaded(() => edition.getByRole('button', { name: '导出知乎版', exact: true }).click())
  assert.match(zhihu.name, /知乎版\.md$/)
  assert.match(zhihu.data.toString('utf8'), /四十二/)
  assert.doesNotMatch(zhihu.data.toString('utf8'), /dadealbit:edition/)
  assert.deepEqual(await current(), original)

  await setSource(master + '\n\n引用隐藏公式 $\\eqref{eq:hidden}$。')
  await saveFormat('editions')
  await edition.getByRole('alert').filter({ hasText: /无法解析的引用/ }).waitFor()
  assert.equal(await edition.getByRole('button', { name: '导出学生版' }).isDisabled(), true)
  await chooseEdition('teacher')
  await teacherPreview.getByText('这里写完整推导。').waitFor()
  assert.equal(await edition.getByRole('button', { name: '导出教师版' }).isEnabled(), true)
  await edition.getByRole('button', { name: '返回原稿' }).click()
  console.log('PASS: 分版块操作、重开存档、学生/教师/知乎预览、Word 与打印内容、引用检查及原稿保持。')

  const visibleBefore = await current()
  const prose = page.locator('.ProseMirror')
  await page.getByTitle('界面', { exact: true }).click()
  await page.getByRole('button', { name: '阅读模式', exact: true }).click()
  await page.getByRole('button', { name: '退出阅读模式' }).waitFor()
  assert.equal(await page.getByRole('region', { name: '编辑工具栏' }).isVisible(), false)
  assert.equal(await page.locator('.zh-statusbar').isVisible(), false)
  assert.equal(await prose.getAttribute('contenteditable'), 'false')
  assert.equal(await page.locator('.zh-title').evaluate(node => node.readOnly), true)
  assert.deepEqual(await page.locator('.editor-card').evaluate(node => {
    const style = getComputedStyle(node)
    return [style.borderTopWidth, style.borderBottomWidth]
  }), ['0px', '0px'])
  await page.locator('.zh-title').focus()
  await page.keyboard.type('禁止修改标题')
  assert.equal(await page.locator('.zh-title').inputValue(), '分版练习')
  await prose.getByText('这道题应始终保留。', { exact: true }).click()
  await page.keyboard.type('禁止修改正文')
  await page.keyboard.press('Control+z')
  await page.keyboard.press('Control+Alt+n')
  await page.locator('.math-node').first().click()
  assert.equal(await page.getByRole('dialog').count(), 0)
  await prose.dispatchEvent('paste', { clipboardData: await page.evaluateHandle(() => {
    const data = new DataTransfer()
    data.setData('text/plain', '禁止粘贴修改')
    return data
  }) })
  await page.evaluate(() => window.__EDITOR__.commands.insertContent('<p>禁止绕过输入锁</p>'))
  assert.deepEqual(await current(), visibleBefore)
  await page.keyboard.press('Escape')
  await page.getByRole('region', { name: '编辑工具栏' }).waitFor()
  assert.equal(await prose.getAttribute('contenteditable'), 'true')
  await page.keyboard.press('Control+Alt+r')
  await page.getByRole('button', { name: '退出阅读模式' }).click()
  await page.getByRole('region', { name: '编辑工具栏' }).waitFor()
  await page.locator('.zh-title').fill('继续编辑')
  assert.equal(await page.locator('.zh-title').inputValue(), '继续编辑')
  assert.deepEqual(errors, [])
  console.log('PASS: 阅读模式无上下工具栏，标题、键入、粘贴、快捷键和正文变更均受锁定，退出后恢复编辑。')
} finally { await browser.close() }
