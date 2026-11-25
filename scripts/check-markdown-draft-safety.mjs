import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { chromium } from 'playwright-core'
import { unzipSync } from 'fflate'

const app = pathToFileURL(resolve('Dadealbit Markdown 编辑器.html')).href
const yaml = '---\ntitle: 草稿回归\nbudget: "$120"\n---\n\n'
const source = yaml + [
  '# 草稿回归', '',
  '- [ ] 未完成', '- [x] 已完成', '  - [ ] 嵌套任务', '- 普通项目', '- \\[x\\] 字面括号', '',
  '> [!TIP]', '> 有 **两段** 内容。', '>', '> 第二段。', '',
  '正文含 $x^2+1$ 和 `$x$`。',
].join('\n')
const browser = await chromium.launch({ channel: 'msedge' })

try {
  for (const backend of ['indexeddb', 'localstorage']) {
    const context = await browser.newContext({ viewport: { width: 1400, height: 900 } })
    if (backend === 'localstorage') await context.addInitScript(() => {
      Object.defineProperty(window, 'indexedDB', { value: undefined })
    })
    try {
      const open = async () => {
        const page = await context.newPage()
        await page.goto(app)
        await page.waitForFunction((expected) => window.__EDITOR__?.isInitialized && window.__DOCSTORE__?.backend === expected, backend)
        return page
      }
      const first = await open()
      const importMarkdown = async (name, markdown) => {
        const chooser = first.waitForEvent('filechooser')
        await first.getByTitle('打开', { exact: true }).click()
        await (await chooser).setFiles({ name: name + '.md', mimeType: 'text/markdown', buffer: Buffer.from(markdown) })
        await first.waitForFunction((expected) => document.querySelector('.zh-title')?.value === expected, name)
      }
      const download = async (format) => {
        const pending = first.waitForEvent('download')
        await first.getByTitle('保存', { exact: true }).click()
        await first.locator(`button[data-format="${format}"]`).click()
        return readFile(await (await pending).path())
      }
      await importMarkdown('草稿回归', source)
      if (backend === 'indexeddb') {
        const tasks = first.getByRole('checkbox', { name: '任务完成状态' })
        assert.equal(await tasks.count(), 3)
        await tasks.first().check()
        const alert = first.locator('.zh-prose blockquote[data-github-alert="TIP"]')
        assert.equal(await alert.locator('.zh-alert-label').innerText(), '提示')
        assert.deepEqual(await alert.locator('p').allTextContents(), ['有 两段 内容。', '第二段。'])
        const plain = (await download('plain')).toString()
        const archive = unzipSync(await download('zip'))
        for (const markdown of [plain, Buffer.from(archive['草稿回归.md']).toString()]) {
          assert.ok(markdown.startsWith(yaml))
          assert.match(markdown, /^- \[x\] 未完成/m)
          assert.match(markdown, /^  - \[ \] 嵌套任务/m)
          assert.match(markdown, /^- 普通项目/m)
          assert.match(markdown, /^- \\\[x\\\] 字面括号/m)
          assert.match(markdown, /^> \[!TIP\]\n> 有 \*\*两段\*\* 内容。\n>\s*\n> 第二段。/m)
          assert.match(markdown, /\$x\^2\+1\$ 和 `\$x\$`/)
        }
        await importMarkdown('往返检查', plain)
        assert.equal(await tasks.count(), 3)
        await first.locator('.zh-prose blockquote[data-github-alert="TIP"]').waitFor()
        await importMarkdown('草稿回归', '编辑前正文。')
      }

      const second = await open()
      await second.waitForFunction(() => document.querySelector('.zh-title')?.value === '草稿回归')
      const append = async (page, marker) => {
        const body = page.locator('.ProseMirror')
        await body.press('Control+End')
        await page.keyboard.insertText(marker)
        const saved = () => page.evaluate(async ({ marker, backend }) => {
          const docs = backend === 'localstorage' ? JSON.parse(localStorage.getItem('md-editor-docs-v1')).docs
            : await new Promise((done, fail) => {
              const open = indexedDB.open('md-editor-docs')
              open.onerror = () => fail(open.error)
              open.onsuccess = () => {
                const db = open.result
                const all = db.transaction('docs').objectStore('docs').getAll()
                all.onsuccess = () => { db.close(); done(all.result) }
                all.onerror = () => { db.close(); fail(all.error) }
              }
            })
          return docs.some((doc) => doc.title === '草稿回归' && doc.md.includes(marker))
        }, { marker, backend })
        for (let attempt = 0; attempt < 40; attempt++) {
          if (await saved()) return
          await new Promise((done) => setTimeout(done, 150))
        }
        throw new Error(`草稿未保存：${marker}`)
      }
      await append(first, '第一标签页的修改。')
      await append(second, '第二标签页的修改。')
      await second.getByRole('status').getByText(/已在文档列表保留.*冲突副本/).waitFor()
      await append(second, '继续输入。')
      const reopened = await open()
      await reopened.waitForFunction(() => document.querySelector('.zh-prose')?.textContent.includes('继续输入。'))
      assert.match(await reopened.locator('.ProseMirror').innerText(), /第二标签页的修改。继续输入。/)
      await reopened.getByRole('button', { name: '文档', exact: true }).click()
      const copy = reopened.locator('.zh-docmenu__open').filter({ has: reopened.getByText('草稿回归（冲突副本）', { exact: true }) })
      assert.equal(await copy.count(), 1)
      await copy.click()
      assert.match(await reopened.locator('.ProseMirror').innerText(), /第一标签页的修改。/)
      console.log(`PASS: ${backend} 冲突提示、两份内容持久化、单标签页继续写入。`)
    } finally {
      await context.close()
    }
  }
  console.log('PASS: YAML、混合任务清单、GitHub 提示块、公式及 Markdown/ZIP 导出往返。')
} finally {
  await browser.close()
}
