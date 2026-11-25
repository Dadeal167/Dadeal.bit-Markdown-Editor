import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { chromium } from 'playwright-core'

const extension = resolve(process.argv[2] ?? '../Dadealbit-Zhihu-Exporter-Extension')
const editor = pathToFileURL(resolve('Dadealbit Markdown 编辑器.html')).href
const articleUrl = 'https://zhuanlan.zhihu.com/p/1234567890'
const answerUrl = 'https://www.zhihu.com/question/1234567890/answer/1001'
const blockedUrl = 'https://zhuanlan.zhihu.com/p/1234567891'
const slowUrl = 'https://zhuanlan.zhihu.com/p/1234567892'
const cdn = 'https://picx.zhimg.com/dadealbit-fixture.gif'
const externalImage = 'https://picx.zhimg.com/dadealbit-missing.png'
const gif = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64')
const context = await chromium.launchPersistentContext('', {
  channel: 'chromium',
  args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
})
try {
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker', { timeout: 10000 })
  const id = new URL(worker.url()).hostname
  const extensionUi = await context.newPage()
  await extensionUi.goto('chrome-extension://' + id + '/popup.html')
  const hasFileAccess = () => extensionUi.evaluate(() => chrome.extension.isAllowedFileSchemeAccess())
  if (!await hasFileAccess()) {
    const manager = await context.newPage()
    await manager.goto('chrome://extensions/?id=' + id)
    await manager.locator('#allow-on-file-urls cr-toggle').click({ timeout: 10000 })
    await manager.close()
    await extensionUi.reload()
  }
  assert.equal(await hasFileAccess(), true)
  await extensionUi.close()

  let challenge = true
  const html = (body) => '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><body>' + body + '</body></html>'
  await context.route(articleUrl, (route) => route.fulfill({ contentType: 'text/html; charset=utf-8', body: html(
    '<h1 class="Post-Title">插件导入示例</h1><div class="AuthorInfo"><span class="UserLink">示例作者</span></div>' +
    '<time>2026-11-24</time><div class="Post-RichText"><p>这段正文来自扩展。公式 <span class="ztext-math" data-tex="x^2+1"></span></p>' +
    '<table><tr><th>题目</th><th>结果</th></tr><tr><td>第一问</td><td>42</td></tr></table>' +
    '<img alt="离线动图" src="' + cdn + '"><img alt="保留链接" src="' + externalImage + '"></div>',
  ) }))
  await context.route(answerUrl, (route) => route.fulfill({ contentType: 'text/html; charset=utf-8', body: html(
    '<h1 class="QuestionHeader-title">示例问题</h1><article class="AnswerItem" data-answer-id="1000"><div class="RichText">其他回答</div></article>' +
    '<article class="AnswerItem" data-zop=\'{"itemId":1001}\'><div class="AuthorInfo"><span class="UserLink">答主</span></div><div class="RichText">目标回答。</div></article>',
  ) }))
  await context.route(blockedUrl, (route) => route.fulfill({ contentType: 'text/html; charset=utf-8', body: html(challenge
    ? '<title>知乎安全验证</title><div class="Captcha">等待人工验证</div>'
    : '<h1 class="Post-Title">验证后的文章</h1><div class="Post-RichText">文章正文已可读。</div>') }))
  await context.route(slowUrl, (route) => route.fulfill({ contentType: 'text/html; charset=utf-8', body: html('<p>正文尚未出现。</p>') }))
  await context.route(cdn, (route) => route.fulfill({ contentType: 'image/gif', body: gif }))
  await context.route(externalImage, (route) => route.fulfill({ status: 404 }))

  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  const downloads = []
  page.on('download', (file) => downloads.push(file.suggestedFilename()))
  await page.goto(editor)
  await page.waitForFunction(() => window.__EDITOR__?.isInitialized)
  const open = async () => {
    await page.getByRole('button', { name: '打开方式', exact: true }).click()
    await page.getByRole('button', { name: '从知乎链接导入', exact: true }).click()
  }
  const dialog = page.getByRole('dialog', { name: '从知乎链接导入' })
  const submit = async (url) => {
    await dialog.getByLabel('知乎文章或回答网址').fill(url)
    await dialog.getByRole('button', { name: '导入知乎内容' }).click()
  }
  const selected = (name) => page.getByRole('tab', { name, exact: true, selected: true })
  const markdown = () => page.evaluate(() => window.__MD__())
  await open()
  await submit('https://zhuanlan.zhihu.com.example.invalid/p/1234567890')
  await dialog.getByRole('alert').getByText(/请输入知乎专栏文章/).waitFor()
  await worker.evaluate(() => chrome.storage.session.set({ batchActive: true, batchCount: 3 }))
  await submit(articleUrl + '?utm_source=test')
  await selected('插件导入示例').waitFor({ timeout: 16000 })
  const batch = await worker.evaluate(() => chrome.storage.session.get(['batchActive', 'batchCount']))
  assert.deepEqual(batch, { batchActive: true, batchCount: 3 })
  await worker.evaluate(() => chrome.storage.session.remove(['batchActive', 'batchCount']))
  const article = await markdown()
  assert.match(article, /\nauthor: "示例作者"\n/)
  assert.match(article, /url: "https:\/\/zhuanlan\.zhihu\.com\/p\/1234567890"/)
  assert.match(article, /\$x\^2\+1\$/)
  assert.match(article, /\| 第一问 \| 42 \|/)
  assert.match(article, /data:image\/gif;base64,/)
  assert.ok(article.includes(externalImage))

  await open()
  await submit(answerUrl)
  await selected('示例问题 - 答主的回答').waitFor({ timeout: 16000 })
  assert.match(await markdown(), /目标回答。/)
  assert.doesNotMatch(await markdown(), /其他回答/)

  await open()
  await submit(blockedUrl)
  await dialog.getByRole('alert').getByText(/登录或安全验证/).waitFor({ timeout: 16000 })
  const blocked = context.pages().find((tab) => tab.url() === blockedUrl)
  assert.ok(blocked)
  assert.match(await markdown(), /目标回答。/)
  challenge = false
  await blocked.reload()
  await submit(blockedUrl)
  await selected('验证后的文章').waitFor({ timeout: 16000 })

  await open()
  await submit(slowUrl)
  let pending
  const openingDeadline = Date.now() + 8000
  while (!pending && Date.now() < openingDeadline) {
    pending = context.pages().find((tab) => tab.url() === slowUrl)
    if (!pending) await new Promise((resolve) => setTimeout(resolve, 50))
  }
  assert.ok(pending, `未打开待取消的知乎标签。${(await dialog.getByRole('alert').allTextContents()).join(' ')}`)
  const closed = pending.waitForEvent('close', { timeout: 10000 })
  await dialog.getByRole('button', { name: '取消' }).click()
  await closed
  assert.match(await markdown(), /文章正文已可读/)
  assert.deepEqual(downloads, [])
  assert.deepEqual(errors, [])
  await page.reload()
  await selected('验证后的文章').waitFor()
  console.log('PASS: 扩展读取本地 HTML 请求，导入文章、指定回答、公式、表格和图片，处理验证与取消，重开后草稿仍在。')

  const remoteGif = 'https://picx.zhimg.com/remote-offline-test.gif'
  let fetchedByExtension = false
  await context.route(remoteGif, (route) => {
    if (route.request().serviceWorker()) fetchedByExtension = true
    else if (route.request().resourceType() === 'fetch') return route.abort()
    return route.fulfill({ contentType: 'image/gif', body: gif })
  })
  await page.evaluate((url) => {
    window.__EDITOR__.commands.setContent('![知乎动图](' + url + ')')
  }, remoteGif)
  await page.getByTitle('更多', { exact: true }).click()
  await page.getByText('素材管理与断链修复', { exact: true }).click()
  const assets = page.getByRole('dialog', { name: '素材管理' })
  await assets.getByRole('button', { name: '保存远程素材（1）' }).click()
  await assets.getByRole('status').getByText(/已保存 1 张图片/).waitFor({ timeout: 16000 })
  assert.equal(fetchedByExtension, true)
  assert.ok((await markdown()).includes('data:image/gif;base64,' + gif.toString('base64')))
  await assets.getByRole('button', { name: '关闭素材管理' }).click()
  console.log('PASS: 本地特效版通过已安装的扩展保存知乎图片原始字节。')

  const exportPage = await context.newPage()
  await exportPage.goto(articleUrl)
  await exportPage.locator('#dadealbit-fab').waitFor()
  const archived = await worker.evaluate(async (url) => {
    const [tab] = await chrome.tabs.query({ url })
    return chrome.tabs.sendMessage(tab.id, { type: 'extract', formats: { md: true, html: false, pdf: false } })
  }, articleUrl)
  assert.equal(archived.ok, true, archived.error)
  assert.match(archived.filename, /\.zip$/)
  console.log('PASS: 原扩展的 ZIP 打包入口仍可使用。')
} finally {
  await context.close()
}
