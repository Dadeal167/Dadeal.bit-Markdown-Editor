/**
 * 变异测试：把"链接目标里的坏字符"守卫拆掉，确认 check-md-dest 真的会变红。
 *
 * 为什么必须做：套件在**没拆任何东西**的时候就是全绿（防线本来就在），
 * 所以"全绿"本身证明不了任何事 —— 只有证明"拆掉它会红"，那些断言才算数。
 * 这一套尤其需要：它守的是一个**字符串预处理**步骤，拆掉之后界面不会报错、
 * 也不会崩，只是"图片悄悄没出来" —— 正是用户碰到的那种静默失败。
 *
 * 与 `mutation-test-math-markdown.mjs` 的区别：那个脚本要求工作区干净（靠 git 比对拦人）；
 * 这个脚本改成**按内容快照 + 强制还原 + 还原后逐字节核对**，所以可以在功能还没提交时跑。
 *
 * 用法：node scripts/mutation-test-md-dest.mjs
 */
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const SUITE = 'scripts/check-md-dest.mjs'
const BUILD = resolve('node_modules', 'vite', 'bin', 'vite.js')
for (const p of [SUITE, BUILD]) {
  if (!existsSync(p)) {
    console.error(`❌ 缺少 ${p}`)
    process.exit(1)
  }
}

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`${ok ? '✅' : '❌'}  ${name}${detail ? '  — ' + detail : ''}`)
}

const run = (cmd, args) => {
  try {
    /* ⚠️ 不要加 `shell: true`：`process.execPath` 是 `C:\Program Files\nodejs\node.exe`，
       走 shell 会在空格处断开，报成 "'C:\Program' is not recognized..."，
       于是每个变异都"构建失败、无法判定"，看着像守卫有问题，其实是脚本自己没跑起来。 */
    return execFileSync(cmd, args, { encoding: 'utf8', maxBuffer: 1 << 26 })
  } catch (e) {
    return (e.stdout || '') + (e.stderr || '')
  }
}
const build = () => run(process.execPath, [BUILD, 'build', '--mode', 'pure'])
const runSuite = () => run(process.execPath, [SUITE])

/* ---------- 备份（按内容）+ 无论如何都要还原 ---------- */
const TARGETS = {
  editorActions: resolve('src', 'editor', 'editorActions.ts'),
  mdDestinations: resolve('src', 'editor', 'tiptap', 'mdDestinations.ts'),
}
const originals = {}
for (const [key, path] of Object.entries(TARGETS)) {
  originals[key] = readFileSync(path, 'utf8')
  copyFileSync(path, resolve('.probe', 'out', `_mut_mddest_${key}.backup`))
}
const restoreAll = () => {
  for (const [key, path] of Object.entries(TARGETS)) {
    try {
      writeFileSync(path, originals[key], 'utf8')
    } catch {
      /* 尽力而为 */
    }
  }
}
process.on('exit', restoreAll)
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(sig, () => {
    restoreAll()
    console.log(`\n⚠️ 收到 ${sig}，已把源文件恢复原状后再退出`)
    process.exit(130)
  })
}

/** 变异定义：一处替换 + 期望变红的断言关键字 */
const MUTATIONS = [
  {
    name: '把导入时的转义那一步去掉（等于功能没接上）',
    target: 'editorActions',
    from: 'editor.commands.setContent(escapeMarkdownDestinations(protectedMd))',
    to: 'editor.commands.setContent(protectedMd)',
    expect: /A4|A5|A6/,
    why: '这条是"接线"变异：转义函数还在、只是没人调用 —— 用户那篇会重新变成 0 张图',
  },
  {
    name: '把标题分隔符当成路径的一部分（`"…"` 里的空格也被编码）',
    target: 'mdDestinations',
    from: 'if (titleEnd >= 0) return { start, destEnd: i, linkEnd: titleEnd }',
    to: 'if (titleEnd >= 0 && false) return { start, destEnd: i, linkEnd: titleEnd }',
    expect: /B1|B2|B3/,
    why: '这条守的是"别把标题并进路径"—— 并进去之后图片路径就多了 `%20"…"`，图必然裂',
  },
  {
    name: '不认代码区（代码块里的 `![a](x y.png)` 也被改）',
    target: 'mdDestinations',
    from: "if (md[i] === ']' && md[i + 1] === '(' && !mask[i]) {",
    to: "if (md[i] === ']' && md[i + 1] === '(') {",
    expect: /C1|C2|C3/,
    why: '这条守的是"别动代码"—— 代码块里那段是**教语法**的示例，被改掉就是弄坏用户的内容',
  },
]

/* ---------- 0. 基线：没变异时必须全绿 ---------- */
console.log('先跑一遍基线（没变异）\n')
const base = runSuite()
check('基线：check-md-dest 全绿', /24\/24 通过/.test(base), (base.match(/\d+\/\d+ 通过/) ?? ['(没跑出结果)'])[0])

/* ---------- 逐个变异 ---------- */
for (const m of MUTATIONS) {
  console.log(`\n=== 变异：${m.name}\n    （${m.why}）`)
  const path = TARGETS[m.target]
  const text = readFileSync(path, 'utf8')
  if (!text.includes(m.from)) {
    check(`${m.name} → 能翻红`, false, `❗源码里找不到要替换的那段（${path}），变异没应用上`)
    continue
  }
  if (text.split(m.from).length - 1 !== 1) {
    check(`${m.name} → 能翻红`, false, '❗要替换的那段出现多次，拒绝盲目替换')
    continue
  }
  writeFileSync(path, text.replace(m.from, m.to), 'utf8')
  const buildOut = build()
  if (!/✓ built in/.test(buildOut)) {
    check(`${m.name} → 能翻红`, false, `❗构建失败，变异无法判定：${buildOut.slice(-160)}`)
    writeFileSync(path, originals[m.target], 'utf8')
    continue
  }
  const out = runSuite()
  const reds = out.split('\n').filter((l) => l.startsWith('❌'))
  const hit = reds.find((l) => m.expect.test(l)) ?? ''
  check(
    `${m.name} → 期望的断言翻红`,
    Boolean(hit),
    hit.trim() || `❗没翻红（守卫可能失效）。套件结果：${(out.match(/\d+\/\d+ 通过/) ?? ['?'])[0]}`,
  )
  /* 变异状态下套件必须整体失败（否则说明它红是"红的别的、这条其实没守住"） */
  check(`${m.name} → 套件整体判失败`, !/\n\d+\/\d+ 通过\n/.test(out) || /❌/.test(out), '已判失败')
  writeFileSync(path, originals[m.target], 'utf8')
}

/* ---------- 收尾：还原 + 重新构建 + 基线复跑 ---------- */
restoreAll()
const restoredOk = Object.entries(TARGETS).every(([k, p]) => readFileSync(p, 'utf8') === originals[k])
check('源文件已逐字节还原', restoredOk)
const rebuild = build()
check('还原后能重新构建', /✓ built in/.test(rebuild), rebuild.slice(-80).trim())
const after = runSuite()
check('还原后套件重新全绿', /24\/24 通过/.test(after), (after.match(/\d+\/\d+ 通过/) ?? ['(没跑出结果)'])[0])

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} 项通过`)
if (failed.length) console.log('说明：这里的 ❌ 表示**守卫本身失效了**（拆掉它套件却没红）。')
process.exit(failed.length ? 1 : 0)
