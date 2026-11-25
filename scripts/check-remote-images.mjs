import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { unzipSync } from 'fflate'
import { chromium } from 'playwright-core'
import { gifInfo, makeAnimatedGif } from './make-test-gif.mjs'

const gif = makeAnimatedGif(0)
const original = 'https://images.example.test/original.gif'
const failed = 'https://images.example.test/protected.gif'
const browser = await chromium.launch({ channel: 'msedge', headless: true })
try {
  const context = await browser.newContext()
  const page = await context.newPage()
  await page.route(original, (route) => route.fulfill({
    contentType: 'image/gif', body: gif, headers: { 'access-control-allow-origin': '*' },
  }))
  await page.route(failed, (route) => route.fulfill({ status: 403 }))
  await page.goto(pathToFileURL(resolve('Dadealbit Markdown 编辑器.html')).href)
  const ready = () => page.waitForFunction(() => window.__EDITOR__?.isInitialized && window.__DOCSTORE__?.backend === 'indexeddb')
  await ready()
  await page.evaluate(({ original, failed }) => {
    window.__EDITOR__.commands.setContent('# 远程图片\n\n![动画](' + original + ')\n\n![同一动画](' +
      original + ')\n\n![受限图片](' + failed + ')')
  }, { original, failed })
  const md = () => page.evaluate(() => window.__MD__())
  const openAssets = async () => {
    await page.getByTitle('更多', { exact: true }).click()
    await page.getByText('素材管理与断链修复', { exact: true }).click()
    return page.getByRole('dialog', { name: '素材管理' })
  }
  const assets = await openAssets()
  await assets.getByRole('button', { name: '保存远程素材（2）' }).click()
  await assets.getByRole('status').getByText(/已保存 1 张图片。1 张未能下载/).waitFor()
  const source = await md()
  const embedded = 'data:image/gif;base64,' + gif.toString('base64')
  assert.equal(source.split(embedded).length - 1, 2)
  assert.ok(source.includes(failed))
  assert.ok(!source.includes(original))
  await assets.getByRole('button', { name: '关闭素材管理' }).click()

  const pendingDownload = page.waitForEvent('download')
  await page.getByTitle('保存', { exact: true }).click()
  await page.locator('button[data-format="zip"]').click()
  const download = await pendingDownload
  const packed = unzipSync(await readFile(await download.path()))
  const gifPaths = Object.keys(packed).filter((path) => path.endsWith('.gif'))
  assert.equal(gifPaths.length, 1)
  const packedGif = Buffer.from(packed[gifPaths[0]])
  assert.deepEqual(packedGif, gif)
  assert.equal(gifInfo(packedGif).frames, 2)
  const report = Buffer.from(packed['联网图片.txt']).toString('utf-8')
  assert.ok(report.includes('受限图片') && report.includes(failed))
  assert.ok(!report.includes(original))
  await page.getByText(/1 张图片仍需联网/).waitFor()

  await page.waitForFunction(() => !document.querySelector('.zh-document-tab__pending'))
  await page.unrouteAll()
  await context.setOffline(true)
  await page.reload()
  await ready()
  const images = page.locator('.ProseMirror img')
  assert.equal(await images.count(), 3)
  await page.waitForFunction((embedded) => [...document.querySelectorAll('.ProseMirror img')]
    .filter((img) => img.getAttribute('src') === embedded && img.naturalWidth > 0).length === 2, embedded)
  assert.ok((await md()).includes(failed))
  console.log('PASS: 远程 GIF 按原字节保存、断网后重开可显示、重复引用去重打包，失败图片在 ZIP 中列出。')
} finally {
  await browser.close()
}
