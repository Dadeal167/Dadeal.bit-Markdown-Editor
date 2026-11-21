import assert from 'node:assert/strict'
import { mkdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { chromium } from 'playwright-core'

const project = process.argv[2]
if (!project) throw new Error('请传入场景壁纸文件夹路径。')
const scheduleFlag = process.argv.indexOf('--schedule')
const scheduleFile = scheduleFlag < 0 ? '' : resolve(process.argv[scheduleFlag + 1])
const automaticSchedule = process.argv.includes('--auto-schedule')
const fixedDay = process.argv.includes('--fixed-day')
const naturalLoops = process.argv.includes('--natural-loops')
const browser = await chromium.launch({ channel: 'msedge', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, acceptDownloads: true, offline: true, timezoneId: 'Asia/Tokyo' })
  page.setDefaultTimeout(90000)
  const errors = []
  const requests = []
  await page.addInitScript((captureVideo) => {
    if (window.parent === window) return
    const NativeDate = Date
    window.sceneQaTime = new NativeDate('2026-11-18T03:00:00+09:00').getTime()
    window.Date = class extends NativeDate {
      constructor(...args) { super(...(args.length ? args : [window.sceneQaTime])) }
      static now() { return window.sceneQaTime }
    }
    if (!captureVideo) return
    const record = (input, overlay = false) => {
      if (!(input instanceof HTMLVideoElement)) return
      const time = input.currentTime
      const transition = window.sceneQaTransition
      if (transition && input.duration === transition.duration && time >= transition.start && time < transition.end) {
        transition.frames++
      }
      const monitor = window.sceneQaMonitor
      if (!monitor || input.duration !== monitor.duration) return
      if (time < monitor.start || time >= monitor.end) monitor.bad.push(time)
      if (!overlay) {
        if (monitor.last !== undefined && time < monitor.last - 0.1) monitor.loops++
        monitor.last = time
      }
      monitor.frames++
    }
    for (const context of [WebGLRenderingContext, WebGL2RenderingContext]) {
      const upload = context.prototype.texImage2D
      context.prototype.texImage2D = function (...args) { record(args.at(-1)); return upload.apply(this, args) }
    }
    const draw = CanvasRenderingContext2D.prototype.drawImage
    const baseFrames = new WeakMap()
    CanvasRenderingContext2D.prototype.drawImage = function (input, ...args) {
      const mix = this.globalAlpha
      const result = draw.call(this, input, ...args)
      if (mix > 0) record(input, mix < 1)
      if (mix === 1) baseFrames.set(this, input)
      const loop = window.sceneQaLoop
      const tail = baseFrames.get(this)
      if (loop && mix > 0 && mix < 1 && tail !== input && tail instanceof HTMLVideoElement && input instanceof HTMLVideoElement &&
        tail.duration === input.duration && !tail.paused && !input.paused && !tail.seeking && !input.seeking &&
        tail.playbackRate >= .9 && input.playbackRate >= .9 && tail.currentTime > loop.end - .4 && tail.currentTime < loop.end &&
        input.currentTime >= loop.start && input.currentTime < loop.start + .65) {
        loop.blendedHead = input
        loop.frames++
      }
      return result
    }
    const alpha = Object.getOwnPropertyDescriptor(CanvasRenderingContext2D.prototype, 'globalAlpha')
    if (alpha?.set) Object.defineProperty(CanvasRenderingContext2D.prototype, 'globalAlpha', { ...alpha, set(value) {
      if (value > 0 && value < 1) window.sceneQaFades = (window.sceneQaFades ?? 0) + 1
      alpha.set.call(this, value)
    } })
  }, fixedDay || naturalLoops)
  page.on('pageerror', (error) => { errors.push(error.message); console.log('PAGE ERROR', error.message.slice(0, 350)) })
  page.on('console', (message) => { if (message.type() === 'error') console.log('CONSOLE', message.text().slice(0, 350)) })
  page.on('request', (request) => { if (/^https?:/.test(request.url())) requests.push(request.url()) })
  await page.goto(pathToFileURL(resolve('Dadealbit Markdown 编辑器.html')).href)
  await page.waitForFunction(() => window.__EDITOR__?.isInitialized)
  const open = async () => {
    if (!await page.getByRole('switch', { name: '动态壁纸' }).isVisible()) await page.getByTitle('特效', { exact: true }).click()
  }
  await open()
  await page.getByRole('switch', { name: '动态壁纸' }).check()
  const pending = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: '导入 Wallpaper Engine 项目', exact: true }).click()
  await (await pending).setFiles(resolve(project))
  const frame = page.locator('iframe.zh-fx__wallpaper-scene')
  // 背景 iframe 位于编辑器下方。采样时隐藏编辑器，避免菜单遮住取色区域。
  const sceneShot = (path) => frame.screenshot({ path, style: '#root { visibility: hidden !important; }', animations: 'disabled' })
  try {
    await page.waitForFunction(() => document.querySelector('iframe.zh-fx__wallpaper-scene')?.dataset.sceneState === 'ready' ||
      [...document.querySelectorAll('.zh-fx__lobby [role="status"]')].some((node) => node.textContent.includes('场景加载失败。')))
    assert.equal(await frame.count() && await frame.getAttribute('data-scene-state'), 'ready',
      (await page.locator('.zh-fx__lobby [role="status"]').allTextContents()).join('\n'))
  } catch (error) {
    console.log('BACKGROUND STATUS', await page.locator('.zh-fx__lobby [role="status"]').allTextContents())
    console.log('FRAME COUNT', page.frames().length)
    throw error
  }
  console.log('BACKGROUND STATUS', await page.locator('.zh-fx__lobby [role="status"]').allTextContents())
  console.log('COMPATIBILITY', await page.locator('.zh-wallpaper-options details li').allTextContents())
  const scene = page.frameLocator('iframe.zh-fx__wallpaper-scene')
  const canvas = scene.locator('canvas')
  await canvas.waitFor()
  assert.ok(await canvas.evaluate((node) => node.width > 0 && node.height > 0))
  assert.equal(await frame.getAttribute('sandbox'), 'allow-scripts')
  assert.equal(await scene.locator('html').evaluate(() => {
    try { return parent.document.body !== null } catch { return false }
  }), false)
  await page.waitForFunction(() => Number(document.querySelector('iframe.zh-fx__wallpaper-scene')?.dataset.sceneFps) > 0)
  console.log('FPS', await frame.getAttribute('data-scene-fps'))
  const frameId = await frame.evaluate((node) => { node.dataset.qaIdentity = 'retained-scene'; return node.dataset.qaIdentity })
  await page.keyboard.press('Escape')
  await page.waitForFunction(() => Number(document.querySelector('iframe.zh-fx__wallpaper-scene')?.dataset.sceneFps) > 0)
  assert.equal(await frame.getAttribute('data-qa-identity'), frameId)
  await open()
  await mkdir('.probe/wallpaper-scene', { recursive: true })
  await sceneShot('.probe/wallpaper-scene/loaded.png')
  const time = page.getByRole('combobox', { name: '时间选择', exact: true })
  if (await time.count()) {
    await time.selectOption('0')
    await scene.locator('html').evaluate(() => { window.sceneQaTime = new Date('2026-11-18T03:00:00+09:00').getTime() })
    await page.waitForTimeout(2200)
    const automaticNight = await sceneShot('.probe/wallpaper-scene/automatic-night.png')
    console.log('FRAME NIGHT TIME', await scene.locator('html').evaluate(() => new Date().toString()))
    await scene.locator('html').evaluate(() => { window.sceneQaTime = new Date('2026-11-18T13:46:00+09:00').getTime() })
    await page.waitForTimeout(2200)
    const automaticDay = await sceneShot('.probe/wallpaper-scene/automatic-day.png')
    console.log('FRAME DAY TIME', await scene.locator('html').evaluate(() => new Date().toString()))
    assert.notDeepEqual(automaticDay, automaticNight)
    const meanColor = async (png) => page.evaluate(async (bytes) => {
      const bitmap = await createImageBitmap(new Blob([Uint8Array.from(bytes)], { type: 'image/png' }))
      const target = document.createElement('canvas')
      target.width = 100
      target.height = 100
      const context = target.getContext('2d')
      context.drawImage(bitmap, bitmap.width * .54, bitmap.height * .15, bitmap.width * .19, bitmap.height * .65, 0, 0, 100, 100)
      const data = context.getImageData(0, 0, 100, 100).data
      const sums = [0, 0, 0]
      for (let i = 0; i < data.length; i += 4) for (let channel = 0; channel < 3; channel++) sums[channel] += data[i + channel]
      bitmap.close()
      return sums.map((sum) => sum / 10000)
    }, [...png])
    const dayColor = await meanColor(automaticDay)
    const nightColor = await meanColor(automaticNight)
    console.log('AUTO DAY/NIGHT COLOR', dayColor, nightColor)
    assert.ok(Math.abs(dayColor[0] - nightColor[0]) > 20, '自动时间模式应改变背景色调')
    if (process.argv.includes('--long')) {
      for (let elapsed = 15; elapsed <= 90; elapsed += 15) {
        await page.waitForTimeout(15000)
        const color = await meanColor(await sceneShot('.probe/wallpaper-scene/day-sustained.png'))
        assert.ok(color[0] > nightColor[0] + 40, '13:46 的日景不应在持续运行后退回夜景')
        assert.equal(await frame.getAttribute('data-scene-quality'), 'high', '功能性混合效果不应被自动降档关闭')
        console.log('PASS: 13:46 日景持续运行', elapsed, '秒')
      }
    }
    await time.selectOption('2')
    await page.waitForTimeout(600)
    const day = await sceneShot('.probe/wallpaper-scene/day.png')
    await time.selectOption('4')
    await page.waitForTimeout(600)
    const night = await sceneShot('.probe/wallpaper-scene/night.png')
    assert.notDeepEqual(day, night)
    console.log('PASS: 自动时间模式和手动时段切换后的画面更新')
  }
  if (scheduleFile) {
    const { periods } = JSON.parse(await readFile(scheduleFile, 'utf8'))
    if (automaticSchedule) await page.getByText('分时播放（自动）', { exact: true }).waitFor()
    else {
      await page.locator('.zh-wallpaper-time summary').click()
      const choice = page.waitForEvent('filechooser')
      await page.getByRole('button', { name: '导入分时配置', exact: true }).click()
      await (await choice).setFiles(scheduleFile)
      await page.getByText('已保存分时播放设置。', { exact: true }).waitFor()
    }
    const renderer = await (await frame.elementHandle()).contentFrame()
    periods.sort((a, b) => a.at.localeCompare(b.at))
    const midnight = periods.at(-1)
    const cases = [{ at: '00:00', start: midnight.start, end: midnight.end }, ...periods, periods[0]]
    for (const { at, start, end, entryStart, entryEnd } of cases) {
      await renderer.evaluate((at) => {
        window.sceneQaTime = new Date('2026-11-18T' + at + ':00+09:00').getTime()
      }, at)
      if (automaticSchedule && entryStart !== undefined) {
        await renderer.waitForFunction(({ from, to }) => [...document.querySelectorAll('video')].some((video) =>
          !video.paused && !video.seeking && video.playbackRate >= .9 && video.currentTime >= from && video.currentTime < to),
        { from: entryStart, to: entryEnd ?? start }, { timeout: 10000 })
        console.log('PASS:', at, '进入原片过渡')
      }
      await renderer.waitForFunction(([start, end]) => [...document.querySelectorAll('video')].some((video) =>
        !video.paused && !video.seeking && video.playbackRate >= .9 && video.currentTime >= start && video.currentTime < end), [start, end], { timeout: 15000 })
      await renderer.evaluate(({ start, end }) => {
        const [activeVideo] = [...document.querySelectorAll('video')].filter((video) => !video.paused &&
          video.playbackRate >= .9 && video.currentTime >= start && video.currentTime < end)
          .sort((a, b) => b.currentTime - a.currentTime)
        activeVideo.currentTime = end - 0.03
      }, { start, end })
      await renderer.waitForFunction(([start, end]) => [...document.querySelectorAll('video')].some((video) =>
        !video.paused && !video.seeking && video.playbackRate >= .9 && video.currentTime >= start &&
        video.currentTime < Math.min(start + 2, end)), [start, end], { timeout: 15000 })
    }
    console.log('PASS:', automaticSchedule ? '按素材自动匹配分时配置' : '导入分时配置', '跨午夜回绕，以及片段结束后在同一时段内循环')
    if (automaticSchedule && periods.length > 1) {
      const [first, second] = periods
      const boundary = Date.parse('2026-11-18T' + second.at + ':00+09:00')
      const entryStart = second.entryStart ?? second.start
      for (let loop = 0; loop < 3; loop++) {
        const original = await renderer.evaluateHandle(({ start, end }) => {
          const [video] = [...document.querySelectorAll('video')].filter((entry) => !entry.paused &&
            entry.playbackRate >= .9 && entry.currentTime >= start && entry.currentTime < end)
            .sort((a, b) => b.currentTime - a.currentTime)
          video.currentTime = end - 1.75
          return video
        }, first)
        const standby = await renderer.waitForFunction(({ active, start, end }) => {
          if (active.paused || active.currentTime >= end) return false
          return [...document.querySelectorAll('video')].find((video) =>
            video !== active && !video.paused && !video.seeking && video.playbackRate < .5 && video.duration === active.duration &&
            video.currentTime >= start + .025 && video.currentTime < start + .2)
        }, { active: original, ...first }, { timeout: 12000 })
        await renderer.waitForFunction(({ active, standby, start }) => active.paused && !standby.paused && !standby.seeking &&
          standby.playbackRate >= .9 && standby.currentTime >= start && standby.currentTime < start + 1.5,
        { active: original, standby, start: first.start }, { timeout: 12000 })
        await standby.dispose()
        await original.dispose()
      }
      const beforeBoundary = await renderer.evaluateHandle(({ start, boundary }) => {
        const video = [...document.querySelectorAll('video')].find((entry) => !entry.paused && entry.playbackRate >= .9)
        video.currentTime = start
        window.sceneQaTime = boundary - 500
        return video
      }, { start: first.start, boundary })
      const nextPeriod = await renderer.waitForFunction(({ active, start }) => [...document.querySelectorAll('video')].find((video) =>
        video !== active && !video.paused && !video.seeking && video.playbackRate < .5 &&
        video.duration === active.duration && video.currentTime >= start + .025 && video.currentTime < start + .2),
      { active: beforeBoundary, start: entryStart }, { timeout: 12000 })
      await renderer.evaluate(({ boundary, standby, start, end }) => {
        window.sceneQaTransition = { duration: standby.duration, start, end, frames: 0, seeks: 0 }
        standby.addEventListener('seeking', () => window.sceneQaTransition.seeks++)
        window.sceneQaTime = boundary
      }, { boundary, standby: nextPeriod, start: entryStart, end: second.start })
      await renderer.waitForFunction(({ standby, start }) => !standby.paused && !standby.seeking &&
        standby.playbackRate >= .9 && standby.currentTime >= start && standby.currentTime < start + 1.5,
      { standby: nextPeriod, start: entryStart }, { timeout: 12000 })
      if (fixedDay && second.entryStart !== undefined && second.entryEnd === undefined) {
        await renderer.waitForFunction(({ standby, start }) => !standby.seeking && standby.currentTime >= start,
          { standby: nextPeriod, start: second.start }, { timeout: 12000 })
        const transition = await renderer.evaluate(() => window.sceneQaTransition)
        assert.ok(transition.frames > 3, '应提交多帧原片过渡画面')
        assert.equal(transition.seeks, 0, '原片过渡和白天片段之间应顺序播放')
        console.log('PASS: 原片光影过渡实际渲染，播放头连续进入白天片段')
      }
      await nextPeriod.dispose()
      await beforeBoundary.dispose()
      console.log('PASS: 连续三次片段回绕及跨时段切换，备用视频在接手前已实际播放')
      if (fixedDay) {
        await renderer.waitForFunction(() => window.sceneQaFades > 0, undefined, { timeout: 5000 })
        console.log('PASS: 跨时段时上传了淡化过渡帧')
      }
      if (naturalLoops) {
        await renderer.evaluate(({ start, end }) => {
          window.sceneQaTime = new Date('2026-11-18T13:46:00+09:00').getTime()
          window.sceneQaLoop = { start, end, swaps: 0, coldSwaps: 0, blended: [], frames: 0 }
        }, second)
        const result = await renderer.waitForFunction(({ start, end }) => {
          const videos = [...document.querySelectorAll('video')]
          const [active] = videos.filter((video) => !video.paused && !video.seeking && video.playbackRate >= .9 &&
            video.currentTime >= start && video.currentTime < end).sort((a, b) => b.currentTime - a.currentTime)
          const observation = window.sceneQaLoop
          if (!active) return false
          if (observation.active && observation.active !== active) {
            observation.swaps++
            if (observation.warmed !== active) observation.coldSwaps++
            observation.blended.push(observation.blendedHead === active ? observation.frames : 0)
            observation.blendedHead = undefined
            observation.frames = 0
          }
          observation.active = active
          const warmed = videos.find((video) => video !== active && video.duration === active.duration && !video.paused &&
            !video.seeking && video.playbackRate < .5 && video.currentTime >= start + .025 && video.currentTime < start + .22)
          if (warmed) observation.warmed = warmed
          return observation.swaps >= 3 ? { coldSwaps: observation.coldSwaps, blended: observation.blended } : false
        }, second, { timeout: ((second.end - second.start) * 4 + 15) * 1000 })
        const measured = await result.jsonValue()
        assert.equal(measured.coldSwaps, 0, JSON.stringify(measured))
        assert.ok(measured.blended.length === 3 && measured.blended.every((frames) => frames > 0), JSON.stringify(measured))
        await result.dispose()
        console.log('PASS: 固定 13:46 自然循环三轮，每轮实际合成的片尾片头重叠帧数', measured.blended)
      }
    }
  }
  const playing = page.getByRole('checkbox', { name: '播放动画', exact: true })
  await playing.uncheck()
  await page.waitForFunction(() => Number(document.querySelector('iframe.zh-fx__wallpaper-scene')?.dataset.sceneFps) === 0)
  await playing.check()
  await page.waitForFunction(() => Number(document.querySelector('iframe.zh-fx__wallpaper-scene')?.dataset.sceneFps) > 0)
  await page.getByRole('combobox', { name: '背景缩放', exact: true }).selectOption('contain')
  const current = page.locator('.zh-lobby-history__item').filter({ has: page.locator('button[aria-pressed="true"]') })
  await current.getByRole('button', { name: /的备注$/ }).click()
  await current.getByRole('textbox', { name: '背景备注' }).fill('场景直读验证')
  await current.getByRole('button', { name: '保存备注', exact: true }).click()
  await current.getByRole('textbox', { name: '背景备注' }).waitFor({ state: 'hidden' })
  const imageChoice = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: '导入图片或视频', exact: true }).click()
  await (await imageChoice).setFiles(resolve('scripts/fixtures/wallpaper.png'))
  await page.locator('img.zh-fx__lobby-media').waitFor()
  assert.equal(await frame.count(), 0)
  await page.locator('.zh-lobby-history__item').filter({ hasText: '场景直读验证' }).getByRole('button', { name: /^使用「/ }).click()
  await page.waitForFunction(() => document.querySelector('iframe.zh-fx__wallpaper-scene')?.dataset.sceneState === 'ready')
  assert.equal(await page.getByRole('combobox', { name: '背景缩放', exact: true }).inputValue(), 'contain')
  if (await time.count()) assert.equal(await time.inputValue(), '4')
  if (scheduleFile) await page.getByText(automaticSchedule ? '分时播放（自动）' : '分时播放（已启用）', { exact: true }).waitFor()
  await page.reload()
  await page.waitForFunction(() => window.__EDITOR__?.isInitialized)
  await open()
  await page.waitForFunction(() => document.querySelector('iframe.zh-fx__wallpaper-scene')?.dataset.sceneState === 'ready')
  if (await time.count()) assert.equal(await time.inputValue(), '4')
  if (scheduleFile) await page.getByText(automaticSchedule ? '分时播放（自动）' : '分时播放（已启用）', { exact: true }).waitFor()
  if (automaticSchedule) {
    await page.getByText('分时播放（自动）', { exact: true }).click()
    await page.getByRole('button', { name: '预览整段视频', exact: true }).click()
    await page.getByText('正在循环预览整段视频。', { exact: true }).waitFor()
    await page.reload()
    await page.waitForFunction(() => window.__EDITOR__?.isInitialized)
    await open()
    await page.getByText('分时播放（整段预览）', { exact: true }).click()
    await page.getByRole('button', { name: '使用自动分时', exact: true }).click()
    await page.getByText('分时播放（自动）', { exact: true }).waitFor()
    console.log('PASS: 退出自动匹配后刷新保留选择，并可重新启用自动分时')
    if (fixedDay) {
      await page.evaluate(async () => {
        const db = await new Promise((resolve, reject) => {
          const request = indexedDB.open('md-editor-memory-lobby')
          request.onsuccess = () => resolve(request.result)
          request.onerror = () => reject(request.error)
        })
        const id = await new Promise((resolve, reject) => {
          const request = db.transaction('files').objectStore('files').get('history:current')
          request.onsuccess = () => resolve(request.result)
          request.onerror = () => reject(request.error)
        })
        db.close()
        if (!id) throw new Error('测试中缺少历史背景')
        localStorage.setItem('md-editor-wallpaper-time-v1:history:' + id, 'null')
      })
      await page.reload()
      await page.waitForFunction(() => window.__EDITOR__?.isInitialized)
      await open()
      await page.getByText('分时播放（自动）', { exact: true }).waitFor()
      const { periods } = JSON.parse(await readFile(scheduleFile, 'utf8'))
      const day = periods.find(({ at }) => at === '09:00')
      const renderer = await (await frame.elementHandle()).contentFrame()
      await renderer.evaluate(() => { window.sceneQaTime = new Date('2026-11-18T13:46:00+09:00').getTime() })
      await renderer.waitForFunction(({ start, end }) => [...document.querySelectorAll('video')].some((video) =>
        !video.paused && !video.seeking && video.playbackRate >= .9 && video.currentTime >= start && video.currentTime < end), day)
      await renderer.evaluate(({ start, end }) => {
        const active = [...document.querySelectorAll('video')].find((video) => !video.paused && video.playbackRate >= .9)
        window.sceneQaMonitor = { start, end, duration: active.duration, frames: 0, loops: 0, bad: [], began: performance.now() }
      }, day)
      const result = await renderer.waitForFunction(() => {
        const { duration, began, frames, loops, bad } = window.sceneQaMonitor
        return bad.length || performance.now() - began > (duration + 5) * 1000 ? { frames, loops, bad } : false
      }, undefined, { timeout: 110000 })
      const captured = await result.jsonValue()
      assert.deepEqual(captured.bad, [], '固定时钟下不应上传当前时段以外的帧')
      assert.ok(captured.frames > 150 && captured.loops >= 3, JSON.stringify(captured))
      await result.dispose()
      console.log('PASS: 旧版整段循环选择恢复自动分时；固定 13:46 超过原片一轮，所有已渲染视频帧都在白天片段')
    }
  }
  await page.locator('.zh-lobby-history__item').filter({ hasText: '场景直读验证' }).waitFor()
  await page.screenshot({ path: '.probe/wallpaper-scene/editor.png' })
  assert.deepEqual(requests, [])
  assert.deepEqual(errors, [])
  console.log('PASS: 场景直接渲染、离线与隔离、播放暂停、缩放、备注、历史切换及刷新恢复')
} finally { await browser.close() }
