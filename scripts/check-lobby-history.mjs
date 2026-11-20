import assert from 'node:assert/strict'
import { mkdir, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { chromium } from 'playwright-core'
import { makeAnimatedGif } from './make-test-gif.mjs'

const browser = await chromium.launch({ channel: 'msedge', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, offline: true })
  page.setDefaultTimeout(15000)
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => { if (message.type() === 'error') console.error('Browser', message.text().slice(0, 280)) })
  await page.goto(pathToFileURL(resolve('Dadealbit Markdown 编辑器.html')).href)
  await page.waitForFunction(() => window.__EDITOR__?.isInitialized)
  await page.evaluate(async (png) => {
    const db = await new Promise((resolve, reject) => {
      const req = indexedDB.open('md-editor-memory-lobby', 1)
      req.onupgradeneeded = () => req.result.createObjectStore('files')
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
    await new Promise((resolve, reject) => {
      const tx = db.transaction('files', 'readwrite')
      tx.objectStore('files').put({ file: new File([Uint8Array.from(png)], '旧背景.png', { type: 'image/png' }), name: '旧的背景标题' }, 'media')
      tx.objectStore('files').put([new File(['incomplete old asset'], 'legacy.skel')], 'active')
      tx.oncomplete = resolve
      tx.onabort = () => reject(tx.error)
    })
    db.close()
  }, [...await readFile('scripts/fixtures/wallpaper.png')])
  const open = async () => {
    if (!await page.getByRole('switch', { name: '动态壁纸', exact: true }).isVisible()) await page.getByTitle('特效', { exact: true }).click()
  }
  const pick = async (file) => {
    const pending = page.waitForEvent('filechooser')
    await page.getByRole('button', { name: '导入图片或视频', exact: true }).click()
    await (await pending).setFiles(file)
  }
  const rows = page.locator('.zh-lobby-history__item')
  const history = page.getByRole('list', { name: '背景使用记录' })
  const waitCount = (count) => page.waitForFunction((count) => document.querySelectorAll('.zh-lobby-history__item').length === count, count)
  const status = page.locator('.zh-fx__lobby [role="status"]')
  const note = async (item, text) => {
    await item.getByRole('button', { name: /的备注$/ }).click()
    await item.getByRole('textbox', { name: '背景备注' }).fill(text)
    await item.getByRole('button', { name: '保存备注', exact: true }).click()
    await item.getByRole('textbox', { name: '背景备注' }).waitFor({ state: 'hidden' })
  }
  const saved = async () => page.evaluate(async () => {
    const db = await new Promise((resolve) => {
      const req = indexedDB.open('md-editor-memory-lobby', 1)
      req.onsuccess = () => resolve(req.result)
    })
    try {
      return await new Promise((resolve, reject) => {
        const request = db.transaction('files', 'readonly').objectStore('files')
          .getAll(IDBKeyRange.bound('history:meta:', 'history:meta:\uffff'))
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
    } finally { db.close() }
  })
  await open()
  await waitCount(2)
  await page.getByRole('switch', { name: '动态壁纸', exact: true }).check()
  await status.filter({ hasText: '旧的背景标题' }).waitFor()
  const hasBuiltIn = await page.getByRole('button', { name: '使用内置壁纸', exact: true }).isVisible()
  await note(rows.filter({ hasText: '旧的背景标题' }), '从旧版迁移的背景')
  assert.equal((await saved()).find((entry) => entry.name === '旧的背景标题').note, '从旧版迁移的背景')
  await history.getByRole('button', { name: '使用「legacy.skel」', exact: true }).click()
  await status.filter({ hasText: /图集|骨骼|未启用 Spine/ }).waitFor()
  assert.equal(await page.locator('img.zh-fx__lobby-media').count(), 1)
  await waitCount(2)
  const images = await page.evaluate(() => ['#ff0000', '#0000ff'].map((fill) => {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 4
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = fill
    ctx.fillRect(0, 0, 4, 4)
    return canvas.toDataURL('image/png').split(',')[1]
  }))
  const sameNameImage = (index) => {
    const png = Buffer.from(images[index], 'base64')
    return { name: '背景.png', mimeType: 'image/png', buffer: Buffer.concat([png, Buffer.alloc(1024 - png.length)]) }
  }
  await pick(sameNameImage(0))
  await waitCount(3)
  const redId = (await saved()).find((entry) => entry.name === '背景.png').id
  await note(rows.filter({ hasText: '背景.png' }), '红色背景\n长文写作')
  await page.getByRole('combobox', { name: '背景缩放', exact: true }).selectOption('contain')
  await pick(sameNameImage(1))
  await waitCount(4)
  const imageEntries = (await saved()).filter((entry) => entry.name === '背景.png')
  assert.equal(imageEntries.length, 2)
  assert.notEqual(imageEntries[0].id, imageEntries[1].id)
  await note(rows.filter({ has: page.locator('button[aria-pressed="true"]') }), '蓝色背景')
  await pick(sameNameImage(0))
  await waitCount(4)
  await page.waitForFunction(() => document.querySelector('button[aria-pressed="true"] .zh-lobby-history__note')?.textContent?.includes('红色背景'))
  assert.equal((await saved()).find((entry) => entry.id === redId).note, '红色背景\n长文写作')
  const animation = makeAnimatedGif()
  await pick({ name: '两帧动画.gif', mimeType: 'image/gif', buffer: animation })
  await waitCount(5)
  await pick(resolve('scripts/fixtures/wallpaper.webm'))
  await waitCount(6)
  await page.waitForFunction(() => document.querySelector('video.zh-fx__lobby-media')?.videoWidth > 0)
  await page.reload()
  await page.waitForFunction(() => window.__EDITOR__?.isInitialized)
  await open()
  await waitCount(6)
  await status.filter({ hasText: 'wallpaper.webm' }).waitFor()
  await rows.filter({ hasText: '红色背景' }).getByRole('button', { name: '使用「背景.png」', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('button[aria-pressed="true"] .zh-lobby-history__note')?.textContent?.includes('红色背景'))
  assert.equal(await page.getByRole('combobox', { name: '背景缩放' }).inputValue(), 'contain')
  await page.getByRole('searchbox', { name: '搜索背景记录' }).fill('蓝色')
  await waitCount(1)
  await rows.getByRole('button', { name: '使用「背景.png」', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('button[aria-pressed="true"] .zh-lobby-history__note')?.textContent === '蓝色背景')
  await page.getByRole('searchbox', { name: '搜索背景记录' }).fill('')
  await waitCount(6)
  await history.getByRole('button', { name: '使用「两帧动画.gif」', exact: true }).click()
  await status.filter({ hasText: '两帧动画.gif' }).waitFor()
  const bytes = await page.locator('img.zh-fx__lobby-media').evaluate(async (image) => [...new Uint8Array(await (await fetch(image.src)).arrayBuffer())])
  assert.deepEqual(Buffer.from(bytes), animation)
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put
    IDBObjectStore.prototype.put = function (value, key) {
      if (window.failHistoryWrite && String(key).startsWith('history:source:')) throw new DOMException('Test quota exceeded', 'QuotaExceededError')
      return original.call(this, value, key)
    }
    window.failHistoryWrite = true
  })
  await pick({ name: '仅当前会话.png', mimeType: 'image/png', buffer: Buffer.from(images[0], 'base64') })
  await page.getByRole('alert').filter({ hasText: /使用记录未能保存/ }).waitFor()
  assert.equal((await saved()).length, 6)
  await page.evaluate(() => { window.failHistoryWrite = false })
  await pick({ name: '仅当前会话.png', mimeType: 'image/png', buffer: Buffer.from(images[0], 'base64') })
  await waitCount(7)
  await page.getByRole('switch', { name: '动态壁纸', exact: true }).uncheck()
  await history.getByRole('button', { name: '使用「两帧动画.gif」', exact: true }).click()
  await page.waitForFunction(() => document.documentElement.dataset.memoryLobby === 'on')
  assert.equal(await page.getByRole('switch', { name: '动态壁纸', exact: true }).isChecked(), true)
  await page.evaluate(() => {
    Object.defineProperty(navigator.mediaDevices, 'getDisplayMedia', { configurable: true, value: async () => {
      window.shareCalls = (window.shareCalls ?? 0) + 1
      const canvas = document.createElement('canvas')
      canvas.width = 640
      canvas.height = 360
      const stream = canvas.captureStream(30)
      Object.defineProperty(stream.getVideoTracks()[0], 'label', { value: '测试壁纸窗口' })
      return stream
    } })
  })
  await page.getByRole('button', { name: '共享 Wallpaper 窗口', exact: true }).click()
  await waitCount(8)
  await page.locator('video.zh-fx__lobby-window').waitFor()
  const shared = (await saved()).find((entry) => entry.kind === 'window')
  await history.getByRole('button', { name: '使用「两帧动画.gif」', exact: true }).click()
  await history.getByRole('button', { name: '使用「' + shared.name + '」', exact: true }).click()
  await page.waitForFunction(() => window.shareCalls === 2)
  await waitCount(8)
  if (process.argv[2]) {
    const pending = page.waitForEvent('filechooser')
    await page.getByRole('button', { name: '导入 Wallpaper Engine 项目', exact: true }).click()
    await (await pending).setFiles(join(process.argv[2], '3538671760'))
    await waitCount(9)
    await status.filter({ hasText: /Spine 2K/ }).waitFor()
    await page.getByRole('button', { name: '使用 4K', exact: true }).click()
    await waitCount(10)
    await status.filter({ hasText: /Spine 4K/ }).waitFor()
    await note(rows.filter({ hasText: /Spine 4K/ }), '泳装弥香 · 日常写作')
    await history.getByRole('button', { name: '使用「两帧动画.gif」', exact: true }).click()
    await status.filter({ hasText: '两帧动画.gif' }).waitFor()
    await rows.filter({ hasText: '泳装弥香 · 日常写作' }).getByRole('button', { name: /^使用「/ }).click()
    await status.filter({ hasText: /Spine 4K/ }).waitFor()
    await page.locator('canvas.zh-fx__lobby-stage').waitFor()
    await page.reload()
    await page.waitForFunction(() => window.__EDITOR__?.isInitialized)
    await open()
    await waitCount(10)
    await status.filter({ hasText: /Spine 4K/ }).waitFor()
    await rows.filter({ hasText: '泳装弥香 · 日常写作' }).waitFor()
    await mkdir('.probe/lobby-history', { recursive: true })
    await page.screenshot({ path: '.probe/lobby-history/records.png' })
    console.log('PASS: 真实 Wallpaper Spine 2K/4K 记录、备注、历史切换及刷新恢复')
  }
  let count = (await saved()).length
  await history.getByRole('button', { name: '使用「两帧动画.gif」', exact: true }).click()
  await status.filter({ hasText: '两帧动画.gif' }).waitFor()
  const gifId = (await saved()).find(entry => entry.name === '两帧动画.gif').id
  // 模拟旧版迁移后尚无 current 的状态，删除其他记录仍应保留当前背景。
  await page.evaluate(async (id) => {
    const db = await new Promise(resolve => { const request = indexedDB.open('md-editor-memory-lobby', 1); request.onsuccess = () => resolve(request.result) })
    try {
      await new Promise((resolve, reject) => {
        const tx = db.transaction('files', 'readwrite')
        const store = tx.objectStore('files')
        store.delete('history:current')
        const request = store.get('history:source:' + id)
        request.onsuccess = () => store.put({ file: request.result.file, name: request.result.name }, 'media')
        store.put([new File(['old cache'], 'legacy.skel')], 'active')
        tx.oncomplete = resolve
        tx.onabort = () => reject(tx.error)
      })
    } finally { db.close() }
    const original = IDBObjectStore.prototype.delete
    IDBObjectStore.prototype.delete = function (key) {
      if (window.failHistoryDelete && String(key).startsWith('history:source:')) throw new DOMException('Test delete failed', 'UnknownError')
      return original.call(this, key)
    }
    window.failHistoryDelete = true
  }, gifId)
  const legacy = rows.filter({ has: page.getByRole('button', { name: '使用「legacy.skel」', exact: true }) })
  await legacy.getByRole('button', { name: /的记录$/ }).click()
  await legacy.getByRole('button', { name: '确认删除', exact: true }).click()
  await page.getByRole('alert').filter({ hasText: '记录删除失败' }).waitFor()
  assert.equal((await saved()).length, count)
  await page.evaluate(() => { window.failHistoryDelete = false })
  await legacy.getByRole('button', { name: '确认删除', exact: true }).click()
  await waitCount(--count)
  const storage = async (id) => page.evaluate(async (id) => {
    const db = await new Promise(resolve => { const request = indexedDB.open('md-editor-memory-lobby', 1); request.onsuccess = () => resolve(request.result) })
    try {
      return await new Promise((resolve, reject) => {
        const store = db.transaction('files', 'readonly').objectStore('files')
        const values = {}
        const keys = ['history:meta:' + id, 'history:source:' + id, 'history:current', 'active', 'media']
        for (const key of keys) {
          const request = store.get(key)
          request.onsuccess = () => { values[key] = request.result; if (Object.keys(values).length === keys.length) resolve(values) }
          request.onerror = () => reject(request.error)
        }
      })
    } finally { db.close() }
  }, id)
  assert.equal((await storage(gifId))['history:current'], gifId)
  await page.reload()
  await page.waitForFunction(() => window.__EDITOR__?.isInitialized)
  await open()
  await waitCount(count)
  await status.filter({ hasText: '两帧动画.gif' }).waitFor()
  assert.equal(await history.getByRole('button', { name: '使用「legacy.skel」', exact: true }).count(), 0)
  const red = rows.filter({ hasText: '红色背景' })
  const currentImage = await page.locator('img.zh-fx__lobby-media').getAttribute('src')
  await red.getByRole('button', { name: /的记录$/ }).click()
  await red.getByRole('group', { name: '删除背景记录' }).getByRole('button', { name: '取消', exact: true }).click()
  assert.equal((await saved()).length, count)
  await red.getByRole('button', { name: /的记录$/ }).click()
  await red.getByRole('button', { name: '确认删除', exact: true }).click()
  await waitCount(--count)
  const deleted = await storage(redId)
  assert.equal(deleted['history:meta:' + redId], undefined)
  assert.equal(deleted['history:source:' + redId], undefined)
  assert.equal(deleted.active, undefined)
  assert.equal(deleted.media, undefined)
  assert.equal(await page.locator('img.zh-fx__lobby-media').getAttribute('src'), currentImage)
  const gif = rows.filter({ has: page.getByRole('button', { name: '使用「两帧动画.gif」', exact: true }) })
  await gif.getByRole('button', { name: /的记录$/ }).click()
  await gif.getByText(/当前背景仅在本次会话中保留/).waitFor()
  await gif.getByRole('button', { name: '确认删除', exact: true }).click()
  await waitCount(--count)
  assert.equal((await storage(gifId))['history:current'], undefined)
  assert.equal((await storage(gifId))['history:source:' + gifId], undefined)
  assert.equal(await page.locator('img.zh-fx__lobby-media').getAttribute('src'), currentImage, '删除当前记录不应中断本次显示')
  await page.reload()
  await page.waitForFunction(() => window.__EDITOR__?.isInitialized)
  await open()
  await status.filter({ hasText: hasBuiltIn ? 'CH0294 海边壁纸' : '请选择背景来源。' }).waitFor()
  assert.equal(await history.getByRole('button', { name: '使用「两帧动画.gif」', exact: true }).count(), 0, '刷新后删除记录不应复活')
  assert.equal(await page.locator('img.zh-fx__lobby-media').count(), 0)
  if (hasBuiltIn) {
    await page.evaluate(async () => {
      const db = await new Promise((resolve, reject) => {
        const request = indexedDB.open('md-editor-memory-lobby')
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
      try {
        await new Promise((resolve, reject) => {
          const tx = db.transaction('files', 'readwrite')
          const store = tx.objectStore('files')
          const id = 'built-in:CH0294_home'
          const oldName = 'CH0294 海边大厅'
          const meta = store.get('history:meta:' + id)
          meta.onsuccess = () => store.put({ ...meta.result, name: oldName, note: '旧版内置壁纸备注' }, 'history:meta:' + id)
          const source = store.get('history:source:' + id)
          source.onsuccess = () => store.put({ ...source.result, name: oldName }, 'history:source:' + id)
          store.put(id, 'history:current')
          tx.oncomplete = resolve
          tx.onabort = () => reject(tx.error)
        })
      } finally { db.close() }
    })
    await page.reload()
    await page.waitForFunction(() => window.__EDITOR__?.isInitialized)
    await open()
    await status.filter({ hasText: 'CH0294 海边壁纸' }).waitFor()
    const builtIn = rows.filter({ has: page.getByRole('button', { name: '使用「CH0294 海边壁纸」', exact: true }) })
    await builtIn.getByText('旧版内置壁纸备注', { exact: true }).waitFor()
    assert.equal(await history.getByRole('button', { name: '使用「CH0294 海边大厅」', exact: true }).count(), 0)
    console.log('PASS: 旧版内置壁纸在状态和历史记录中显示新名称，备注保留。')
  }

  const presetDetails = page.locator('details').filter({ has: page.locator('summary').filter({ hasText: /^写作场景预设/ }) })
  const presets = page.getByRole('list', { name: '写作场景' })
  const openPresets = async () => {
    await open()
    if (!await presets.isVisible()) await presetDetails.locator('summary').click()
  }
  const savePreset = async (name) => {
    await openPresets()
    await presetDetails.getByRole('textbox', { name: '预设名称' }).fill(name)
    await presetDetails.getByRole('button', { name: '保存当前场景', exact: true }).click()
    await presets.getByRole('button', { name: '应用「' + name + '」', exact: true }).waitFor()
  }
  const chooseDoc = async (name) => {
    await page.keyboard.press('Escape')
    await page.getByTitle(/^我的文档/).click()
    await page.locator('.zh-docmenu').getByText(name, { exact: true }).click()
  }
  const wallpaper = (fileName) => status.filter({ hasText: fileName }).waitFor()
  await page.locator('.zh-title').fill('第一篇预设文档')
  await open()
  await pick({ ...sameNameImage(0), name: '白天壁纸.png' })
  await wallpaper('白天壁纸.png')
  await page.getByRole('combobox', { name: '材质', exact: true }).selectOption('frosted')
  await page.getByRole('slider', { name: '面板不透明度', exact: true }).press('Home')
  await page.getByRole('combobox', { name: '背景缩放', exact: true }).selectOption('contain')
  await savePreset('白天写作')
  await presets.getByRole('button', { name: '绑定「白天写作」到本文档', exact: true }).click()
  await page.keyboard.press('Escape')
  await page.locator('.zh-title').focus()
  await page.keyboard.press('Control+Alt+n')
  await page.locator('.zh-title').fill('第二篇预设文档')
  await open()
  await pick({ ...sameNameImage(1), name: '夜间壁纸.png' })
  await wallpaper('夜间壁纸.png')
  await page.getByRole('slider', { name: '面板不透明度', exact: true }).press('End')
  await page.getByRole('combobox', { name: '材质', exact: true }).selectOption('solid')
  await savePreset('夜间阅读')
  await presets.getByRole('button', { name: '绑定「夜间阅读」到本文档', exact: true }).click()
  await presets.getByRole('button', { name: '应用「白天写作」', exact: true }).click()
  await wallpaper('白天壁纸.png')
  assert.equal(await page.getByRole('slider', { name: '面板不透明度', exact: true }).inputValue(), '0')
  assert.equal(await page.getByRole('combobox', { name: '背景缩放', exact: true }).inputValue(), 'contain')
  await chooseDoc('第一篇预设文档')
  await open()
  await wallpaper('白天壁纸.png')
  await chooseDoc('第二篇预设文档')
  await open()
  await wallpaper('夜间壁纸.png')
  assert.equal(await page.locator('html').getAttribute('data-lobby-material'), 'solid')
  await page.reload()
  await page.waitForFunction(() => window.__EDITOR__?.isInitialized)
  await openPresets()
  await wallpaper('夜间壁纸.png')
  await presets.getByRole('button', { name: '解除「夜间阅读」与本文档的关联', exact: true }).waitFor()
  assert.deepEqual(errors, [])
  console.log('PASS: 写作预设一键套用、文档切换时自动恢复壁纸、材质及构图、重载后恢复关联。')
  console.log('PASS: 取消删除、失败回滚、移除记录及缓存、保留当前画面、旧版恢复入口及刷新后不再出现。')
  console.log('PASS: 旧背景迁移、重复导入合并、同名图片区分、备注和搜索、刷新重用、构图恢复、GIF 字节、视频、存储失败回滚及窗口重新授权。')
} finally { await browser.close() }
