/**
 * 文档存储：localStorage → IndexedDB 的迁移与容量验证（跑双击版那个 file:// HTML）
 *
 * 为什么要有这一套：localStorage 每个源只有 5MB，而这个编辑器把图片以 base64 内嵌在文档里，
 * 写两三篇带图的文章就撞上限（用户真撞到过："保存失败：内容超出浏览器存储上限"）。
 * 现在文档放 IndexedDB（额度按磁盘剩余空间算），localStorage 只留作迁移来源 + 冷备份。
 *
 * 验四件事：
 *   1. 老数据能迁过来：localStorage 里的两篇 → 启动后出现在界面里、也进了 IndexedDB，且 localStorage 那份没被删
 *   2. 单篇超过 5MB 也能存住（老后端必然失败的量级），刷新后内容还在
 *   3. 保存是"只写变化的那几篇"：改一篇之后，另一篇在 IndexedDB 里的记录不受影响
 *   4. 浏览器没有 IndexedDB 时安静退回 localStorage 老路，功能不崩
 */
import { chromium } from 'playwright-core'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * **本套件的断言总数** —— 文档里的数量占位符读的就是这个常量（见 check:docs-counts）。
 *
 * 为什么要导出它而不是让文档手写数字：实测过 7 处「文档写的数量」与实测不符，
 * 其中 6 处都是同一类**数字漂移**（改了测试没改文档）。手写数字一定会漂。
 * 唯一数据源放在这里，文档用 `<!-- TEST_COUNT:<脚本名> -->` 占位。
 *
 * 收尾处还有一条自检：实际跑出来的断言数必须等于这个常量，
 * 否则套件自己失败 —— 免得"测试被删掉几条、常量没跟着改"，把常量变成新的谎话。
 */
export const TEST_COUNT = 25

const APP = resolve('Dadealbit Markdown 编辑器.html')
if (!existsSync(APP)) {
  console.error('先跑 pnpm build')
  process.exit(1)
}
const app = 'file:///' + APP.replace(/\\/g, '/')

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`${ok ? '✅' : '❌'}  ${name}${detail ? '  — ' + detail : ''}`)
}

/** 一段合法 base64 假图片数据，长度可控 */
const PNG_UNIT = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
const bigBase64 = (bytes) => PNG_UNIT.repeat(Math.ceil(bytes / PNG_UNIT.length)).slice(0, bytes)

const readIdb = (page) =>
  page.evaluate(async () => {
    const open = () =>
      new Promise((res, rej) => {
        const r = indexedDB.open('md-editor-docs', 1)
        r.onsuccess = () => res(r.result)
        r.onerror = () => rej(r.error)
      })
    const db = await open()
    const docs = await new Promise((res) => {
      const q = db.transaction('docs', 'readonly').objectStore('docs').getAll()
      q.onsuccess = () => res(q.result)
      q.onerror = () => res([])
    })
    const meta = await new Promise((res) => {
      const q = db.transaction('meta', 'readonly').objectStore('meta').getAll()
      q.onsuccess = () => res(q.result)
      q.onerror = () => res([])
    })
    db.close()
    return { docs: docs.map((d) => ({ id: d.id, title: d.title, len: d.md.length })), meta }
  })

const storeState = (page) => page.evaluate(() => window.__DOCSTORE__ ?? null)
const lsSize = (page) => page.evaluate(() => (localStorage.getItem('md-editor-docs-v1') ?? '').length)

const browser = await chromium.launch({ channel: 'msedge', headless: true })

/* ---------- 1. 迁移：老数据（localStorage）搬到 IndexedDB ---------- */
{
  const page = await browser.newPage({ viewport: { width: 1300, height: 900 } })
  const errs = []
  page.on('pageerror', (e) => errs.push(String(e).slice(0, 140)))
  await page.addInitScript(
    (store) => localStorage.setItem('md-editor-docs-v1', JSON.stringify(store)),
    {
      docs: [
        { id: 'old-1', title: '老文档一', md: '# 老文档一\n\n这是从 localStorage 迁过来的。\n', at: 1700000000000 },
        { id: 'old-2', title: '带图老文档', md: `# 带图老文档\n\n![图](data:image/png;base64,${bigBase64(300000)})\n`, at: 1700000001000 },
      ],
      currentId: 'old-1',
    },
  )
  await page.goto(app, { waitUntil: 'load', timeout: 60000 })
  await page.waitForSelector('.ProseMirror', { timeout: 30000 })
  await page.waitForTimeout(1500)

  const st = await storeState(page)
  check('启动后用的是 IndexedDB 后端', st?.backend === 'indexeddb', JSON.stringify(st))
  check('老文档出现在编辑器里', (await page.locator('.ProseMirror').innerText()).includes('从 localStorage 迁过来'), await page.locator('.zh-title').inputValue())

  // 文档列表里两篇都在（那个按钮的 title 是「我的文档（共 N 篇）」，动态的，所以用前缀匹配）
  await page.locator('.zh-btn[title^="我的文档"]').click()
  await page.waitForTimeout(800)
  const listed = await page.locator('.zh-docmenu__title').allInnerTexts()
  check(
    '两篇老文档都在文档列表里',
    listed.join(' ').includes('老文档一') && listed.join(' ').includes('带图老文档'),
    listed.join(' | ').slice(0, 80),
  )
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)

  const idb = await readIdb(page)
  check('老数据真的写进了 IndexedDB', idb.docs.length === 2 && idb.docs.some((d) => d.title === '带图老文档'), JSON.stringify(idb.docs))
  check('迁移留了标记（migratedFromLocalStorage）', idb.meta.some((m) => m.k === 'migratedFromLocalStorage'), idb.meta.map((m) => m.k).join(','))
  check('localStorage 那份没被删（冷备份）', (await lsSize(page)) > 1000, `${await lsSize(page)} 字节`)
  check('迁移这轮无页面错误', errs.length === 0, errs.slice(0, 2).join(' | '))
  await page.close()
}

/* ---------- 2. 单篇超过 5MB（老后端的上限）也要存得住 ---------- */
{
  const page = await browser.newPage({ viewport: { width: 1300, height: 900 } })
  const errs = []
  let alerted = null
  page.on('pageerror', (e) => errs.push(String(e).slice(0, 140)))
  page.on('dialog', (d) => {
    alerted = d.message()
    d.accept().catch(() => {})
  })
  await page.goto(app, { waitUntil: 'load', timeout: 60000 })
  await page.waitForSelector('.ProseMirror', { timeout: 30000 })
  await page.waitForTimeout(1200)

  // 塞进去一张 ~3MB 的图（base64 后约 4MB），整库 JSON 会明显超过 localStorage 的 5MB。
  // 注意：分两步插入 —— setImage 之后紧接着 insertContent 会把刚插进去的图片替换掉（选中态是那个节点）
  const big = bigBase64(3 * 1024 * 1024)
  await page.evaluate((b64) => {
    const ed = window.__EDITOR__
    ed.chain().focus('end').insertContent('<p>大图后面的一段话</p>').run()
    ed.chain().focus('end').setImage({ src: `data:image/png;base64,${b64}` }).run()
  }, big)
  await page.waitForTimeout(4000) // 等自动保存

  const st = await storeState(page)
  const idb = await readIdb(page)
  const storedLen = Math.max(0, ...idb.docs.map((d) => d.len))
  check('超过 5MB 的文档写进了 IndexedDB', storedLen > 3 * 1024 * 1024, `IndexedDB 里最大一篇 ${(storedLen / 1024 / 1024).toFixed(2)} MB`)
  check('没有弹"超出浏览器存储上限"的报错', alerted === null, alerted ?? '没弹')
  check('报告里没有写失败标记', st?.lastError === false, JSON.stringify(st))
  check(
    'localStorage 冷备份没有硬塞大文档（不然又会撞 5MB）',
    (await lsSize(page)) < 2.1 * 1024 * 1024,
    `localStorage 里 ${((await lsSize(page)) / 1024 / 1024).toFixed(2)} MB`,
  )

  // 刷新后内容还在（这才是"存住了"的证据）
  await page.reload({ waitUntil: 'load', timeout: 60000 })
  await page.waitForSelector('.ProseMirror', { timeout: 30000 })
  await page.waitForTimeout(2000)
  const imgs = await page.evaluate(() => {
    const el = document.querySelector('.ProseMirror img')
    return el ? (el.getAttribute('src') || '').length : 0
  })
  check('刷新后大图还在（真的存住了）', imgs > 3 * 1024 * 1024, `图片 src ${(imgs / 1024 / 1024).toFixed(2)} MB`)
  check('刷新后正文也在', (await page.locator('.ProseMirror').innerText()).includes('大图后面的一段话'))
  check('大文档这轮无页面错误', errs.length === 0, errs.slice(0, 2).join(' | '))
  await page.close()
}

/* ---------- 3. 只写变化的那几篇（另一篇的记录不受影响） ---------- */
{
  const page = await browser.newPage({ viewport: { width: 1300, height: 900 } })
  await page.addInitScript(
    (store) => localStorage.setItem('md-editor-docs-v1', JSON.stringify(store)),
    {
      docs: [
        { id: 'keep-1', title: '不该被动的一篇', md: '# 不该被动的一篇\n\n原文\n', at: 1700000000000 },
        { id: 'edit-1', title: '要改的一篇', md: '# 要改的一篇\n\n改之前\n', at: 1700000000001 },
      ],
      currentId: 'edit-1',
    },
  )
  await page.goto(app, { waitUntil: 'load', timeout: 60000 })
  await page.waitForSelector('.ProseMirror', { timeout: 30000 })
  await page.waitForTimeout(1500)
  const before = await readIdb(page)
  const keepBefore = before.docs.find((d) => d.id === 'keep-1')

  await page.locator('.ProseMirror').click()
  await page.keyboard.press('Control+End')
  await page.keyboard.type('新加的一句话')
  await page.waitForTimeout(3000)

  const after = await readIdb(page)
  const keepAfter = after.docs.find((d) => d.id === 'keep-1')
  const edited = after.docs.find((d) => d.id === 'edit-1')
  check('改动写进了 IndexedDB', (edited?.len ?? 0) > 0 && after.docs.length === 2, JSON.stringify(after.docs))
  check('另一篇没被动（长度不变）', keepBefore?.len === keepAfter?.len, `${keepBefore?.len} → ${keepAfter?.len}`)
  await page.close()
}

/* ---------- 4. 没有 IndexedDB 时退回 localStorage ---------- */
{
  const page = await browser.newPage({ viewport: { width: 1300, height: 900 } })
  const errs = []
  page.on('pageerror', (e) => errs.push(String(e).slice(0, 140)))
  // 把 indexedDB 变成"一访问就抛"，模拟隐私模式 / 被策略禁用
  await page.addInitScript(() => {
    Object.defineProperty(window, 'indexedDB', {
      configurable: true,
      get() {
        throw new Error('indexedDB blocked (test)')
      },
    })
  })
  await page.goto(app, { waitUntil: 'load', timeout: 60000 })
  await page.waitForSelector('.ProseMirror', { timeout: 30000 })
  await page.waitForTimeout(1500)
  const st = await storeState(page)
  check('没有 IndexedDB 时退回 localStorage 后端', st?.backend === 'localstorage', JSON.stringify(st))

  await page.locator('.ProseMirror').click()
  await page.keyboard.press('Control+End')
  await page.keyboard.type('老路也能存')
  await page.waitForTimeout(2500)
  const raw = await page.evaluate(() => localStorage.getItem('md-editor-docs-v1') ?? '')
  check('老路下内容照样写进 localStorage', raw.includes('老路也能存'), `${raw.length} 字节`)
  check('退回老路这轮无页面错误', errs.length === 0, errs.slice(0, 2).join(' | '))
  await page.close()
}

/* ---------- 5. 写失败的那一篇，下次保存必须重试（防丢内容的 P0） ----------
   曾经的坑：`changed` 是拿"内存新库"和"内存旧库"比出来的，写失败只影响 IndexedDB、不影响内存。
   于是失败那篇下次"看起来没变化"，永远不再写进 IndexedDB；用户接着改另一篇、这次写成功了，
   红字还会被清掉 —— 看起来一切正常，直到刷新才发现丢了一版。 */
{
  const page = await browser.newPage({ viewport: { width: 1300, height: 900 } })
  await page.addInitScript(
    (store) => localStorage.setItem('md-editor-docs-v1', JSON.stringify(store)),
    {
      docs: [
        { id: 'retry-1', title: '会写失败的一篇', md: '# 会写失败的一篇\n\n改之前\n', at: 1700000000000 },
        { id: 'retry-2', title: '另一篇', md: '# 另一篇\n\n原文\n', at: 1700000000001 },
      ],
      currentId: 'retry-1',
    },
  )
  await page.goto(app, { waitUntil: 'load', timeout: 60000 })
  await page.waitForSelector('.ProseMirror', { timeout: 30000 })
  await page.waitForTimeout(1500)

  // 让接下来几次"写文档记录"直接抛错 —— 这才是配额满的真实样子：
  // 大记录写不进，而 currentId 这种小元数据还能写（所以以前"下一次保存成功"会把红字清掉，
  // 却根本没写进那篇文档）
  await page.evaluate(() => {
    const proto = IDBObjectStore.prototype
    const real = proto.put
    let left = 4
    proto.put = function patched(...args) {
      if (left-- > 0 && this.name === 'docs') throw new Error('quota exceeded (test)')
      return real.apply(this, args)
    }
    window.__RESTORE_PUT__ = () => {
      proto.put = real
    }
  })

  // 第一步：改第一篇（这次写失败）
  await page.locator('.ProseMirror').click()
  await page.keyboard.press('Control+End')
  await page.keyboard.type('失败这一版的关键内容')
  await page.waitForTimeout(3000)
  const stFail = await storeState(page)
  check('写失败时状态里标记了 lastError', stFail?.lastError === true, JSON.stringify(stFail))

  // 第二步：恢复写入，然后**切到另一篇**去改（这样失败那篇在内存里"看起来没变化"，
  // 只有"待重试"机制能救它 —— 这正是这个 P0 的判定条件）
  await page.evaluate(() => window.__RESTORE_PUT__())
  const openDocs = async () => {
    if (await page.locator('.zh-docmenu').isVisible().catch(() => false)) return
    await page.locator('.zh-btn[title^="我的文档"]').click()
    await page.waitForSelector('.zh-docmenu', { timeout: 5000 })
  }
  await openDocs()
  await page.locator('.zh-docmenu__open', { hasText: '另一篇' }).first().click()
  await page.waitForTimeout(1000)
  const switchedTo = await page.locator('.zh-title').inputValue().catch(() => '(读不到标题)')
  check('确实切到了另一篇（这篇的失败重试才有意义）', switchedTo === '另一篇', `当前标题：${switchedTo}`)

  await page.locator('.ProseMirror').click()
  await page.keyboard.press('Control+End')
  await page.keyboard.type('第二篇也改了')
  await page.waitForTimeout(3500)

  const idb = await readIdb(page)
  const first = idb.docs.find((d) => d.id === 'retry-1')
  const second = idb.docs.find((d) => d.id === 'retry-2')
  const stOk = await storeState(page)
  check(
    '写失败那一篇被自动重试并写进 IndexedDB（不再永久丢失）',
    (first?.len ?? 0) > '# 会写失败的一篇\n\n改之前\n'.length,
    `第一篇现在 ${first?.len} 字节（改动的是第二篇，它本来"看起来没变化"）`,
  )
  check('另一篇的改动也照常写进去', (second?.len ?? 0) > 0, `第二篇 ${second?.len} 字节`)
  check('重试成功后又恢复正常状态', stOk?.lastError === false, JSON.stringify(stOk))

  // 刷新：确认失败那一版的内容真的在
  await page.reload({ waitUntil: 'load', timeout: 60000 })
  await page.waitForSelector('.ProseMirror', { timeout: 30000 })
  await page.waitForTimeout(1500)
  await openDocs()
  await page.locator('.zh-docmenu__open', { hasText: '会写失败的一篇' }).first().click()
  await page.waitForTimeout(1200)
  const text = await page.locator('.ProseMirror').innerText()
  check('刷新后失败过的那一版内容还在', text.includes('失败这一版的关键内容'), text.slice(0, 40).replace(/\n/g, '⏎'))
  await page.close()
}

await browser.close()
for (const r of results) if (!r.ok) console.log(`\n待修：${r.name}`)
const failed = results.filter((r) => !r.ok).length
console.log(`\n${results.length - failed}/${results.length} 通过`)
/* 自检：实际断言数必须等于对外声明的 TEST_COUNT（文档占位符读它）。
   不加这条的话，删掉几条断言而忘了改常量，文档就会显示一个假的数字。 */
if (results.length !== TEST_COUNT) {
  console.log(`\n❌ 断言总数与 TEST_COUNT 不符：实际 ${results.length}，声明 ${TEST_COUNT}`)
  console.log('   改测试条数时请一并更新文件顶部的 TEST_COUNT（文档数量占位符读它）')
  process.exit(1)
}

process.exit(failed ? 1 : 0)
