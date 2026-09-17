/**
 * 一把跑完全部检查：自己起 dev server、按顺序跑完所有的 check / audit、最后给一张表。
 *
 * 为什么要有它：这些脚本里有几个（check:docs / audit:docs / audit:buttons / audit:effect / audit:builds）
 * 依赖 http://127.0.0.1:5173 上的开发服务器。以前手工一条条跑，忘了开服务器就会看到一片"失败"，
 * 白紧张一场（实测踩过三次）。现在一条命令搞定：起服务器 → 跑 → 关掉 → 报结果。
 *
 * 用法：
 *   pnpm check:all             # 跑全部（不含真账号那条）
 *   pnpm check:all --live      # 连 audit:zhihu（真知乎账号，会写测试草稿）也跑
 *   pnpm check:all --only=probe,check:offline
 */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const argv = process.argv.slice(2)
const LIVE = argv.includes('--live')
const onlyArg = argv.find((a) => a.startsWith('--only='))
const ONLY = onlyArg ? onlyArg.slice('--only='.length).split(',').map((s) => s.trim()).filter(Boolean) : null

const pkg = JSON.parse(readFileSync('package.json', 'utf-8'))
const scripts = pkg.scripts ?? {}

/** 默认全跑；这几个单独说：
 *   audit:zhihu / test:assistant* 要真知乎账号（--live 才跑）
 *   check:all 是它自己 */
const NEEDS_ACCOUNT = ['audit:zhihu', 'test:assistant', 'test:assistant-image', 'test:assistant-imagebed']
const SKIP_ALWAYS = ['check:all']

const names = Object.keys(scripts).filter((n) => /^(check|audit|probe)/.test(n))
const targets = (ONLY ?? names).filter((n) => !SKIP_ALWAYS.includes(n) && (LIVE || !NEEDS_ACCOUNT.includes(n)))
const missing = targets.filter((n) => !scripts[n])
if (missing.length) {
  console.error(`package.json 里没有这些脚本：${missing.join('、')}`)
  process.exit(1)
}

/* 有些检查是**某个分支专有**的（比如 audit:effect / audit:builds 只在「自用」分支有脚本文件，
   它们验的是鼠标特效；分享版分支里那两个文件根本不存在）。这种要"明确跳过并说明"，
   不能当成失败 —— 否则分享版这边永远是 38/40，看久了就会忽略真正的红。
   注意：只有"脚本文件本身不存在"才跳过；文件在、跑挂了照样算失败。 */
const scriptFile = (name) => {
  const m = String(scripts[name]).match(/node\s+(\S+\.mjs)/)
  return m ? resolve(m[1]) : null
}
const skipped = []
const runnable = targets.filter((n) => {
  const f = scriptFile(n)
  if (f && !existsSync(f)) {
    skipped.push(n)
    return false
  }
  return true
})
if (skipped.length) {
  console.log(`跳过本分支没有脚本文件的项：${skipped.join('、')}（这些是另一个分支专有的检查）\n`)
}

/* ---------- 起 dev server（有几个脚本要用它） ---------- */
/* ---------- 先构建（check:offline 要比对 dist 和根目录那份 HTML） ----------
   切换分支后 dist 还是上一个分支的产物，不重建就会看到"根目录与 dist 不一致"的假失败（实测踩过）。
   默认先构建；想省时间加 --no-build。 */
if (!argv.includes('--no-build')) {
  const buildScript = scripts['build:both'] ? 'build:both' : 'build'
  console.log(`先构建（pnpm ${buildScript}）…`)
  const b = spawnSync(`pnpm ${buildScript}`, { shell: true, encoding: 'utf-8', env: { ...process.env, NO_COLOR: '1' } })
  if (b.status !== 0) {
    console.error('构建失败，后面没法比对了。最后几行：')
    console.error(
      `${b.stdout ?? ''}\n${b.stderr ?? ''}`
        .split('\n')
        .filter((l) => l.trim())
        .slice(-12)
        .join('\n'),
    )
    process.exit(1)
  }
  console.log('构建完成\n')
}

const vite = resolve('node_modules', 'vite', 'bin', 'vite.js')
if (!existsSync(vite)) {
  console.error('找不到 node_modules/vite/bin/vite.js —— 先 pnpm install')
  process.exit(1)
}
console.log('起 dev server（127.0.0.1:5173）…')
const dev = spawn(process.execPath, [vite, '--port', '5173', '--strictPort'], {
  stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, NO_COLOR: '1' },
})
let devLog = ''
dev.stdout.on('data', (d) => (devLog += String(d)))
dev.stderr.on('data', (d) => (devLog += String(d)))

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const devUp = async () => {
  for (let i = 0; i < 90; i += 1) {
    try {
      const r = await fetch('http://127.0.0.1:5173/', { signal: AbortSignal.timeout(2000) })
      if (r.ok) return true
    } catch {
      /* 还没起来 */
    }
    await sleep(700)
  }
  return false
}
const killDev = () => {
  try {
    spawnSync('taskkill', ['/PID', String(dev.pid), '/T', '/F'], { stdio: 'ignore' })
  } catch {
    dev.kill()
  }
}

if (!(await devUp())) {
  console.error('dev server 没起来，最后几行日志：\n' + devLog.split('\n').slice(-8).join('\n'))
  killDev()
  process.exit(1)
}
console.log('dev server 就绪，开始跑检查\n')

/* ---------- 一条条跑 ---------- */
const rows = []
for (const [i, name] of runnable.entries()) {
  const cmd = scripts[name]
  process.stdout.write(`[${String(i + 1).padStart(2)}/${runnable.length}] ${name} … `)
  const t0 = Date.now()
  const r = spawnSync(cmd, { shell: true, encoding: 'utf-8', env: { ...process.env, NO_COLOR: '1' } })
  const out = `${r.stdout ?? ''}\n${r.stderr ?? ''}`
  const tail =
    out
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
      .filter((s) => !/^>|^\$|^At line:|^\s*\+|CategoryInfo|FullyQualifiedErrorId|^\s*~/.test(s))
      .slice(-1)[0] ?? ''
  const ok = r.status === 0
  const secs = ((Date.now() - t0) / 1000).toFixed(1)
  console.log(`${ok ? '✅' : '❌'} ${secs}s  ${tail.slice(0, 70)}`)
  rows.push({ name, ok, tail, secs, out })
}

/* ---------- 汇总 ---------- */
const failed = rows.filter((r) => !r.ok)
console.log('\n==== 汇总 ====')
for (const r of rows) {
  console.log(`${r.ok ? '✅' : '❌'}  ${r.name.padEnd(24)} ${String(r.secs).padStart(6)}s  ${r.tail.slice(0, 60)}`)
}
console.log(`\n${rows.length - failed.length}/${rows.length} 套通过${LIVE ? '（含真账号）' : '（没跑真账号那套：加 --live）'}`)
if (failed.length) {
  console.log('\n失败的那几套，最后 20 行输出：')
  for (const f of failed) {
    console.log(`\n--- ${f.name} ---`)
    console.log(
      f.out
        .split('\n')
        .filter((l) => l.trim())
        .slice(-20)
        .join('\n'),
    )
  }
}
killDev()
process.exit(failed.length ? 1 : 0)
