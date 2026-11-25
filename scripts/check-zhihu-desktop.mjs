import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { once } from 'node:events'
import { chromium } from 'playwright-core'
import { makeAnimatedGif } from './make-test-gif.mjs'

const root = resolve('../Dadealbit-Zhihu-Exporter-Desktop')
const python = process.env.DADEALBIT_DESKTOP_PYTHON ?? resolve(root, '.venv/Scripts/python.exe')
const gif = makeAnimatedGif(0).toString('base64')
const target = resolve('Dadealbit Markdown 编辑器.html')
const fixture = String.raw`
import base64, json, sys, time
from types import SimpleNamespace
from unittest.mock import patch
from core.auth_manager import AuthManager
from core.editor_bridge import EditorBridge
from core.spider_engine import SpiderEngine

asset = 'https://picx.zhimg.com/editor-fixture.gif'
data = base64.b64decode(sys.argv[2])
article = '<h1 class="Post-Title">桌面导入示例</h1><div class="AuthorInfo-name">示例作者</div>' \
    '<div class="Post-RichText"><p>测试文字 <span class="ztext-math" data-block="false" data-tex="x^2+1"></span>。</p>' \
    '<table><tr><th>题目</th><th>结果</th></tr><tr><td>第一题</td><td>42</td></tr></table>' \
    '<img alt="离线动图" data-original="' + asset + '" src="https://picx.zhimg.com/preview.png"></div>'
answer = '<h1 class="QuestionHeader-title">示例问题</h1>' \
    '<div class="AnswerItem" data-answer-id="1000"><div class="RichText">其他回答</div></div>' \
    '<div class="AnswerItem" data-zop=\'{"itemId":1001}\'><div class="AuthorInfo-name">示例答主</div>' \
    '<div class="RichText">指定回答正文。</div></div>'

def document(_, url):
    return SimpleNamespace(text=answer if '/answer/' in url else article)

class ImageResponse:
    status_code = 200
    headers = {'Content-Type': 'image/gif'}
    def __enter__(self): return self
    def __exit__(self, *args): pass
    def iter_content(self, chunk_size): yield data

with patch.object(AuthManager, 'has_valid_cookies', return_value=True), \
        patch.object(SpiderEngine, '_load_cookies', return_value=[]), \
        patch.object(SpiderEngine, '_http_get', document), \
        patch('requests.get', return_value=ImageResponse()):
    bridge = EditorBridge()
    print(json.dumps(bridge.editor_url(sys.argv[1])), flush=True)
    sys.stdin.read()
    bridge.close()
`
const service = spawn(python, ['-u', '-c', fixture, target, gif], { cwd: root, windowsHide: true })
const lines = createInterface({ input: service.stdout })
const errors = []
service.stderr.on('data', (chunk) => errors.push(chunk.toString()))
const exited = once(service, 'exit')
let browser
try {
  const firstLine = await Promise.race([
    once(lines, 'line').then(([line]) => line),
    exited.then(() => { throw new Error(errors.join('')) }),
  ])
  const url = JSON.parse(firstLine)
  const pairing = new URLSearchParams(new URL(url).hash.slice(1))
  const endpoint = 'http://127.0.0.1:' + pairing.get('desktop-zhihu-port') + '/extract'
  const send = (origin, key, url) => fetch(endpoint, {
    method: 'POST', headers: { Origin: origin, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  })
  const article = 'https://zhuanlan.zhihu.com/p/1234567890'
  const key = pairing.get('desktop-zhihu-key')
  assert.equal((await send('https://example.test', key, article)).status, 403)
  assert.equal((await send('null', 'incorrect', article)).status, 403)
  assert.equal((await send('null', key, 'https://zhuanlan.zhihu.com.example.test/p/1234567890')).status, 400)

  browser = await chromium.launch({ channel: 'msedge', headless: true })
  const page = await browser.newPage()
  await page.route('https://picx.zhimg.com/**', (route) => route.abort())
  await page.goto(url)
  await page.waitForFunction(() => window.__EDITOR__?.isInitialized && !location.hash.includes('desktop-zhihu-key'))
  const importLink = async (address, title) => {
    await page.getByRole('button', { name: '打开方式', exact: true }).click()
    await page.getByRole('button', { name: '从知乎链接导入', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '从知乎链接导入' })
    await dialog.getByLabel('知乎文章或回答网址').fill(address)
    await dialog.getByRole('button', { name: '导入知乎内容' }).click()
    await page.getByRole('tab', { name: title, exact: true, selected: true }).waitFor({ timeout: 12000 })
    return page.evaluate(() => window.__MD__())
  }
  const imported = await importLink(article, '桌面导入示例')
  assert.match(imported, /\$x\^2\+1\$/)
  assert.match(imported, /\| 第一题 \| 42 \|/)
  assert.ok(imported.includes('data:image/gif;base64,' + gif))
  await page.reload()
  await page.waitForFunction(() => window.__EDITOR__?.isInitialized)
  const response = await importLink('https://zhihu.com/question/1234567890/answer/1001', '示例问题 - 示例答主的回答')
  assert.ok(response.includes('指定回答正文。') && !response.includes('其他回答'))
  await page.evaluate(() => window.__EDITOR__.commands.setContent('![外链动图](https://picx.zhimg.com/editor-fixture.gif)'))
  await page.getByTitle('更多', { exact: true }).click()
  await page.getByText('素材管理与断链修复', { exact: true }).click()
  const assets = page.getByRole('dialog', { name: '素材管理' })
  await assets.getByRole('button', { name: '保存远程素材（1）' }).click()
  await assets.getByRole('status').getByText(/已保存 1 张图片/).waitFor()
  assert.ok((await page.evaluate(() => window.__MD__())).includes('data:image/gif;base64,' + gif))
  console.log('PASS: 无扩展 Edge 通过桌面提取器导入文章、指定回答、公式、表格和原始 GIF，并可保存外链动图。')
} finally {
  if (browser) await browser.close()
  service.stdin.end()
  await exited
  lines.close()
}
