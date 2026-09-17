/**
 * 「文件夹被挪走」的回归检查。
 *
 * 背景：开机自启项是写在 Windows「启动」文件夹里的一个 .vbs，而那个文件里**必须是绝对路径**
 * （它从别的地方被调用，相对路径没意义）—— 记的就是"你装自启时那个位置"。
 * 用户一旦把整个文件夹挪走或改名，重启后助手就起不来，编辑器面板会一直说「没检测到助手」。
 * 现在「开始使用.bat」启动时会检测这个不一致并**自愈**；这个脚本把这条路径钉住：
 *   1. 解压到 A → 装自启（VBS 里应是 A）
 *   2. 把目录挪到 B，删掉 A
 *   3. 在 B 跑「开始使用.bat」→ 必须能起来，且 VBS 自动改成 B
 *   4. 收尾：卸载自启，清理临时目录
 *
 * 用法：node scripts/check-moved-folder.mjs（前提：pnpm make:bundle）
 */
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT_DIR = resolve(fileURLToPath(new URL('..', import.meta.url)))
const ZIP = resolve(ROOT_DIR, '.probe', 'release', 'Dadealbit-Zhihu-Assistant-v1.0.0.zip')
if (!existsSync(ZIP)) {
  console.log('⏭️  跳过「文件夹被挪走」检查：还没打出助手包（先跑 pnpm make:bundle）')
  process.exit(0)
}

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`${ok ? '✅' : '❌'}  ${name}${detail ? '  — ' + detail : ''}`)
}

const ROOT = resolve(process.env.TEMP ?? '.', 'dadealbit-move-test')
const A = resolve(ROOT, '旧位置 甲')
const B = resolve(ROOT, '新位置 乙')
const STARTUP = resolve(
  process.env.APPDATA,
  'Microsoft',
  'Windows',
  'Start Menu',
  'Programs',
  'Startup',
  'dadealbit-assistant.vbs',
)
const PORT = 5199

const run = (dir, bat) =>
  spawnSync('cmd.exe', ['/d', '/c', resolve(dir, bat)], {
    encoding: 'utf-8',
    env: { ...process.env, DADEALBIT_PORT: String(PORT), DADEALBIT_NO_OPEN: '1' },
    timeout: 180000,
  })
const vbsDir = () => {
  if (!existsSync(STARTUP)) return null
  return /sh\.CurrentDirectory = "([^"]+)"/.exec(readFileSync(STARTUP, 'utf-16le'))?.[1] ?? null
}

rmSync(ROOT, { recursive: true, force: true })
mkdirSync(A, { recursive: true })
spawnSync('powershell', ['-NoProfile', '-Command', `Expand-Archive -Path '${ZIP}' -DestinationPath '${A}' -Force`], {
  encoding: 'utf-8',
})

run(A, '安装助手自启 autostart-on.bat')
check('装自启后，VBS 里记的是当前文件夹', vbsDir() === A, String(vbsDir()))

run(A, '停止助手.bat')
cpSync(A, B, { recursive: true })
rmSync(A, { recursive: true, force: true })
check('挪走之后 VBS 还指着旧位置（这就是用户会踩的坑）', vbsDir() === A, String(vbsDir()))
void statSync

const r = run(B, '开始使用.bat')
const after = vbsDir()
check('在新位置跑「开始使用.bat」能起来', r.status === 0, `退出码 ${r.status}`)
check('并且自动把自启项改到了新位置', after === B, String(after))

const token = readFileSync(resolve(process.env.USERPROFILE, '.dadealbit', 'token.txt'), 'utf-8').trim()
const st = await fetch(`http://127.0.0.1:${PORT}/status`, { headers: { 'x-dadealbit-token': token } })
  .then((x) => x.status)
  .catch(() => 0)
check('助手真的在跑（/status 200）', st === 200, `HTTP ${st}`)

run(B, '停止助手.bat')
run(B, '取消助手自启 autostart-off.bat')
check('收尾：自启项已卸载', !existsSync(STARTUP))
rmSync(ROOT, { recursive: true, force: true })

const failed = results.filter((r2) => !r2.ok)
console.log(`\n${results.length - failed.length}/${results.length} 项通过`)
process.exit(failed.length ? 1 : 0)
