/* 深色覆盖的静态兜底检查（做成套件）。
 *
 * 为什么需要"静态"这一层：实测那层（check-dark-theme）只能验**我知道要去点开**的面板，
 * 而漏掉的往往是"没想到要打开"的那种小控件 —— 上一轮就是靠静态扫描才找出
 * 公式补全下拉、字体面板的清除/安装、文档菜单的新建这几个白底。
 *
 * 两个坑（都踩过，所以写清楚）：
 *   1. `/* … *&#47;` 注释会被当成选择器的一部分 → 先把注释删掉再解析
 *   2. 判"是否被覆盖"不能用 `d.includes(s) || s.includes(d)`
 *      —— dark.css 里有 `html` / `body` 这种宽选择器，会把所有规则都判成"已覆盖"，
 *      结果一条都报不出来（我植入过一条假的白底规则验证，确实漏报）。
 *      必须归一化后**精确相等**才算覆盖。
 *
 * 判定策略：宁可多报。白名单里逐条写明"为什么这条不用覆盖"。
 * 用法：node scripts/check-dark-coverage.mjs
 */
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const OUT = resolve('.probe', 'out')
mkdirSync(OUT, { recursive: true })

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`${ok ? '✅' : '❌'}  ${name}${detail ? '  — ' + detail : ''}`)
}

const idxPath = resolve('src/index.css')
const darkPath = resolve('src/dark.css')
if (!existsSync(idxPath) || !existsSync(darkPath)) {
  console.error('找不到 src/index.css 或 src/dark.css')
  process.exit(1)
}

/** 去掉 CSS 注释（注释里的字会被误当选择器） */
const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '')

/**
 * 去掉 `@media print { … }` 整块。
 *
 * 为什么：打印样式里**故意**强制浅色（不然深色模式打印出来是黑底），
 * 那些规则当然不会、也不该被 [data-theme='dark'] 覆盖。
 * 不排除掉的话，扫描器会把它们报成"深色漏项"（实测报了一条 `.zh-prose` 的假失败）。
 */
const stripPrintMedia = (css) => {
  let out = ''
  let i = 0
  while (i < css.length) {
    const at = css.indexOf('@media', i)
    if (at < 0) {
      out += css.slice(i)
      break
    }
    const isPrint = /@media[^{]*print/.test(css.slice(at, css.indexOf('{', at)))
    if (!isPrint) {
      out += css.slice(i, at + 6)
      i = at + 6
      continue
    }
    /* 找到匹配的右括号 */
    let depth = 0
    let j = css.indexOf('{', at)
    for (; j < css.length; j++) {
      if (css[j] === '{') depth += 1
      else if (css[j] === '}') {
        depth -= 1
        if (depth === 0) break
      }
    }
    out += css.slice(i, at)
    i = j + 1
  }
  return out
}

const css = stripPrintMedia(stripComments(readFileSync(idxPath, 'utf8')))
const dark = stripComments(readFileSync(darkPath, 'utf8'))

/** "写死的浅色"：这些在深色主题下必须被覆盖，否则就是一块白 */
const LIGHT_RE = /#(fff|ffffff|fafafa|f5f5f5|f0f0f0|f7f7f7|f8f9fa|fefefe|fbfbfb)\b|(^|[^a-z])white\b|rgb\(255,\s*255,\s*255\)/i

const norm = (s) =>
  s
    .replace(/\[data-theme='dark'\]/g, '')
    .replace(/:[a-z-]+(\([^)]*\))?/g, '')
    .replace(/\s*([>+~,])\s*/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()

/* 收集 index.css 里"含浅色背景"的规则 */
const lightRules = []
for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
  const sel = m[1].trim()
  const body = m[2]
  if (!/background/i.test(body)) continue
  if (!LIGHT_RE.test(body)) continue
  lightRules.push({ sel, body: body.replace(/\s+/g, ' ').trim() })
}

/* dark.css 里被覆盖的选择器（精确归一化） */
const darkSels = new Set()
for (const m of dark.matchAll(/\[data-theme='dark'\][^{]*\{/g)) {
  const s = norm(m[0].replace(/\{$/, ''))
  for (const one of s.split(',')) darkSels.add(one.trim())
}

/**
 * 白名单：这些"写死浅色"**故意**不用深色覆盖，逐条给理由。
 * 加进来的每一条都要能说清楚，否则就是漏了。
 */
const ALLOWED = new Map([
  ['.zh-pill--primary', '蓝底上的白字（前景色），深色下同样是蓝底白字'],
  ['.zh-btn-solid', '同上：实心主按钮的白色文字'],
  ['.zh-feedback__num', '同上：蓝色圆点里的白色序号'],
  ['.zh-sckey--recording', '同上：录音态按键的白色文字'],
  ['.zh-tablemenu__btn', '透明底、文字用主题色，浅色只是 `background: none` 的写法'],
  ['.zh-outline__item', '同上：`background: none`'],
  ['body', '浅色是默认值；深色由 [data-theme=dark] 的 token 覆盖 --zh-bg 决定'],
  ['.zh-codeblock__lang', '它本来的背景就是 `var(--zh-hover)`（跟着主题变），浅色判定是被"hover"这个词误伤的'],
])

/**
 * 打印样式：@media print 里刻意强制浅色（不然打印出来是黑底），
 * 那些规则出现在 [data-theme='dark'] 后面，属于"故意反过来"。
 */
const PRINT_RE = /@media\s+print/

const uncovered = []
for (const r of lightRules) {
  const sels = norm(r.sel).split(',').map((x) => x.trim()).filter(Boolean)
  const missing = sels.filter((s) => !darkSels.has(s) && !ALLOWED.has(s))
  if (missing.length) uncovered.push({ ...r, missing })
}

check(
  'index.css 里的"写死浅色"都在深色主题里被覆盖（或有理由地免覆盖）',
  uncovered.length === 0,
  uncovered.length
    ? `${uncovered.length} 条没覆盖：${uncovered.map((u) => u.missing.join('/')).slice(0, 4).join('、')}`
    : `${lightRules.length} 条浅色规则，全部有交代（dark 覆盖 ${darkSels.size} 个选择器 + 白名单 ${ALLOWED.size} 条）`,
)

if (uncovered.length) {
  console.log('\n没覆盖的规则：')
  for (const u of uncovered) {
    console.log(`  · ${u.sel}`)
    console.log(`      缺：${u.missing.join(' | ')}`)
    console.log(`      ${u.body.slice(0, 110)}`)
  }
  writeFileSync(resolve(OUT, 'dark-coverage-uncovered.json'), JSON.stringify(uncovered, null, 2), 'utf-8')
}

/* 打印样式必须存在（深色下打印不能是黑底） */
check('有 @media print 强制浅色的规则（深色下打印不会黑底）', PRINT_RE.test(readFileSync(idxPath, 'utf8')))

const failed = results.filter((r) => !r.ok)
console.log(`\n${failed.length ? '❌' : '✅'}  深色覆盖（静态）：${results.length - failed.length}/${results.length} 通过`)
if (failed.length) process.exit(1)
