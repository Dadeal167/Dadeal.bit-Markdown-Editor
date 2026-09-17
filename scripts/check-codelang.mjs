/**
 * 代码块的语言选择器（长在代码块右上角那行）
 *
 * 为什么要有这一套：用户要的是"能按编程语言选不同的上色风格"。这个能力由三件事拼起来 ——
 * 菜单里有哪些语言（src/editor/codeLanguages.ts）、选了以后写进文档的属性（language 属性）、
 * 以及导出时围栏上带不带语言标记。任何一环断了，用户看到的就是"选了没用"或者"导出丢了"。
 *
 * 验七件事：
 *   1. ```js 围栏 → 语言是 js、按钮显示 JavaScript、代码上真的有 hljs-* 上色
 *   2. 菜单：第一项是"自动识别"，其余按字母顺序、不重不漏
 *   3. 逐个点一遍所有语言 → 文档属性跟着变，按钮文字跟着变（不点空列表）
 *   4. 按语言上色：Python / SQL / JSON / C / CSS 各自的关键字真的被标出来了
 *   5. "Plain text（不高亮）"= 一个上色都没有；"自动识别"= 没有语言标记但照样上色
 *   6. 那行语言栏**不属于文档内容**：存的 md、导出 HTML、getHTML() 里都不许出现它
 *   7. 刷新后语言还在（说明它是存进文档的，不是内存里的临时状态）
 */
import { chromium } from 'playwright-core'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * **本套件的断言总数** —— 文档里的数量占位符读的就是这个常量（见 check:docs-counts）。
 * 改测试条数时改这里；文档不用动（占位符会跟着变）。
 */
export const TEST_COUNT = 31

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

/** 期望的清单（故意在这里抄一份：源码里少一个语言，这套检查就该红） */
const EXPECTED = [
  ['Arduino', 'arduino'],
  ['Bash', 'bash'],
  ['C', 'c'],
  ['C#', 'csharp'],
  ['C++', 'cpp'],
  ['CSS', 'css'],
  ['Diff', 'diff'],
  ['Go', 'go'],
  ['GraphQL', 'graphql'],
  ['INI / 配置', 'ini'],
  ['Java', 'java'],
  ['JavaScript', 'javascript'],
  ['JSON', 'json'],
  ['Kotlin', 'kotlin'],
  ['Less', 'less'],
  ['Lua', 'lua'],
  ['Makefile', 'makefile'],
  ['Markdown', 'markdown'],
  ['Objective-C', 'objectivec'],
  ['Perl', 'perl'],
  ['PHP', 'php'],
  ['Plain text（不高亮）', 'plaintext'],
  ['Python', 'python'],
  ['R', 'r'],
  ['Ruby', 'ruby'],
  ['Rust', 'rust'],
  ['SCSS', 'scss'],
  ['SQL', 'sql'],
  ['Swift', 'swift'],
  ['TypeScript', 'typescript'],
  ['VB.NET', 'vbnet'],
  ['XML / HTML', 'xml'],
  ['YAML', 'yaml'],
]

const browser = await chromium.launch({ channel: 'msedge', headless: true })
const page = await browser.newPage({ viewport: { width: 1300, height: 900 } })
const errs = []
page.on('pageerror', (e) => errs.push(String(e).slice(0, 160)))
await page.goto(app, { waitUntil: 'load', timeout: 60000 })
await page.waitForSelector('.ProseMirror', { timeout: 30000 })
await page.waitForTimeout(600)

/** 用 markdown 灌一段内容（和打开 .md 文件走同一条解析路） */
const setMd = async (md) => {
  await page.evaluate((t) => window.__EDITOR__.commands.setContent(t, { contentType: 'markdown' }), md)
  await page.waitForTimeout(220)
}

/** 当前状态：语言属性 / 按钮文字 / 上色 class / 存的 md / 内部 HTML */
const state = () =>
  page.evaluate(() => {
    const ed = window.__EDITOR__
    let lang = null
    let text = ''
    ed.state.doc.descendants((n) => {
      if (n.type.name === 'codeBlock' && lang === null) {
        lang = n.attrs.language ?? null
        text = n.textContent
      }
    })
    const root = document.querySelector('.zh-codeblock')
    const classes = new Set()
    root?.querySelectorAll('code [class]').forEach((el) => {
      String(el.className)
        .split(/\s+/)
        .forEach((c) => c.startsWith('hljs-') && classes.add(c))
    })
    return {
      lang,
      text,
      label: document.querySelector('.zh-codeblock__lang')?.textContent?.trim() ?? null,
      hljs: [...classes].sort(),
      barCount: document.querySelectorAll('.zh-codeblock__bar').length,
      md: window.__MD__() ?? '',
      html: ed.getHTML(),
    }
  })

/** 打开语言菜单，读出所有选项的文字 */
const menuItems = async () => {
  await page.click('.zh-codeblock__lang')
  await page.waitForSelector('.zh-codeblock__menu', { timeout: 5000 })
  const items = await page.$$eval('.zh-codeblock__menu .zh-codeblock__item', (els) => els.map((e) => e.textContent.trim()))
  return items
}
const closeMenu = async () => {
  await page.keyboard.press('Escape')
  await page.waitForTimeout(80)
}
/** 点菜单里的某一项（会自动把菜单打开） */
const pick = async (label) => {
  await page.click('.zh-codeblock__lang')
  await page.waitForSelector('.zh-codeblock__menu', { timeout: 5000 })
  await page.click(`.zh-codeblock__menu .zh-codeblock__item:text-is(${JSON.stringify(label)})`)
  await page.waitForTimeout(160)
}

/* ---------- 1. 围栏 → 语言 + 上色 ---------- */
await setMd('```js\nconst a = 1\n```\n')
{
  const s = await state()
  check('```js 围栏解析出 js 语言', s.lang === 'js', `language=${JSON.stringify(s.lang)}`)
  check('别名 js 认得出是 JavaScript', s.label === 'JavaScript', `按钮=${JSON.stringify(s.label)}`)
  check('代码上真的有上色（hljs-*）', s.hljs.length > 0, s.hljs.join(' ') || '一个都没有')
  check('语言栏只出现一次', s.barCount === 1, `bars=${s.barCount}`)
}

/* ---------- 1b. 别名 / 没内置的语言 ---------- */
{
  const aliases = [
    ['py', 'Python', 'def f():\n    return 1'],
    ['yml', 'YAML', 'name: dadealbit'],
    ['ts', 'TypeScript', 'const a: number = 1'],
    ['sh', 'Bash', 'echo $HOME'],
    ['c++', 'C++', 'int a = 1;'],
    ['html', 'XML / HTML', '<p class="a">x</p>'],
    ['md', 'Markdown', '# 标题'],
  ]
  const bad = []
  for (const [alias, label, code] of aliases) {
    await setMd('```' + alias + '\n' + code + '\n```\n')
    const s = await state()
    if (s.label !== label) bad.push(`${alias}→${JSON.stringify(s.label)}`)
    else if (s.hljs.length === 0) bad.push(`${alias} 没上色`)
  }
  check('常见别名（py/yml/ts/sh/c++/html/md）都认得出且照常上色', bad.length === 0, bad.slice(0, 3).join(' '))

  // 别名选中态：菜单里该亮在对应语言上，而不是"自动识别"
  await setMd('```py\nprint(1)\n```\n')
  await page.click('.zh-codeblock__lang')
  await page.waitForSelector('.zh-codeblock__menu', { timeout: 5000 })
  const active = await page.$$eval('.zh-codeblock__menu .zh-codeblock__item--active', (els) => els.map((e) => e.textContent.trim()))
  check('别名打开菜单时选中项也对', active.length === 1 && active[0] === 'Python', active.join(',') || '一个都没选中')
  await closeMenu()

  // 没内置的语法：语言标记必须原样留着（导出不能悄悄丢），按钮上说明"未内置"
  await setMd('```dockerfile\nFROM node:20\n```\n')
  const df = await state()
  check('没内置的语法：按钮上写明未内置', df.label === 'dockerfile · 未内置', `按钮=${JSON.stringify(df.label)}`)
  check('没内置的语法：围栏原样保留', df.md.includes('```dockerfile'), df.md.trim().split('\n')[0] ?? '')
  check('没内置的语法：退回自动识别上色（不报错）', errs.length === 0, errs.slice(0, 1).join(''))
}

/* ---------- 2. 菜单清单：顺序、首项、不重不漏 ---------- */
{
  const items = await menuItems()
  check('菜单第一项是"自动识别（默认）"', items[0] === '自动识别（默认）', `第一项=${JSON.stringify(items[0])}`)
  const langs = items.slice(1)
  const lower = langs.map((s) => s.toLowerCase())
  const sorted = [...lower].sort((a, b) => a.localeCompare(b))
  check('语言按字母顺序排列', JSON.stringify(lower) === JSON.stringify(sorted), langs.slice(0, 4).join(' / ') + ' …')
  check('语言一个不多一个不少', langs.length === EXPECTED.length, `${langs.length} 个（期望 ${EXPECTED.length}）`)
  const expectedNames = EXPECTED.map(([label]) => label)
  const missing = expectedNames.filter((n) => !langs.includes(n))
  const extra = langs.filter((n) => !expectedNames.includes(n))
  check('清单和源码一致', missing.length === 0 && extra.length === 0, `缺${missing.join(',') || '无'} 多${extra.join(',') || '无'}`)
  check('没有重复项', new Set(items).size === items.length, `${items.length} 项 / ${new Set(items).size} 个名字`)
  check('菜单里有"Plain text（不高亮）"这一项', langs.includes('Plain text（不高亮）'))
  await closeMenu()
}

/* ---------- 3. 逐个点一遍 ---------- */
{
  const bad = []
  for (const [label, value] of EXPECTED) {
    await pick(label)
    const s = await state()
    if (s.lang !== value) bad.push(`${label}→${JSON.stringify(s.lang)}`)
    else if (s.label !== label) bad.push(`${label} 按钮显示=${JSON.stringify(s.label)}`)
  }
  check(`${EXPECTED.length} 个语言逐个选一遍都生效`, bad.length === 0, bad.slice(0, 3).join(' '))
  // 顺带确认选到最后一个（YAML）时 md 围栏也跟着变成 yaml
  const s = await state()
  check('选完 YAML 后围栏是 ```yaml', /```yaml/.test(s.md), s.md.trim().split('\n')[0] ?? '')
}

/* ---------- 4. 按语言上色 ---------- */
{
  const cases = [
    ['python', 'def f(x):\n    return "s"', ['hljs-keyword', 'hljs-string']],
    ['sql', 'SELECT id FROM t WHERE a = 1', ['hljs-keyword']],
    ['json', '{"a": 1, "b": true}', ['hljs-attr']],
    ['c', 'int main(void) { return 0; }', ['hljs-type']],
    ['css', '.a { color: red; }', ['hljs-selector-class']],
  ]
  const bad = []
  for (const [lang, code, want] of cases) {
    await setMd('```' + lang + '\n' + code + '\n```\n')
    const s = await state()
    const miss = want.filter((w) => !s.hljs.includes(w))
    if (miss.length) bad.push(`${lang} 缺 ${miss.join('/')}（实际 ${s.hljs.join(' ') || '无'}）`)
  }
  check('5 种语言各自的高亮规则都生效', bad.length === 0, bad.slice(0, 2).join('；'))
}

/* ---------- 5. Plain text vs 自动识别 ---------- */
{
  await setMd('```plaintext\nconst a = 1\n```\n')
  const plain = await state()
  check('Plain text 一点上色都没有', plain.hljs.length === 0, plain.hljs.join(' ') || '干净')
  check('Plain text 的围栏保留语言', /```plaintext/.test(plain.md))

  await pick('自动识别（默认）')
  const auto = await state()
  check('自动识别 = 没有语言标记', auto.lang === null, `language=${JSON.stringify(auto.lang)}`)
  check('自动识别的围栏不带语言', /^```\s*$/m.test(auto.md) || /```[^\w`]*\n/.test(auto.md), auto.md.trim().split('\n')[0] ?? '')
  await setMd('```\nconst a = 1\n```\n')
  const auto2 = await state()
  check('没写语言时高亮器自己猜（照样有颜色）', auto2.hljs.length > 0, auto2.hljs.slice(0, 3).join(' ') || '没猜出来')
}

/* ---------- 6. 那行语言栏不属于文档内容 ---------- */
{
  await setMd('```python\nprint("hi")\n```\n')
  const s = await state()
  check('内部 HTML 不含语言栏', !s.html.includes('zh-codeblock'), s.html.slice(0, 60))
  check('内部 HTML 不含"自动识别"字样', !s.html.includes('自动识别'))
  check('存的 md 里没有 UI 文字', !/自动识别|不高亮|zh-codeblock/.test(s.md), s.md.trim().replace(/\n/g, '⏎').slice(0, 70))
  check('存的 md 是普通围栏', s.md.includes('```python') && s.md.includes('print("hi")'))
  check('代码文字原样保留', s.text === 'print("hi")', JSON.stringify(s.text))
}

/* ---------- 7. 刷新后语言还在 ---------- */
{
  await page.waitForTimeout(1200) // 等自动保存
  const before = (await state()).md
  await page.reload({ waitUntil: 'load', timeout: 60000 })
  await page.waitForSelector('.ProseMirror', { timeout: 30000 })
  await page.waitForTimeout(1500)
  let after = null
  for (let i = 0; i < 20 && after === null; i += 1) {
    const s = await state().catch(() => null)
    if (s && s.lang) after = s
    else await page.waitForTimeout(400)
  }
  check('刷新后语言还在（python）', after?.lang === 'python', `刷新后=${JSON.stringify(after?.lang ?? null)}`)
  check('刷新后内容一致', after !== null && after.md.trim() === before.trim(), '')
}

check('整个流程没有 JS 报错', errs.length === 0, errs.slice(0, 2).join(' | '))

await browser.close()

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} 项通过`)
/* 自检：实际断言数必须等于对外声明的 TEST_COUNT（文档数量占位符读它） */
if (results.length !== TEST_COUNT) {
  console.log(`\n❌ 断言总数与 TEST_COUNT 不符：实际 ${results.length}，声明 ${TEST_COUNT}`)
  console.log('   改测试条数时请一并更新文件顶部的 TEST_COUNT')
  process.exit(1)
}

process.exit(failed.length ? 1 : 0)
