import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { _electron } from 'playwright-core'

const projects = await Promise.all(process.argv.slice(2).map(async (argument) => {
  const path = resolve(argument)
  const manifest = JSON.parse((await readFile(path, 'utf8')).replace(/^\uFEFF/, ''))
  return { path, title: manifest.title.trim() + ' · 原生壁纸' }
}))
assert.equal(projects.length, 2, '请传入两个 Wallpaper Engine 项目的 project.json')

const profile = resolve('.probe', 'native-wallpaper-' + randomUUID())
const soakSeconds = Number(process.env.DADEALBIT_NATIVE_SOAK_SECONDS || 0)
const launch = () => _electron.launch({
  executablePath: resolve('desktop/node_modules/electron/dist/electron.exe'),
  args: ['--user-data-dir=' + profile, resolve('desktop')],
})
const windows = (application) => application.evaluate(async ({ desktopCapturer }) => {
  const sources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 0, height: 0 } })
  return sources.flatMap(({ name }) => name.startsWith('Dadealbit-Wallpaper-') ? [name] : [])
})
const waitForClosed = (application, title) => application.evaluate(async ({ desktopCapturer }, title) => {
  for (let i = 0; i < 30; i++) {
    const sources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 0, height: 0 } })
    if (!sources.some(({ name }) => name === title)) return true
    await new Promise((done) => setTimeout(done, 200))
  }
  return false
}, title)

async function ready(application) {
  const page = await application.firstWindow()
  page.setDefaultTimeout(45000)
  page.on('pageerror', (error) => console.error('PAGE ERROR', error.message))
  await page.getByTitle('特效', { exact: true }).click()
  await page.getByRole('switch', { name: '动态壁纸' }).check()
  return page
}

async function activeWallpaper(page, title, duration = 2500) {
  const chosen = page.getByRole('button', { name: '使用「' + title + '」', exact: true })
  const video = page.locator('video.zh-fx__lobby-window')
  try {
    await chosen.waitFor()
    await page.waitForFunction((name) => [...document.querySelectorAll('button[aria-pressed="true"]')]
      .some((button) => button.getAttribute('aria-label') === name), '使用「' + title + '」')
    await video.waitFor()
  } catch (error) {
    console.error('STATUS', await page.locator('.zh-fx__lobby [role="status"], .zh-fx__lobby [role="alert"]').allTextContents())
    throw error
  }
  const observed = await video.evaluate((node, duration) => new Promise((done) => {
    const canvas = document.createElement('canvas')
    canvas.width = 48
    canvas.height = 27
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    let frames = 0
    const distinct = new Set()
    let contrast = 0
    let handle = 0
    let previousFrame
    let longestGap = 0
    let gapsOver250ms = 0
    const begin = performance.now()
    const sample = (now) => {
      if (previousFrame !== undefined) {
        const delta = now - previousFrame
        longestGap = Math.max(longestGap, delta)
        if (delta > 250) gapsOver250ms++
      }
      previousFrame = now
      frames++
      ctx.drawImage(node, 0, 0, 48, 27)
      const pixels = ctx.getImageData(0, 0, 48, 27).data
      let low = 255
      let high = 0
      let signature = 0
      for (let i = 0; i < pixels.length; i += 4) {
        const value = Math.round((pixels[i] + pixels[i + 1] + pixels[i + 2]) / 3)
        low = Math.min(low, value)
        high = Math.max(high, value)
        signature = (signature * 31 + value) | 0
      }
      contrast = Math.max(contrast, high - low)
      distinct.add(signature)
      handle = node.requestVideoFrameCallback(sample)
    }
    handle = node.requestVideoFrameCallback(sample)
    setTimeout(() => {
      node.cancelVideoFrameCallback(handle)
      done({ frames, distinct: distinct.size, contrast, width: node.videoWidth, height: node.videoHeight,
        seconds: (performance.now() - begin) / 1000, longestGapMs: Math.round(longestGap), gapsOver250ms,
        label: node.srcObject?.getVideoTracks()[0]?.label })
    }, duration)
  }), duration)
  console.log(title, observed)
  assert.ok(observed.width > 320 && observed.height > 180 && observed.contrast > 35 &&
    observed.frames >= 12 && observed.distinct >= 4, '应显示持续更新的原生壁纸，而非空白或冻结画面')
  return observed.label
}

let application = await launch()
try {
  // 测试只替换文件选择器的返回值，实际播放和采集使用本机 Wallpaper Engine。
  const baseline = new Set(await windows(application))
  await application.evaluate(({ dialog }, paths) => {
    dialog.showOpenDialog = async () => {
      const path = paths.shift()
      if (!path) throw new Error('重开历史记录时不应弹出文件选择器。')
      return { canceled: false, filePaths: [path] }
    }
  }, projects.map(({ path }) => path))
  const page = await ready(application)
  const picker = page.getByRole('button', { name: '选择 Wallpaper Engine 原生壁纸' })
  await picker.click()
  await activeWallpaper(page, projects[0].title, Math.max(2500, soakSeconds * 1000))
  const showPresets = (target) => target.locator('summary').filter({ hasText: /^写作场景预设/ }).click()
  await showPresets(page)
  await page.getByRole('textbox', { name: '预设名称', exact: true }).fill('原生壁纸写作')
  await page.getByRole('button', { name: '保存当前场景', exact: true }).click()
  await page.getByRole('button', { name: '绑定「原生壁纸写作」到本文档', exact: true }).click()
  const opened = (await windows(application)).find((name) => !baseline.has(name))
  assert.ok(opened, '应出现专用 Wallpaper Engine 窗口')
  await picker.click()
  await activeWallpaper(page, projects[1].title)
  assert.ok(await waitForClosed(application, opened), '切换壁纸后应关闭旧的专用窗口')
  const item = page.locator('.zh-lobby-history__item').filter({ hasText: projects[0].title })
  await item.getByRole('button', { name: /的备注$/ }).click()
  await item.getByRole('textbox', { name: '背景备注' }).fill('原生壁纸重开测试')
  await item.getByRole('button', { name: '保存备注' }).click()
  await item.getByText('原生壁纸重开测试', { exact: true }).waitFor()
  await application.close()
  application = await launch()
  const restarted = await ready(application)
  await showPresets(restarted)
  await restarted.getByText('原生壁纸需要手动点击「应用」。', { exact: true }).waitFor()
  await restarted.getByRole('button', { name: '应用「原生壁纸写作」', exact: true }).click()
  await activeWallpaper(restarted, projects[0].title)
  await restarted.getByText('原生壁纸重开测试', { exact: true }).waitFor()
  const reopened = (await windows(application)).find((name) => !baseline.has(name))
  assert.ok(reopened)
  await restarted.getByRole('switch', { name: '动态壁纸' }).uncheck()
  assert.ok(await waitForClosed(application, reopened), '关闭动态壁纸后应释放专用窗口')
  console.log('PASS: 真实原生场景、切换项目、备注、重启后使用已绑定预设手动重开、关闭后释放窗口')
} finally {
  await application.close().catch(() => {})
}
