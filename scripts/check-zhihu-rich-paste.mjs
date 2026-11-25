import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import katex from 'katex'
import { chromium } from 'playwright-core'
import { makeAnimatedGif } from './make-test-gif.mjs'

const browser = await chromium.launch({ channel: 'msedge', headless: true })
try {
  const page = await browser.newPage()
  const editor = pathToFileURL(resolve('Dadealbit Markdown 编辑器.html')).href
  await page.goto(editor)
  await page.waitForFunction(() => window.__EDITOR__?.isInitialized)

  const image = 'data:image/gif;base64,' + makeAnimatedGif(0).toString('base64')
  const formula = 'f(x) = xe^x + ax + b'
  const sourceOnly = "f''(0)\\ne 0"
  const urlOnly = 'x_0+1'
  const block = '\\frac{1}{2}'
  const eqUrl = 'https://www.zhihu.com/equation?tex=' + encodeURIComponent(urlOnly)
  const html = '<p><strong>右边为 <img eeimg="1" alt="0" src="/equation?tex=0">，随后有 ' +
    '<img class="ee_img" alt="' + sourceOnly + '" src="https://www.zhihu.com/equation?tex=0">' +
    '。</strong></p><hr><blockquote><p>已知函数 ' +
    '<span class="ztext-math" data-tex="' + formula + '">' + katex.renderToString(formula) +
    '</span>，若 ' + katex.renderToString('x>0') +
    '，取 <img src="' + eqUrl + '">。<br>第 (2) 问。</p></blockquote>' +
    '<p>' + katex.renderToString(block, { displayMode: true }) + '</p>' +
    '<p><img alt="正文动图" src="' + image + '"></p>'

  const paste = (withPreview, clipboardHtml = html) => page.evaluate(({ html, image, withPreview }) => {
    const editor = window.__EDITOR__
    editor.commands.clearContent()
    editor.commands.focus()
    const transfer = new DataTransfer()
    transfer.setData('text/html', html)
    transfer.setData('text/plain', '右边为 0，已知函数 f(x) = xe^x + ax + b。')
    if (withPreview) {
      const bytes = Uint8Array.from(atob(image.split(',')[1]), (char) => char.charCodeAt(0))
      transfer.items.add(new File([bytes], 'clipboard-preview.gif', { type: 'image/gif' }))
    }
    editor.view.dom.dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }))
  }, { html: clipboardHtml, image, withPreview })

  const capture = () => page.evaluate(() => {
    const editor = window.__EDITOR__
    const math = []
    const images = []
    editor.state.doc.descendants((node) => {
      if (['mathInline', 'mathBlock'].includes(node.type.name)) math.push([node.type.name, node.attrs.latex])
      if (node.type.name === 'image') images.push([node.attrs.alt, node.attrs.src])
    })
    return { math, images, md: window.__MD__(), text: editor.state.doc.textContent }
  })
  const expectedMath = [
    ['mathInline', '0'], ['mathInline', sourceOnly], ['mathInline', formula],
    ['mathInline', 'x>0'], ['mathInline', urlOnly], ['mathBlock', block],
  ]
  for (const withPreview of [false, true]) {
    await paste(withPreview)
    const result = await capture()
    assert.deepEqual(result.math, expectedMath)
    assert.deepEqual(result.images, [['正文动图', image]])
    assert.match(result.md, /\*\*右边为/)
    assert.match(result.md, /^> 已知函数/m)
    assert.doesNotMatch(result.text, /f\(x\)|x>0|\\ne/)
    assert.equal(await page.locator('.ProseMirror hr').count(), 1)
    assert.equal(await page.locator('.ProseMirror blockquote br').count(), 1)
    assert.equal(await page.locator('.ProseMirror .katex-error').count(), 0)
    assert.ok(result.md.includes('$' + formula + '$'))
  }

  const marked = (latex) => '<span class="ztext-math" data-block="true" data-tex="' + latex + '">' +
    katex.renderToString(latex) + '</span>'
  const line = '例一:( ' + marked('2026') + ' 年新高考 ' + marked('II') + ' 卷第 ' + marked('19') +
    ' 题)已知函数 ' + marked(formula) + '。<br>(1) 求 ' + marked('a,b') + '。'
  for (const introductoryText of [line, '<div>' + line + '</div>']) {
    await paste(false, '<blockquote>' + introductoryText + '<p>下面是独立公式。</p>' +
      katex.renderToString(block, { displayMode: true }) + '<p>继续正文。</p></blockquote>')
    const result = await capture()
    assert.deepEqual(result.math, [
      ['mathInline', '2026'], ['mathInline', 'II'], ['mathInline', '19'],
      ['mathInline', formula], ['mathInline', 'a,b'], ['mathBlock', block],
    ])
    const quote = page.locator('.ProseMirror blockquote')
    const start = quote.locator('p').first()
    assert.equal(await start.locator('.math-node').count(), 5)
    assert.equal(await start.locator('br').count(), 1)
    assert.equal(await quote.locator('.math-node--block').count(), 1)
    assert.match(result.md, /例一:\( \$2026\$ 年新高考 \$II\$ 卷第 \$19\$/)
    const lineTops = await start.locator('.math-node').evaluateAll((formulas) =>
      formulas.slice(0, 3).map((formula) => formula.getBoundingClientRect().top))
    assert.ok(Math.max(...lineTops) - Math.min(...lineTops) < 8, JSON.stringify(lineTops))
  }
  console.log('PASS: 知乎富文本粘贴保留引用中的行内公式、原有换行、独立公式、加粗、分隔线和动图。')
} finally {
  await browser.close()
}
