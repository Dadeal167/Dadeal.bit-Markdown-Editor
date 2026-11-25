import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { chromium } from 'playwright-core'
import { makeAnimatedGif, gifInfo } from './make-test-gif.mjs'

const gif = makeAnimatedGif(0)
const embedded = 'data:image/gif;base64,' + gif.toString('base64')
const preview = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a10MAAAAASUVORK5CYII='
const original = 'https://pic1.zhimg.com/dadealbit-original.gif?version=1'
const zhihuCover = 'https://pic1.zhimg.com/50/v2-0123456789abcdef0123456789abcdef_720w.jpg?source=2c26e567'
const zhihuAnimation = zhihuCover.replace('.jpg?', '.gif?')
const browser = await chromium.launch({ channel: 'msedge', headless: true })
try {
  const page = await browser.newPage()
  await page.route(original, (route) => route.fulfill({ contentType: 'image/gif', body: gif }))
  await page.route(zhihuAnimation, (route) => route.fulfill({ contentType: 'image/gif', body: gif }))
  await page.goto(pathToFileURL(resolve('Dadealbit Markdown 编辑器.html')).href)
  await page.waitForFunction(() => window.__EDITOR__?.isInitialized)

  function paste(payload) {
    return page.evaluate(({ html, text, uriList, file }) => {
      const editor = window.__EDITOR__
      editor.commands.clearContent()
      editor.commands.focus()
      const transfer = new DataTransfer()
      if (html) transfer.setData('text/html', html)
      if (text) transfer.setData('text/plain', text)
      if (uriList) transfer.setData('text/uri-list', uriList)
      if (file) {
        const match = /^data:(.+);base64,(.+)$/.exec(file)
        const bytes = Uint8Array.from(atob(match[2]), (char) => char.charCodeAt(0))
        transfer.items.add(new File([bytes], 'pasted-image', { type: match[1] }))
      }
      editor.view.dom.dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }))
    }, payload)
  }

  async function imageSource() {
    const image = page.locator('.ProseMirror img')
    await image.first().waitFor()
    assert.equal(await image.count(), 1)
    return image.getAttribute('src')
  }

  await paste({ html: '<img src="' + preview + '" data-actualsrc="' + original + '" alt="动图">', file: preview })
  assert.equal(await imageSource(), original)
  await page.waitForFunction(() => document.querySelector('.ProseMirror img')?.naturalWidth > 0)
  assert.ok((await page.evaluate(() => window.__MD__())).includes(original))

  await paste({ html: '<img src="' + original + '" alt="动图">', file: preview })
  assert.equal(await imageSource(), original)

  const copiedCover = '<html><body><!--StartFragment--><img src="' + zhihuCover + '" alt="动图封面"/><!--EndFragment--></body></html>'
  await paste({ html: copiedCover, file: preview })
  assert.equal(await imageSource(), zhihuAnimation)
  await page.waitForFunction(() => document.querySelector('.ProseMirror img')?.naturalWidth > 0)
  assert.ok((await page.evaluate(() => window.__MD__())).includes(zhihuAnimation))

  await paste({ html: '<p>说明</p><img src="' + zhihuCover + '" alt="动图封面">', file: preview })
  assert.equal(await imageSource(), zhihuAnimation)
  assert.equal(await page.evaluate(() => window.__EDITOR__.state.doc.textContent), '说明')

  await paste({ html: copiedCover.replace('动图封面', '普通配图'), file: preview })
  assert.equal(await imageSource(), preview)

  await paste({ html: '<p>动图说明</p><img src="' + preview + '" data-original="' + embedded + '">', file: preview })
  assert.equal(await imageSource(), embedded)
  assert.ok((await page.evaluate(() => window.__EDITOR__.state.doc.textContent)).includes('动图说明'))

  await paste({ uriList: '# image source\r\n' + original + '\r\n', file: preview })
  assert.equal(await imageSource(), original)

  await paste({ text: original, file: preview })
  assert.equal(await imageSource(), original)

  await paste({ html: '<img src="' + preview + '">', file: embedded })
  const data = await imageSource()
  assert.equal(data, embedded)
  assert.equal(gifInfo(Buffer.from(data.split(',')[1], 'base64')).frames, 2)

  await paste({ file: preview })
  assert.equal(await imageSource(), preview)
  console.log('PASS: 粘贴优先保留动图原始地址或 GIF 字节，纯静态图片仍可粘贴。')
} finally {
  await browser.close()
}
