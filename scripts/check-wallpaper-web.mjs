import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { chromium } from 'playwright-core'

const project = process.argv[2]
if (!project) throw new Error('请传入 Live2D 网页壁纸目录。')
const browser = await chromium.launch({ channel: 'msedge', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, offline: true })
  page.setDefaultTimeout(60000)
  const errors = []
  const requests = []
  page.on('pageerror', error => { errors.push(error.message); console.log('ERROR', error.message.slice(0, 400)) })
  page.on('console', message => { if (message.type() === 'error') console.log('CONSOLE', message.text().slice(0, 400)) })
  page.on('request', request => { if (/^https?:/.test(request.url())) requests.push(request.url()) })
  const open = async () => {
    if (!await page.getByRole('switch', { name: '动态壁纸', exact: true }).isVisible()) await page.getByTitle('特效', { exact: true }).click()
  }
  await page.goto(pathToFileURL(resolve('Dadealbit Markdown 编辑器.html')).href)
  await page.waitForFunction(() => window.__EDITOR__?.isInitialized)
  await open()
  await page.getByRole('switch', { name: '动态壁纸', exact: true }).check()
  const playing = page.getByRole('checkbox', { name: '播放动画', exact: true })
  await playing.uncheck()
  const pending = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: '导入 Wallpaper Engine 项目', exact: true }).click()
  await (await pending).setFiles(resolve(project))
  await page.waitForFunction(() => document.querySelector('iframe.zh-fx__wallpaper-web')?.dataset.webState === 'ready' ||
    [...document.querySelectorAll('.zh-fx__lobby [role="status"]')].some(node => node.textContent.includes('网页加载失败。')))
  console.log('STATUS', await page.locator('.zh-fx__lobby [role="status"]').allTextContents())
  const frame = page.locator('iframe.zh-fx__wallpaper-web')
  assert.equal(await frame.count() && await frame.getAttribute('data-web-state'), 'ready')
  assert.equal(await frame.getAttribute('sandbox'), 'allow-scripts')
  const web = page.frameLocator('iframe.zh-fx__wallpaper-web')
  const canvas = web.locator('canvas')
  assert.equal(await canvas.count(), 1)
  assert.equal(await canvas.evaluate(() => { try { return parent.document.body !== null } catch { return false } }), false)
  await playing.check()
  await page.waitForFunction(() => Number(document.querySelector('iframe.zh-fx__wallpaper-web')?.dataset.sceneFps) > 0)
  const capture = async (name) => {
    const png = await canvas.evaluate(node => new Promise(resolve => requestAnimationFrame(() => resolve(node.toDataURL('image/png').split(',')[1]))))
    await writeFile('.probe/wallpaper-web/' + name + '.png', Buffer.from(png, 'base64'))
    return png
  }
  await mkdir('.probe/wallpaper-web', { recursive: true })
  const first = await capture('model')
  await page.waitForTimeout(1800)
  assert.notEqual(await capture('model-next'), first, 'Live2D 应持续绘制动画')
  await canvas.evaluate(() => {
    window.webQaFrames = 0
    const tick = () => { window.webQaFrames++; requestAnimationFrame(tick) }
    requestAnimationFrame(tick)
    document.addEventListener('mousemove', event => { window.webQaPointer = { x: event.clientX, y: event.clientY } })
  })
  await page.mouse.move(300, 310)
  await canvas.evaluate(() => new Promise(resolve => setTimeout(resolve, 150)))
  const pointer = await canvas.evaluate(() => window.webQaPointer)
  assert.ok(pointer && pointer.x > 0 && pointer.y > 0, '正文区域内的鼠标也应传入网页')
  await playing.uncheck()
  await page.waitForFunction(() => Number(document.querySelector('iframe.zh-fx__wallpaper-web')?.dataset.sceneFps) === 0)
  const paused = await canvas.evaluate(() => window.webQaFrames)
  await page.waitForTimeout(1100)
  assert.equal(await canvas.evaluate(() => window.webQaFrames), paused)
  await playing.check()
  await page.waitForFunction(() => Number(document.querySelector('iframe.zh-fx__wallpaper-web')?.dataset.sceneFps) > 0)
  await canvas.evaluate((_node, before) => new Promise((resolve, reject) => {
    const start = performance.now()
    const timer = setInterval(() => {
      if (window.webQaFrames > before) { clearInterval(timer); resolve() }
      else if (performance.now() - start > 5000) { clearInterval(timer); reject(new Error('恢复播放后动画回调未继续运行。')) }
    }, 50)
  }), paused)
  const pauseEditing = page.getByRole('checkbox', { name: '编辑时暂停', exact: true })
  await pauseEditing.check()
  await page.locator('.zh-title').focus()
  await page.waitForFunction(() => Number(document.querySelector('iframe.zh-fx__wallpaper-web')?.dataset.sceneFps) === 0)
  await page.getByRole('combobox', { name: '背景缩放', exact: true }).focus()
  await page.waitForFunction(() => Number(document.querySelector('iframe.zh-fx__wallpaper-web')?.dataset.sceneFps) > 0)
  await pauseEditing.uncheck()
  await page.getByRole('combobox', { name: '背景缩放', exact: true }).selectOption('contain')
  const bounds = await frame.boundingBox()
  assert.ok(bounds.x >= -1 && bounds.y >= -1 && bounds.x + bounds.width <= 1401 && bounds.y + bounds.height <= 901)
  const current = page.locator('.zh-lobby-history__item').filter({ has: page.locator('button[aria-pressed="true"]') })
  await current.getByRole('button', { name: /的备注$/ }).click()
  await current.getByRole('textbox', { name: '背景备注' }).fill('Live2D 网页验证')
  await current.getByRole('button', { name: '保存备注', exact: true }).click()
  await current.getByRole('textbox', { name: '背景备注' }).waitFor({ state: 'hidden' })
  await page.screenshot({ path: '.probe/wallpaper-web/editor.png' })
  await page.reload()
  await page.waitForFunction(() => window.__EDITOR__?.isInitialized)
  await open()
  await page.waitForFunction(() => document.querySelector('iframe.zh-fx__wallpaper-web')?.dataset.webState === 'ready')
  await page.locator('.zh-lobby-history__item').filter({ hasText: 'Live2D 网页验证' }).waitFor()
  assert.equal(await page.getByRole('combobox', { name: '背景缩放', exact: true }).inputValue(), 'contain')
  const imageChoice = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: '导入图片或视频', exact: true }).click()
  await (await imageChoice).setFiles(resolve('.probe/tiny.png'))
  await page.locator('img.zh-fx__lobby-media').waitFor()
  assert.equal(await frame.count(), 0)
  await page.locator('.zh-lobby-history__item').filter({ hasText: 'Live2D 网页验证' }).getByRole('button', { name: /^使用「/ }).click()
  await page.waitForFunction(() => document.querySelector('iframe.zh-fx__wallpaper-web')?.dataset.webState === 'ready')
  await frame.evaluate(node => { node.dataset.qaRetained = 'live2d-retained' })
  await page.keyboard.press('Control+Alt+t')
  await page.locator('.zh-toolbar-orb').waitFor({ state: 'hidden', timeout: 6000 })
  assert.equal(await frame.getAttribute('data-qa-retained'), 'live2d-retained')
  await page.waitForFunction(() => Number(document.querySelector('iframe.zh-fx__wallpaper-web')?.dataset.sceneFps) > 0)
  await page.keyboard.press('Control+Alt+t')
  await page.getByRole('button', { name: '展开工具栏', exact: true }).click()
  await page.getByRole('button', { name: '收起编辑工具栏', exact: true }).click()
  assert.equal(await frame.getAttribute('data-qa-retained'), 'live2d-retained', '悬浮球和工具栏切换不应重新加载背景')
  assert.deepEqual(requests, [])
  assert.deepEqual(errors, [])
  console.log('PASS: Live2D 模型绘制、持续动画、正文鼠标追踪、暂停恢复、缩放、备注、刷新与历史复用、悬浮球隐藏时持续播放、离线与隔离。')
} finally { await browser.close() }
