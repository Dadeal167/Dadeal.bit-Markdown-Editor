/* 变异测试：临时把守卫去掉，确认「公式修复安全网」套件会变红。
   一次只变异一处，跑一遍套件，再恢复 —— 这样能知道每条守卫各自被哪条断言守着。
   用法：node .probe/mutation-test-repair-safety.mjs
*/
import { execFileSync } from 'node:child_process'
import { copyFileSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

const SRC = resolve('src/editor/math/latexRepair.ts')
const BACKUP = resolve('.probe/out/_latexRepair.backup.ts')

if (!existsSync(BACKUP)) {
  copyFileSync(SRC, BACKUP)
  console.log('已备份原文件 →', BACKUP)
}
const original = readFileSync(BACKUP, 'utf8')

const run = (cmd, args) => {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8', maxBuffer: 1 << 26, shell: true })
  } catch (e) {
    return (e.stdout || '') + (e.stderr || '')
  }
}


/**
 * 最可靠的变异办法：**整段函数替换**。
 *
 * 试过"切掉某一段"的做法，栽了三次（CRLF 匹配不上、注释留半截、构建失败被当成"没抓住"）。
 * 整段替换不留碎片：把 `export function repairLatex(...) { … }` 整体换成给定实现。
 */
function replaceFunction(text, fnName, newBody) {
  const sig = `export function ${fnName}(`
  const at = text.indexOf(sig)
  if (at < 0) return null
  const open = text.indexOf('{', at)
  if (open < 0) return null
  let depth = 0
  for (let i = open; i < text.length; i++) {
    if (text[i] === '{') depth += 1
    else if (text[i] === '}') {
      depth -= 1
      if (depth === 0) {
        const signature = text.slice(at, open)
        return text.slice(0, at) + signature + '{\n' + newBody + '\n}\n' + text.slice(i + 1)
      }
    }
  }
  return null
}

/* "出事前"的修复实现：兜底无条件采用 + 没有出口校验 + 没有 try/catch */
const UNGUARDED = `  if (!tex.trim()) return tex
  let out = tex
  if (!rendersOk(tex, display)) {
    let cur = tex
    for (const step of STEPS) {
      const next = step(cur)
      if (next !== cur) {
        cur = next
        if (rendersOk(cur, display)) { out = cur; break }
      }
    }
    if (out === tex) {
      for (const [re, to] of SPELLING) {
        const next = cur.replace(re, to)
        if (next !== cur && rendersOk(next, display)) { out = next; break }
      }
    }
    // 出事前的兜底：无条件采用
    if (out === tex) {
      let acc = cur
      for (const [re, to] of SPELLING) acc = acc.replace(re, to)
      if (acc !== cur) out = acc
    }
  }
  if (cache.size > CACHE_MAX) cache.clear()
  cache.set((display ? 'D' : 'I') + tex, out)
  return out`

/* 只去掉 try/catch（其它守卫都留着）：修复过程抛异常时不再返回原文 */
const NO_CATCH = `  if (!tex.trim()) return tex
  let out = tex
  if (!rendersOk(tex, display)) {
    let cur = tex
    for (const step of STEPS) {
      const next = step(cur)
      if (next !== cur) {
        cur = next
        if (rendersOk(cur, display)) { out = cur; break }
      }
    }
    if (out === tex) {
      for (const [re, to] of SPELLING) {
        const next = cur.replace(re, to)
        if (next !== cur && rendersOk(next, display)) { out = next; break }
      }
    }
    if (out === tex) {
      let acc = cur
      for (const [re, to] of SPELLING) acc = acc.replace(re, to)
      if (acc !== cur && rendersOk(acc, display)) out = acc
    }
  }
  // 没有 try/catch、也没有出口校验：直接返回
  if (cache.size > CACHE_MAX) cache.clear()
  cache.set((display ? 'D' : 'I') + tex, out)
  return out`

/* 所有守卫全撤：每一步都不校验、兜底无条件采用、没有 try/catch、没有出口校验。
   这就是"最坏情况"——如果连这版都能全绿，说明我的断言是摆设。 */
const NO_GUARDS_AT_ALL = `  if (!tex.trim()) return tex
  let out = tex
  if (!rendersOk(tex, display)) {
    let cur = tex
    for (const step of STEPS) cur = step(cur)
    for (const [re, to] of SPELLING) {
      const next = cur.replace(re, to)
      if (next !== cur) { cur = next; break }
    }
    let acc = cur
    for (const [re, to] of SPELLING) acc = acc.replace(re, to)
    out = acc
  }
  if (cache.size > CACHE_MAX) cache.clear()
  cache.set((display ? 'D' : 'I') + tex, out)
  return out`

const MUTATIONS = [
  {
    name: '只把兜底改成无条件采用（出口校验还在 → 预期**不红**，会被出口校验兜住）',
    expectCaught: false,
    apply: (t) => t.replace('if (acc !== cur && rendersOk(acc, display)) out = acc', 'if (acc !== cur) out = acc'),
  },
  {
    name: '整个 repairLatex 换回"出事前"的实现（兜底无条件 + 无出口校验 + 无 try/catch）→ 预期**红**',
    expectCaught: true,
    apply: (t) => replaceFunction(t, 'repairLatex', UNGUARDED),
  },
  {
    name: '去掉 try/catch 与出口校验（逻辑守卫保留）→ 预期**不红**（纵深防御，不是唯一防线）',
    expectCaught: false,
    apply: (t) => replaceFunction(t, 'repairLatex', NO_CATCH),
  },
  {
    name: '所有守卫全撤（逻辑校验 + try/catch + 出口校验一起）→ 预期**红**',
    expectCaught: true,
    apply: (t) => replaceFunction(t, 'repairLatex', NO_GUARDS_AT_ALL),
  },
]

const results = []
for (const m of MUTATIONS) {
  const mutated = m.apply(original)
  /* 变异自己就失败（切不出来 / 语法坏了）→ 必须喊出来，不能静默跳过。
     踩过的坑：cutBlock 切坏语法导致构建失败，而脚本没检查构建结果，
     于是拿**旧产物**跑套件、显示全绿 —— 我差点误判成"断言没抓住这个 bug"。 */
  if (!mutated || mutated === original) {
    console.log(`\n=== 变异：${m.name} ===\n  ❌ 变异没能应用（正则/切块没匹配上），这一条**无法判定**`)
    results.push({ name: m.name, applied: false, asExpected: false })
    continue
  }
  writeFileSync(SRC, mutated, 'utf8')

  const build = run('pnpm', ['build'])
  const buildOk = /已生成可直接双击的文件/.test(build) && !/error TS|Build failed/i.test(build)
  if (!buildOk) {
    console.log(`\n=== 变异：${m.name} ===\n  ❌ 变异后**构建失败**（语法坏了）—— 这一条无法判定，不是"没抓住"`)
    console.log('     ' + build.split('\n').filter((l) => /error|Error/.test(l)).slice(0, 2).join(' | '))
    results.push({ name: m.name, applied: true, buildOk: false, asExpected: false })
    continue
  }

  const out = run('node', ['scripts/check-latex-repair-safety.mjs'])
  const failed = /❌/.test(out)
  const failedNames = [...out.matchAll(/^❌\s+(.+?)\s+—/gm)].map((x) => x[1].slice(0, 40))
  const summary = (out.match(/公式修复安全网：(\d+)\/(\d+) 通过/) || [])[0] ?? '(没跑到汇总)'
  const asExpected = failed === m.expectCaught
  console.log(`\n=== 变异：${m.name} ===`)
  console.log(
    `  结果：${failed ? '套件变红了' : '套件仍全绿'}  预期：${m.expectCaught ? '应红' : '应不红'}  → ${asExpected ? '✅ 符合预期' : '⚠️ 与预期不符'}`,
  )
  console.log(`  ${summary}`)
  if (failedNames.length) console.log(`  红了哪些：${failedNames.join('、')}`)
  results.push({ name: m.name, applied: true, buildOk: true, caught: failed, expectCaught: m.expectCaught, asExpected, summary, failedNames })
}

/* 恢复 */
writeFileSync(SRC, original, 'utf8')
run('pnpm', ['build'])
const check = run('node', ['scripts/check-latex-repair-safety.mjs'])
console.log(`\n=== 已恢复原文件 ===`)
console.log(`  恢复后套件：${(check.match(/公式修复安全网：(\d+)\/(\d+) 通过/) || [])[0] ?? '(没跑到汇总)'}`)

const missed = results.filter((r) => !r.asExpected)
console.log(
  `\n${
    missed.length
      ? `⚠️ ${missed.length} 条变异与预期不符（或无法判定）：\n   ` +
        missed.map((m) => `${m.name}${m.applied === false ? '（变异没应用）' : m.buildOk === false ? '（构建失败）' : ''}`).join('\n   ')
      : '✅ 每一处变异的表现都符合预期（该红的红了、该被兜住的不红）'
  }`,
)
console.log('  （脚本会自己校验"变异是否真的应用 + 构建是否成功"，避免拿旧产物跑出假绿）')
process.exit(missed.length ? 1 : 0)
