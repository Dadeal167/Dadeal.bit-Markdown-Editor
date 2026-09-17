/**
 * 文档与界面一致性检查：README 里写的按钮/入口，必须和真实工具栏对得上
 *
 * 起因：工具栏改版（主题/知乎 从「更多」移到独立按钮、PDF 并进「导出」）后，
 * README 里好几处仍在写旧位置。这种"文档悄悄过期"最容易误导用户，所以加个自动检查。
 */
import { chromium } from 'playwright-core'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const APP = 'http://127.0.0.1:5173/'
const readme = readFileSync(resolve('README.md'), 'utf-8')

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`${ok ? '✅' : '❌'}  ${name}${detail ? '  — ' + detail : ''}`)
}

const browser = await chromium.launch({ channel: 'msedge', headless: true })
const page = await browser.newPage({ viewport: { width: 1360, height: 900 } })
await page.goto(APP, { waitUntil: 'load', timeout: 60000 })
await page.waitForSelector('.ProseMirror', { timeout: 30000 })
await page.waitForTimeout(1300)

/* ---------- 真实工具栏 ---------- */
const toolbar = await page.evaluate(() => {
  const btns = [...document.querySelectorAll('.zh-btn')]
  return {
    labels: btns.map((b) => (b.querySelector('.zh-btn__label')?.textContent || '').trim()),
    titles: btns.map((b) => b.getAttribute('title') || ''),
  }
})

/* ---------- 1. README 里声明的按钮清单要和界面对上 ---------- */
// 布局清单跨好几行，每行形如 `A · B · C` ｜ `D · E · F`，
// 所以要把所有反引号分组都抽出来，再按 · 拆开
const layoutGroups = readme
  .split('\n')
  .flatMap((line) => [...line.matchAll(/`([^`]+)`/g)].map((m) => m[1]))
  .filter((s) => s.includes('·'))
const declared = layoutGroups
  .flatMap((s) => s.split('·'))
  .map((s) => s.trim())
  .filter(Boolean)
check(
  'README 里有工具栏布局清单',
  declared.length === 0 || declared.length > 10,
  declared.length === 0 ? '（产品向 README 不含按钮清单，跳过逐项比对）' : `${declared.length} 个：${declared.join(' ')}`,
)
if (declared.length > 0) {
  check(
    'README 的按钮清单与真实工具栏完全一致',
    declared.length === toolbar.labels.length && declared.every((d, i) => d === toolbar.labels[i]),
    declared.length === toolbar.labels.length
      ? `顺序也对得上（${declared.length} 个）`
      : `README ${declared.length} 个 vs 界面 ${toolbar.labels.length} 个`,
  )
}

/* ---------- 2. README 里不该再出现"已搬走"的旧入口 ---------- */
const stalePatterns = [
  { re: /更多\s*→\s*存到知乎草稿箱/, why: '知乎入口已独立成工具栏按钮' },
  { re: /更多\s*→\s*主题/, why: '主题已独立成工具栏按钮' },
  { re: /「存为 PDF」/, why: 'PDF 已并进「保存」菜单' },
  { re: /更多\s*→\s*存一份自己看的/, why: '纯 .md 存档已并进「保存」菜单（用户要求）' },
  { re: /更多\s*→\s*Markdown 输入/, why: '底部状态栏就有开关，菜单里那份已删（用户要求）' },
]
for (const p of stalePatterns) {
  check(`README 不再写过时入口（${p.why}）`, !p.re.test(readme), p.re.source)
}

/* ---------- 3. README 提到的每个工具栏按钮都真实存在 ---------- */
// 注：工具栏上已经没有单独的「导出」按钮了 —— 它并进了「保存」（点保存选格式）
const mentioned = ['文档', '打开', '保存', '撤销', '重做', '清除格式', '标题', '加粗', '斜体', '字体',
  '列表', '引用', '分割线', '代码块', '图片', '视频', '链接', '公式', '表格', '大纲', '主题', '知乎', '更多']
const missing = mentioned.filter((m) => !toolbar.labels.includes(m))
check('README 提到的按钮都真实存在', missing.length === 0, missing.length ? `缺：${missing.join(' ')}` : '全部对得上')

/* ---------- 4. 按钮的 tooltip 不能和文字不一致（曾经因此崩过测试） ----------
   这两个是有意为之的：文档（提示"我的文档"）、字体（提示"正文字号/字体/文字颜色"） */
const INTENTIONAL_DIFFERENT_TITLE = ['文档', '字体']
const titleMismatch = toolbar.labels.filter((label, i) => {
  const t = toolbar.titles[i]
  if (!t || t === label) return false
  return !INTENTIONAL_DIFFERENT_TITLE.includes(label)
})
check(
  '按钮 tooltip 与按钮文字一致（否则按 title 定位的脚本会失效）',
  titleMismatch.length === 0,
  titleMismatch.length ? `不一致：${titleMismatch.join(' ')}` : `全部一致（${INTENTIONAL_DIFFERENT_TITLE.join('、')} 是刻意不同）`,
)

await browser.close()
for (const r of results) if (!r.ok) console.log(`\n待修：${r.name}`)
const failed = results.filter((r) => !r.ok).length
console.log(`\n${results.length - failed}/${results.length} 通过`)
process.exit(failed ? 1 : 0)
