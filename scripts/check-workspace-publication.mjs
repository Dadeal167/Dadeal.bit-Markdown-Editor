import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium } from 'playwright-core'
import { unzipSync } from 'fflate'
import { gifInfo, makeAnimatedGif } from './make-test-gif.mjs'

const app = resolve('Dadealbit Markdown 编辑器.html')
const browser = await chromium.launch({ channel: 'msedge' })
const url = 'http://127.0.0.1:51739/'
const animation = makeAnimatedGif()
const target = '讲义/二次方程.md'
const renamed = '讲义/二次方程题解.md'
const targetText = '\uFEFF---\r\ntitle: 二次方程\r\n---\r\n\r\n# 二次方程\r\n\r\n## 第二问\r\n\r\n令 $x^2=1$。\r\n'
const indexText = [
  '# 目录', '', '详见 [[讲义/二次方程#第二问|第二问解析]]。', '',
  '正文中的 `[[讲义/二次方程]]` 不应形成反向链接。', '',
  '> ```text\n> [[讲义/二次方程]]\n> ```', '',
  '公式 $\\text{[[讲义/二次方程]]}$ 的原文也应保留。', '',
  '| 题目 |\n| --- |\n| [[讲义/二次方程\\|题解]] |', '',
  '[标准链接](讲义/二次方程.md#第二问 "说明")。参见[引用链接][solution]。',
  '', '[solution]: <讲义/二次方程.md> "参考题解"', '',
].join('\n')
const utf8 = new TextDecoder('utf-8', { ignoreBOM: true })

try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, acceptDownloads: true })
  page.setDefaultTimeout(12000)
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.route(url, (route) => route.fulfill({ path: app, contentType: 'text/html; charset=utf-8' }))
  await page.addInitScript(() => {
    async function folder(path, create) {
      let dir = await navigator.storage.getDirectory()
      for (const part of path) dir = await dir.getDirectoryHandle(part, { create })
      return dir
    }
    window.showDirectoryPicker = async () => folder(window.testSelectedFolder ?? [], false)
    window.testWorkspaceFile = async (path, content) => {
      const parts = path.split('/')
      const name = parts.pop()
      const directory = await folder(parts, content !== undefined)
      const handle = await directory.getFileHandle(name, { create: content !== undefined })
      if (content !== undefined) {
        const stream = await handle.createWritable()
        await stream.write(Array.isArray(content) ? Uint8Array.from(content) : content)
        await stream.close()
      }
      const bytes = await (await handle.getFile()).arrayBuffer()
      return Array.from(new Uint8Array(bytes))
    }
    if (!FileSystemFileHandle.prototype.requestPermission) {
      FileSystemFileHandle.prototype.requestPermission = async () => 'granted'
    }
    const createWritable = FileSystemFileHandle.prototype.createWritable
    FileSystemFileHandle.prototype.createWritable = function (options) {
      if (window.failWriteTo === this.name) throw new Error('测试写入失败')
      return createWritable.call(this, options)
    }
    window.print = () => { window.printed = true }
  })
  const ready = () => page.waitForFunction(() => window.__EDITOR__?.isInitialized && window.__DOCSTORE__?.backend === 'indexeddb')
  const disk = async (path, content) => utf8.decode(Uint8Array.from(await page.evaluate(({ path, content }) =>
    window.testWorkspaceFile(path, content), { path, content })))
  const more = async (name) => {
    await page.getByTitle('更多', { exact: true }).click()
    await page.getByText(name, { exact: true }).click()
  }
  const saveFormat = async (format) => {
    await page.getByTitle('保存', { exact: true }).click()
    await page.locator(`button[data-format="${format}"]`).click()
  }
  const downloads = async (format) => {
    const pending = page.waitForEvent('download')
    await saveFormat(format)
    const file = await pending
    return unzipSync(new Uint8Array(await readFile(await file.path())))
  }
  const sourceEdit = async () => {
    await more('编辑 Markdown 源码')
    const modal = page.getByRole('dialog', { name: 'Markdown 源码' })
    return { modal, input: modal.getByRole('textbox', { name: '编辑 Markdown 源码' }) }
  }
  const waitSaved = () => page.locator('.zh-statusbar__file').getByText('已保存到原文件', { exact: true }).waitFor()

  await page.goto(url)
  await ready()
  await disk('目录.md', indexText)
  await disk(target, targetText)
  const supplement = '[补充题解](讲义/二次方程.md)\n'
  await disk('Z.md', supplement)
  await disk('讲义/备份/二次方程.md', '# 同名文档\n')
  await more('本地工作区')
  const workspace = page.getByRole('complementary', { name: '本地工作区' })
  const tree = workspace.getByRole('navigation', { name: '工作区文件' })
  const prose = page.locator('.zh-prose')
  const search = workspace.getByRole('searchbox', { name: '搜索工作区' })
  await search.fill('x^2=1')
  const results = workspace.getByRole('list', { name: '工作区搜索结果' })
  await page.evaluate(() => {
    const scroll = Element.prototype.scrollIntoView
    Element.prototype.scrollIntoView = function (options) {
      const formula = this.matches('.math-node[data-latex]') ? this : this.querySelector(':scope > .math-node[data-latex]')
      if (formula && this.closest('.zh-prose')) window.workspaceSearchScroll = formula.getAttribute('data-latex')
      return scroll.call(this, options)
    }
  })
  await results.getByRole('button', { name: /讲义\/二次方程.md.*公式/ }).click()
  await prose.getByRole('heading', { name: '第二问', exact: true }).waitFor()
  await page.waitForFunction(() => window.workspaceSearchScroll === 'x^2=1')
  await search.fill('同名文档')
  await results.getByRole('button', { name: /讲义\/备份\/二次方程.md.*同名文档/ }).waitFor()
  await search.fill('')
  await tree.getByRole('button', { name: '目录.md', exact: true }).click()
  await prose.getByRole('heading', { name: '目录', exact: true }).waitFor()
  await waitSaved()
  assert.match(await page.evaluate(() => window.__MD__()), /\[\[讲义\/二次方程\\\|题解\]\]/)
  await prose.getByRole('link', { name: '第二问解析', exact: true }).click()
  await prose.getByRole('heading', { name: '第二问', exact: true }).waitFor()
  await waitSaved()
  assert.equal(await page.evaluate(() => window.__EDITOR__.state.selection.$from.parent.textContent), '第二问')
  await workspace.getByRole('button', { name: '目录.md （4）', exact: true }).waitFor()

  await workspace.getByRole('button', { name: '重命名当前文件' }).click()
  const rename = page.getByRole('dialog', { name: '重命名工作区文档' })
  await rename.getByRole('textbox', { name: '新文件名' }).fill('二次方程题解')
  await rename.getByRole('button', { name: '预览重命名' }).click()
  await rename.getByText('将更新 2 个文件中的 5 处文件引用。', { exact: true }).waitFor()
  assert.equal(await disk(target), targetText)
  assert.equal(await disk('目录.md'), indexText)
  await disk('目录.md', indexText + '\n外部更改\n')
  await rename.getByRole('button', { name: '确认重命名并更新引用' }).click()
  await rename.getByRole('alert').getByText(/预览后有文件发生变化/).waitFor()
  assert.equal(await disk(target), targetText)
  await assert.rejects(disk(renamed), /NotFoundError/)
  await disk('目录.md', indexText)
  await page.evaluate(() => { window.failWriteTo = 'Z.md' })
  await rename.getByRole('button', { name: '确认重命名并更新引用' }).click()
  await rename.getByRole('alert').getByText('测试写入失败', { exact: true }).waitFor()
  assert.equal(await disk('目录.md'), indexText)
  assert.equal(await disk('Z.md'), supplement)
  assert.equal(await disk(target), targetText)
  await assert.rejects(disk(renamed), /NotFoundError/)
  await page.evaluate(() => { window.failWriteTo = undefined })
  await rename.getByRole('button', { name: '确认重命名并更新引用' }).click()
  await rename.waitFor({ state: 'hidden' })
  await tree.getByRole('button', { name: '二次方程题解.md', exact: true }).waitFor()
  await waitSaved()
  assert.equal(await disk(renamed), targetText)
  await assert.rejects(disk(target), /NotFoundError/)
  const after = await disk('目录.md')
  assert.match(after, /\[\[讲义\/二次方程题解#第二问\|第二问解析\]\]/)
  assert.match(after, /\[\[讲义\/二次方程题解\\\|题解\]\]/)
  assert.ok(after.includes('[标准链接](讲义/二次方程题解.md#第二问 "说明")'))
  assert.ok(after.includes('[solution]: <讲义/二次方程题解.md> "参考题解"'))
  assert.equal(await disk('Z.md'), '[补充题解](讲义/二次方程题解.md)\n')
  assert.equal(after.split('[[讲义/二次方程]]').length - 1, 3)

  await page.reload()
  await ready()
  await tree.getByRole('button', { name: '二次方程题解.md', exact: true }).waitFor()
  await waitSaved()
  await page.evaluate((bytes) => {
    const editor = window.__EDITOR__
    editor.commands.focus('end')
    const data = new DataTransfer()
    data.items.add(new File([Uint8Array.from(bytes)], 'animation.gif', { type: 'image/gif' }))
    editor.view.dom.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }))
  }, [...animation])
  await prose.locator('img[src^="data:image/gif"]').waitFor()
  await page.waitForFunction(() => /dadealbit-asset:assets%2Fclipboard-.+\.gif/.test(window.__MD__()))
  await page.keyboard.press('Control+s')
  await waitSaved()
  const savedMd = await disk(renamed)
  const localAsset = '讲义/' + savedMd.match(/\((assets\/clipboard-[a-f0-9-]+\.gif)\)/)[1]
  const asset = await page.evaluate((path) => window.testWorkspaceFile(path), localAsset)
  assert.deepEqual(Buffer.from(asset), animation)
  const zip = await downloads('zip')
  const packedMd = utf8.decode(Object.entries(zip).find(([path]) => path.endsWith('.md'))[1])
  assert.match(packedMd, /!\[animation.gif\]\(assets\/image-1.gif\)/)
  assert.deepEqual(Buffer.from(zip['assets/image-1.gif']), animation)
  assert.ok(gifInfo(Buffer.from(zip['assets/image-1.gif'])).frames >= 2)

  const { modal, input } = await sourceEdit()
  const source = [
    '# 新讲义', '### 跳级标题', '正文含 $x^2=1$ 和 **加粗**。',
    '[[/目录#目录]] 与 [缺失](../缺失.md)。', '|A|B|\n|:---:|---:|\n|一|二|',
  ].join('\n\n')
  await input.fill(source)
  const preview = page.frameLocator('iframe[title="Markdown 排版预览"]')
  await preview.locator('math').waitFor()
  await preview.getByText('加粗', { exact: true }).waitFor()
  await modal.getByRole('button', { name: '检查格式', exact: true }).click()
  await modal.getByRole('button', { name: /标题层级从 H1 跳至 H3/ }).click()
  assert.equal(await input.evaluate((field) => field.value.slice(field.selectionStart, field.selectionEnd)), '### 跳级标题')
  await modal.getByRole('button', { name: /找不到或无法读取本地链接/ }).waitFor()
  await modal.getByRole('button', { name: '预览格式修复', exact: true }).click()
  assert.match(await modal.locator('[data-change="added"]').textContent(), /\| :---: \| ---: \|/)
  assert.equal(await input.inputValue(), source)
  await modal.getByRole('button', { name: '将修复应用到源码' }).click()
  assert.match(await input.inputValue(), /\| A \| B \|/)
  await modal.getByRole('button', { name: '应用更改', exact: true }).click()
  assert.match(await page.evaluate(() => window.__MD__()), /\| :---: \| ---: \|/)

  const layoutEdit = await sourceEdit()
  await layoutEdit.input.fill('# 第一章\n\n正文 $x^2=1$。\n\n## 第二章\n\n第二页内容。\n\n## 第三章\n\n第三页内容。')
  await layoutEdit.modal.getByRole('button', { name: '应用更改', exact: true }).click()
  await page.locator('.zh-title').fill('排版回归')
  await saveFormat('publication')
  const layout = page.getByRole('dialog', { name: 'Word 与 PDF 排版' })
  await layout.getByLabel('排版模板').selectOption('handout')
  assert.equal(await layout.getByLabel('显示页码').isChecked(), true)
  await layout.getByLabel('排版模板').selectOption('solutions')
  await layout.getByLabel('左边距（mm）').fill('26')
  await layout.getByLabel('页眉', { exact: true }).fill('{title} · 校订稿')
  await layout.getByRole('button', { name: '应用排版' }).click()
  const word = await downloads('docx')
  assert.match(utf8.decode(word['word/document.xml']), /w:pgSz w:w="11906" w:h="16838"/)
  assert.match(utf8.decode(word['word/document.xml']), /w:left="1474"/)
  assert.equal((utf8.decode(word['word/document.xml']).match(/<w:pageBreakBefore\b/g) ?? []).length, 2)
  assert.match(utf8.decode(word['word/header1.xml']), /排版回归 · 校订稿/)
  assert.match(utf8.decode(word['word/footer1.xml']), /w:instr="PAGE"|>PAGE</)
  await saveFormat('pdf')
  await page.waitForFunction(() => window.printed)
  const marginRules = await page.locator('style[media="print"]').evaluate((style) =>
    Array.from(style.sheet.cssRules[0].cssRules, (rule) => rule.cssText))
  assert.ok(marginRules.some((rule) => rule.includes('排版回归 · 校订稿')))
  assert.ok(marginRules.some((rule) => rule.includes('counter(page)')))
  const pdf = Buffer.from(await page.pdf({ preferCSSPageSize: true })).toString('latin1')
  assert.equal((pdf.match(/\/Type \/Page\b/g) ?? []).length, 3)
  assert.match(pdf, /\/MediaBox \[0 0 59[45](?:\.\d+)? 84[12](?:\.\d+)?\]/)
  const assetDoc = '讲义/素材迁移.md'
  const assetSource = [
    '# 素材测试', '', '![迁移的动图](assets/photo.gif)', '', '[移动的视频](assets/clip.mp4)',
    '', '![重名素材](assets/ambiguous.gif)', '',
  ].join('\n')
  await disk(assetDoc, assetSource)
  await disk('素材新位置/photo.gif', [...animation])
  await disk('素材新位置/clip.mp4', [0, 1, 2])
  await disk('素材新位置/A/ambiguous.gif', [...animation])
  await disk('素材新位置/B/ambiguous.gif', [...animation])
  await workspace.getByRole('button', { name: '刷新', exact: true }).click()
  await tree.getByRole('button', { name: '素材迁移.md', exact: true }).click()
  await prose.getByRole('heading', { name: '素材测试' }).waitFor()
  await more('素材管理与断链修复')
  const assets = page.getByRole('dialog', { name: '素材管理' })
  await assets.getByText(/本地缺失.*photo\.gif/).waitFor()
  await page.evaluate(() => { window.testSelectedFolder = ['素材新位置'] })
  await assets.getByRole('button', { name: '选择新素材文件夹', exact: true }).click()
  const repairs = assets.getByRole('region', { name: '修复预览' })
  await repairs.getByText('2 处可修复，1 处待处理。', { exact: true }).waitFor()
  await repairs.getByText('→ ../素材新位置/photo.gif', { exact: true }).waitFor()
  await repairs.getByText('存在多个同名文件', { exact: true }).waitFor()
  assert.equal(await disk(assetDoc), assetSource)
  await disk('素材新位置/clip.mp4', [0, 1, 2, 3])
  await assets.getByRole('button', { name: '应用修复到正文', exact: true }).click()
  await assets.getByRole('alert').getByText(/素材文件已发生变化/).waitFor()
  assert.match(await prose.getByRole('link', { name: '移动的视频' }).getAttribute('href'), /^assets\/clip\.mp4$/)
  await assets.getByRole('button', { name: '选择新素材文件夹', exact: true }).click()
  await assets.getByRole('button', { name: '应用修复到正文', exact: true }).waitFor()
  await assets.getByRole('button', { name: '应用修复到正文', exact: true }).click()
  await assets.waitFor({ state: 'hidden' })
  const repairedGif = await prose.locator('img[alt="迁移的动图"]').getAttribute('src')
  assert.deepEqual(Buffer.from(repairedGif.split(',')[1], 'base64'), animation)
  assert.match(await prose.getByRole('link', { name: '移动的视频' }).getAttribute('href'), /^\.\.\/.+\/clip\.mp4$/)
  await page.evaluate(() => { window.__EDITOR__.commands.undo() })
  assert.match(await prose.getByRole('link', { name: '移动的视频' }).getAttribute('href'), /^assets\/clip\.mp4$/)
  await page.evaluate(() => { window.__EDITOR__.commands.redo() })
  await page.keyboard.press('Control+s')
  await waitSaved()
  const repairedMarkdown = await disk(assetDoc)
  assert.match(repairedMarkdown, /\.\.\/.+\/photo\.gif/)
  assert.match(repairedMarkdown, /\.\.\/.+\/clip\.mp4/)
  assert.match(repairedMarkdown, /assets\/ambiguous\.gif/)
  assert.deepEqual(errors, [])
  console.log('工作区跨文档正文与公式检索、命中定位、批量素材修复预览、GIF 和视频链接保留及单次撤销通过。')
  console.log('工作区、反向链接、重命名冲突、原始 GIF、ZIP、源码预览及 Word/PDF 排版通过。')
} finally {
  await browser.close()
}
