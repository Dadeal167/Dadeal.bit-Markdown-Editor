import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { chromium } from 'playwright-core'

const root = process.argv[2]
if (!root) throw new Error('请传入 Wallpaper Engine 项目目录。')
const projects = []
for (const entry of await readdir(root, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue
  try {
    const project = JSON.parse(await readFile(join(root, entry.name, 'project.json'), 'utf8'))
    projects.push({ id: entry.name, type: String(project.type).toLowerCase(), file: project.file })
  } catch { /* 跳过非项目目录。 */ }
}
console.log('项目数量', projects.length, Object.fromEntries([...new Set(projects.map((project) => project.type))]
  .map((type) => [type, projects.filter((project) => project.type === type).length])))
const samples = [
  { id: '3538671760', result: 'spine' },
  { id: '3786399807', result: 'spine' },
  { id: '3794407098', result: 'spine' },
  { id: '2922877436', result: 'older-spine' },
  { id: '2633309403', result: 'web' },
  { id: '3441873795', result: 'scene' },
  { id: '2284744546', result: 'video' },
].filter((sample) => projects.some((project) => project.id === sample.id))
const browser = await chromium.launch({ channel: 'msedge', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 850 } })
  page.setDefaultTimeout(30000)
  const failures = []
  page.on('pageerror', (error) => failures.push(error.message))
  await page.goto(pathToFileURL(resolve('Dadealbit Markdown 编辑器.html')).href)
  await page.waitForFunction(() => window.__EDITOR__?.isInitialized)
  await page.getByTitle('特效', { exact: true }).click()
  await page.getByRole('switch', { name: '动态壁纸', exact: true }).check()
  const spineEnabled = await page.getByRole('button', { name: '导入 Spine 文件', exact: true }).isVisible()
  for (const sample of samples) {
    const pending = page.waitForEvent('filechooser')
    await page.getByRole('button', { name: '导入 Wallpaper Engine 项目', exact: true }).click()
    await (await pending).setFiles(join(root, sample.id))
    const status = page.locator('.zh-fx__lobby [role="status"]')
    if (!spineEnabled && sample.result === 'spine') {
      await status.filter({ hasText: /需要启用 Spine/ }).waitFor()
      await page.getByRole('button', { name: '使用项目预览图', exact: true }).click()
      await page.waitForFunction(() => document.querySelector('img.zh-fx__lobby-media')?.naturalWidth > 0)
      console.log('PASS:', sample.id, 'Spine 项目使用预览图')
      continue
    }
    if (sample.result === 'spine') {
      await page.getByRole('group', { name: '壁纸资源分辨率' }).waitFor()
      await page.waitForFunction(() => document.querySelector('canvas.zh-fx__lobby-stage')?.width > 0)
      await status.filter({ hasText: /Spine/ }).waitFor()
      assert.equal(await page.getByRole('button', { name: '使用 4K', exact: true }).count(), 1)
      assert.equal(await page.getByRole('button', { name: '使用 8K', exact: true }).count(), 1)
      await page.getByRole('button', { name: '使用 4K', exact: true }).click()
      await status.filter({ hasText: /Spine 4K/ }).waitFor()
      await page.waitForTimeout(100)
      assert.equal(await page.locator('.zh-fx__lobby canvas').count(), 0)
      assert.equal(await page.locator('canvas.zh-fx__lobby-stage').count(), 1)
      assert.equal(await page.locator('html').getAttribute('data-memory-lobby'), 'on')
    } else if (sample.result === 'video') {
      await page.waitForFunction(() => document.querySelector('video.zh-fx__lobby-media')?.videoWidth > 0)
    } else if (sample.result === 'scene') {
      await page.waitForFunction(() => document.querySelector('iframe.zh-fx__wallpaper-scene')?.dataset.sceneState === 'ready')
    } else if (sample.result === 'web') {
      await page.waitForFunction(() => document.querySelector('iframe.zh-fx__wallpaper-web')?.dataset.webState === 'ready')
      await status.filter({ hasText: /Live2D 已加载/ }).waitFor()
    } else {
      const reason = /Spine 3\.8\.99/
      await status.filter({ hasText: reason }).waitFor()
      await page.getByRole('button', { name: '使用项目预览图', exact: true }).click()
      await status.filter({ hasText: /壁纸预览图/ }).waitFor()
      await page.waitForFunction(() => document.querySelector('img.zh-fx__lobby-media')?.naturalWidth > 0)
    }
    if (sample.result !== 'spine') assert.equal(await page.getByRole('group', { name: '壁纸资源分辨率' }).count(), 0)
    console.log('PASS:', sample.id, sample.result)
  }
  await page.evaluate(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 640
    canvas.height = 360
    canvas.getContext('2d').fillRect(0, 0, 640, 360)
    window.testWallpaperStream = canvas.captureStream(30)
    Object.defineProperty(navigator.mediaDevices, 'getDisplayMedia', { configurable: true,
      value: async () => window.testWallpaperStream })
  })
  await page.getByRole('button', { name: '共享 Wallpaper 窗口', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('video.zh-fx__lobby-window')?.srcObject === window.testWallpaperStream)
  assert.equal(await page.locator('video.zh-fx__lobby-window').evaluate((video) => video.muted), true)
  const playing = page.getByRole('checkbox', { name: '播放动画', exact: true })
  await playing.uncheck()
  assert.equal(await page.locator('video.zh-fx__lobby-window').evaluate((video) => video.paused), true)
  await playing.check()
  await page.waitForFunction(() => !document.querySelector('video.zh-fx__lobby-window')?.paused)
  await page.getByRole('switch', { name: '动态壁纸', exact: true }).uncheck()
  assert.equal(await page.evaluate(() => window.testWallpaperStream.getVideoTracks()[0].readyState), 'ended')
  assert.equal(await page.locator('video.zh-fx__lobby-window').count(), 0)
  assert.deepEqual(failures, [])
  console.log('PASS: 窗口共享接入、暂停及关闭清理（使用模拟视频流）')
} finally { await browser.close() }
