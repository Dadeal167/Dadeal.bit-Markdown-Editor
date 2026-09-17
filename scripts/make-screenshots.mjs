/**
 * 给 README 拍截图（用分享的纯净版，file:// 打开）
 *   docs/screenshot-editor.png   —— 编辑器主界面
 *   docs/screenshot-formula.png  —— 公式弹窗（分类符号面板）
 */
import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { resolve } from 'node:path'

const DOCS = resolve('docs')
mkdirSync(DOCS, { recursive: true })

const target = resolve(process.argv[2] ?? resolve(homedir(), 'Desktop', 'Dadealbit Markdown编辑器', 'Dadealbit Markdown 编辑器.html'))
const url = 'file:///' + target.replace(/\\/g, '/')
console.log('截图对象：' + target)

const browser = await chromium.launch({ channel: 'msedge', headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.5 })
await page.goto(url, { waitUntil: 'load', timeout: 60000 })
await page.waitForSelector('.ProseMirror', { timeout: 30000 })
await page.waitForTimeout(2000)

// 1. 编辑器主界面：填个像样的标题，让示例内容当正文
await page.locator('.zh-title').fill('高中数学笔记 · 数列与不等式')
await page.waitForTimeout(600)
await page.screenshot({ path: resolve(DOCS, 'screenshot-editor.png') })
console.log('  ✓ screenshot-editor.png')

// 2. 公式弹窗（符号面板是个浮层，截图时保持关闭，让 TeX 输入 + 实时预览可见）
await page.locator('.zh-btn[title="公式"]').click()
await page.waitForSelector('.zh-modal--math', { timeout: 5000 })
await page.locator('.zh-mathsource').focus()
await page.keyboard.type('\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}', { delay: 12 })
await page.waitForTimeout(1200)
await page.screenshot({ path: resolve(DOCS, 'screenshot-formula.png'), clip: { x: 200, y: 90, width: 1040, height: 720 } })
console.log('  ✓ screenshot-formula.png')

// 3. 符号面板（点分类后的样子）
await page.locator('.zh-mathcat', { hasText: '希腊字母' }).click()
await page.waitForTimeout(800)
await page.screenshot({ path: resolve(DOCS, 'screenshot-symbols.png'), clip: { x: 200, y: 90, width: 1040, height: 720 } })
console.log('  ✓ screenshot-symbols.png')

await browser.close()
