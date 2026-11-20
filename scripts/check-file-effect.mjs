/** 验证双击版（file://）单文件里的鼠标特效是否生效 */
import { chromium } from 'playwright-core'
import { resolve } from 'node:path'

const url = 'file:///' + resolve('Dadealbit Markdown 编辑器.html').replace(/\\/g, '/')
const browser = await chromium.launch({ channel: 'msedge', headless: true })
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } })
const errs = []
page.on('pageerror', (e) => errs.push(String(e).slice(0, 110)))
page.on('console', (m) => {
  if (m.type() === 'error') errs.push(m.text().slice(0, 110))
})

await page.goto(url, { waitUntil: 'load', timeout: 60000 })
await page.waitForSelector('.ProseMirror', { timeout: 30000 })
await page.waitForTimeout(1500)

const canvas = await page.evaluate(() => {
  const c = document.getElementById('sparkCanvas')
  return c ? { ok: true, pointerEvents: getComputedStyle(c).pointerEvents, zIndex: getComputedStyle(c).zIndex } : { ok: false }
})
console.log('  画布: ' + JSON.stringify(canvas))

await page.mouse.click(600, 420)
await page.waitForTimeout(120)
const px = await page.evaluate(() => {
  const c = document.getElementById('sparkCanvas')
  const d = c.getContext('2d').getImageData(450, 300, 300, 300).data
  let n = 0
  for (let i = 3; i < d.length; i += 4) if (d[i] > 8) n += 1
  return n
})
console.log('  点击后该区域非透明像素: ' + px + (px > 200 ? '  ✅ 特效生效' : '  ❌ 没画出来'))
await page.screenshot({ path: resolve('.probe', 'file-spark.png'), clip: { x: 480, y: 330, width: 240, height: 180 } })

// 那一击可能正好点中演示内容里的公式（会弹出公式编辑器），先关掉再操作菜单
await page.keyboard.press('Escape')
await page.waitForTimeout(400)

await page.locator('.zh-btn[title^="特效"]').click()
await page.waitForSelector('.zh-fx', { timeout: 4000 })
await page.getByRole('button', { name: '鼠标', exact: true }).click()
await page.waitForTimeout(300)
const items = await page.locator('.zh-fx__mode').allInnerTexts()
console.log('  面板里的档位: ' + items.map((s) => s.trim()).join(' / '))
await page.keyboard.press('Escape')

// 关掉后应该不再绘制
await page.locator('.zh-btn[title^="特效"]').click()
await page.waitForSelector('.zh-fx', { timeout: 4000 })
await page.getByRole('button', { name: '鼠标', exact: true }).click()
await page.locator('.zh-fx__mode', { hasText: '关闭' }).click()
await page.waitForTimeout(400)
await page.keyboard.press('Escape')
await page.mouse.click(600, 420)
await page.waitForTimeout(150)
const offPx = await page.evaluate(() => {
  const c = document.getElementById('sparkCanvas')
  if (!c || getComputedStyle(c).display === 'none') return -2
  const d = c.getContext('2d').getImageData(450, 300, 300, 300).data
  let n = 0
  for (let i = 3; i < d.length; i += 4) if (d[i] > 8) n += 1
  return n
})
console.log('  切到「关闭」后再点击: ' + offPx + (offPx <= 0 ? '  ✅ 已关闭' : '  ❌ 还在画'))
console.log('  控制台错误: ' + (errs.length ? errs.slice(0, 2).join(' | ') : '无'))

await browser.close()
