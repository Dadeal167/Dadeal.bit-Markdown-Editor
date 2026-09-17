/**
 * 文档数量占位符 与 测试套件声明数量 的一致性检查。
 *
 * 为什么要有它：实测过 7 处「文档写的数量」与实测不符，其中 **6 处是同一类数字漂移**
 * （改了测试没改文档）。手工改掉那 6 处没用 —— 下次改测试还会漂。所以把两边锁在一起：
 *
 *   1. 每个"文档里写了数量"的套件**导出** `TEST_COUNT`（唯一数据源）
 *   2. 套件收尾**自检**：实际断言数 !== TEST_COUNT 就失败
 *   3. 文档里**不写数字**，写占位符 `<!-- TEST_COUNT:check:paste -->`
 *   4. 本脚本只做一件事：扫占位符 → 去对应脚本读导出的常量 → 对不上就红
 *
 * 这样改测试数量时只需要改**一个地方**（脚本顶部的常量），文档自动跟上。
 *
 * 用法：node scripts/check-docs-counts.mjs
 *       node scripts/check-docs-counts.mjs --fix   # 顺手把占位符渲染成带数字的展示文本
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const FIX = process.argv.includes('--fix')

/** 会出现在文档里、并且"数量"值得被锁住的目录 */
const DOC_FILES = ['README.md', 'NEXT.md', 'docs/开发文档.md']
/* 注：交付包里的「使用说明.txt」不在仓库里（由 make-packages.mjs 打包时生成），
   所以不在这里检查。如果哪天它进了仓库、又写了数量，加进来即可。 */

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`${ok ? '✅' : '❌'}  ${name}${detail ? '  — ' + detail : ''}`)
}

/* ---------- 1. 收集 package.json 里的脚本映射 ---------- */
const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
const SCRIPTS = pkg.scripts ?? {}

/** 脚本名 → 脚本文件路径（只认 node scripts/xxx.mjs 这种） */
function scriptFile(name) {
  const cmd = SCRIPTS[name]
  if (!cmd) return null
  const m = /node\s+(scripts\/[\w.-]+\.mjs)/.exec(cmd)
  return m ? m[1] : null
}

/**
 * 读一个套件导出的 TEST_COUNT。
 *
 * ⚠️ 必须匹配 `export const TEST_COUNT`（带 export）—— 只找 `TEST_COUNT` 是不够的：
 * 实测把 `export` 去掉之后，旧的正则仍然能在文件里找到那串字，于是"验证器自己失效但显示通过"。
 * 这是这套机制最危险的一种坏法（守卫自己悄悄失效），所以这里连注释里提到的名字都要排除。
 */
function readTestCount(file) {
  if (!file || !existsSync(file)) return { count: null, reason: '脚本文件不存在' }
  const src = readFileSync(file, 'utf8')
  /* 先剥掉注释，免得把注释里提到的 TEST_COUNT 当成声明 */
  const noComments = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  const m = /^\s*export\s+const\s+TEST_COUNT\s*=\s*(\d+)\s*;?\s*$/m.exec(noComments)
  if (!m) return { count: null, reason: '没有 `export const TEST_COUNT = <数字>`' }
  return { count: Number(m[1]), reason: '' }
}

/* ---------- 2. 扫文档里的占位符 ---------- */
const PLACEHOLDER = /<!--\s*TEST_COUNT:([a-z0-9:_-]+)\s*-->/g

const docs = DOC_FILES.filter((f) => existsSync(f))
check('找到要检查的文档', docs.length > 0, docs.join(' / '))

let placeholderTotal = 0
const unresolved = []
const mismatched = []
const fixed = []

/**
 * 把占位符渲染成「N 项<!-- TEST_COUNT:xxx -->」。
 *
 * 这段被重写过两次，因为它是本脚本唯一的真雷区 —— 记下教训：
 *   第一版：从**注释**开始匹配，替换时只把注释换掉 → 注释右边多插了一个数字、
 *          左边原有数字还留着 → 每跑一次多叠一个，实测叠出
 *          `67 项67 项67 项75 项75<!-- … -->`，把三份文档都写坏了。
 *   第二版：往回吃数字时把**单位也一起吃了** → `38 项` 变成 `38<!-- … -->`，
 *          而且遇到 `19 项把交付…` 这种"数字后紧跟别的字"会吃错位置、留下重复数字。
 *   现在（第三版）：**先判断，不一致才动手**；替换范围用正则从 `N[ 项]` 一直吃到注释尾巴，
 *          而且只在"确实不一致"时才改 —— 一致的内容一个字节都不碰。
 *          `--fix` 必须幂等：连跑两次结果完全相同。
 */
const renderFix = (text, name, count) => {
  /* 匹配「数字[单位][空白]<!-- TEST_COUNT:name -->」，整段作为一个替换单元 */
  const re = new RegExp(`(\\d+)(\\s*(?:项|条|个))?\\s*(<!--\\s*TEST_COUNT:${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*-->)`)
  const m = re.exec(text)
  if (!m) return { text, changed: false, found: false }
  const unit = m[2] ?? ' 项' /* 没写单位的补上"项"，读起来顺 */
  const rendered = `${count}${unit}${m[3]}`
  if (m[0] === rendered) return { text, changed: false, found: true } /* 已经对了，不碰 */
  return { text: text.replace(m[0], rendered), changed: true, found: true }
}

for (const doc of docs) {
  let text = readFileSync(doc, 'utf8')
  for (const m of text.matchAll(PLACEHOLDER)) {
    placeholderTotal += 1
    const name = m[1]
    const file = scriptFile(name)
    if (!file) {
      unresolved.push({ doc, name, why: `package.json 里没有脚本 ${name}` })
      continue
    }
    const { count, reason } = readTestCount(file)
    if (count === null) {
      unresolved.push({ doc, name, why: `${file}：${reason}` })
      continue
    }
    mismatched.push({ doc, name, file, count, raw: m[0] })
    if (FIX) {
      const r = renderFix(text, name, count)
      if (r.changed) {
        text = r.text
        writeFileSync(doc, text, 'utf8')
        fixed.push({ doc, name, count })
      }
    }
  }
}

check('文档里用到了数量占位符', placeholderTotal > 0, `${placeholderTotal} 处`)
check(
  '每个占位符都指向一个真实存在、且导出了 TEST_COUNT 的脚本',
  unresolved.length === 0,
  unresolved.length ? unresolved.map((u) => `${u.doc}:${u.name}（${u.why}）`).join('；') : '',
)

/* ---------- 3. 反向检查：有没有脚本导出了常量却没被文档用 ---------- */
const exportedNotUsed = []
for (const [name] of Object.entries(SCRIPTS)) {
  const file = scriptFile(name)
  if (!file || !existsSync(file)) continue
  const { count } = readTestCount(file)
  if (count === null) continue
  const used = docs.some((d) => readFileSync(d, 'utf8').includes(`TEST_COUNT:${name}`))
  if (!used) exportedNotUsed.push({ name, count })
}
check(
  '导出了 TEST_COUNT 的脚本都已在文档里使用占位符',
  exportedNotUsed.length === 0,
  exportedNotUsed.length ? exportedNotUsed.map((e) => `${e.name}(${e.count})`).join('、') : '',
)

/* ---------- 4. 已渲染的数字是否与常量一致（防止渲染完就没人管了） ---------- */
const staleRendered = []
for (const doc of docs) {
  const text = readFileSync(doc, 'utf8')
  for (const m of text.matchAll(/(\d+)\s*(?:项|条|个)?\s*<!--\s*TEST_COUNT:([a-z0-9:_-]+)\s*-->/g)) {
    const shown = Number(m[1])
    const file = scriptFile(m[2])
    const { count } = readTestCount(file)
    if (count !== null && shown !== count) staleRendered.push({ doc, name: m[2], shown, count })
  }
}
check(
  '已渲染在文档里的数字与常量一致',
  staleRendered.length === 0,
  staleRendered.length ? staleRendered.map((s) => `${s.doc}:${s.name} 文档${s.shown}/实际${s.count}`).join('；') : '',
)

/* ---------- 汇总 ---------- */
const failed = results.filter((r) => !r.ok)
console.log('')
if (FIX && fixed.length) console.log(`已更新 ${fixed.length} 处占位符渲染。`)
console.log(`${failed.length === 0 ? '✅' : '❌'}  文档数量一致性：${results.length - failed.length}/${results.length} 通过`)
if (failed.length) {
  console.log('\n说明：文档里的数量不手写，改用占位符 `<!-- TEST_COUNT:脚本名 -->`；')
  console.log('      数字由脚本导出的 TEST_COUNT 决定，运行 `node scripts/check-docs-counts.mjs --fix` 渲染。')
}
process.exit(failed.length ? 1 : 0)
