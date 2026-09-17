/**
 * 验收「知乎助手包」（Release 里那个 zip）：**解压出来当用户那样真跑一遍**。
 *
 * 为什么要有它：这个包是要发给陌生人的，而它里面装着助手 + 便携 Node + 启动器 ——
 * 任何一环装配错了（少依赖、路径写死、把自用版素材带进去），发出去就是坏的。
 * 所以这里做三件事：
 *   1. 内容检查：该有的文件都在、**不该有的（特效/游戏素材/自用版）一个都没有**、bat 仍是 ASCII+CRLF
 *   2. 解压后交给 check-launcher.mjs 跑那 31 项（它会真的用包里的 node.exe 起助手、验令牌）
 *   3. 汇总成一张表
 *
 * 用法：node scripts/check-assistant-bundle.mjs [zip 路径]
 * 前提：先 node scripts/make-assistant-bundle.mjs
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const ZIP = resolve(process.argv[2] ?? resolve(ROOT, '.probe', 'release', 'Dadealbit-Zhihu-Assistant-v1.0.0.zip'))
const EXTRACT = resolve(ROOT, '.probe', 'bundle-extract')

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`${ok ? '✅' : '❌'}  ${name}${detail ? '  — ' + detail : ''}`)
}

if (!existsSync(ZIP)) {
  console.log(
    `⏭️   跳过「知乎助手包」验收：还没打出包（${ZIP}）。\n` +
      '   这是公开仓库里的正常情况（包里含 87MB 便携 Node，不入库）；要验收先跑：\n' +
      '     pnpm make:bundle && pnpm check:assistant-bundle',
  )
  process.exit(0)
}
console.log(`验收对象：${ZIP}（${(statSync(ZIP).size / 1048576).toFixed(1)} MB）\n`)

/* ---------- 1. 解压 ---------- */
rmSync(EXTRACT, { recursive: true, force: true })
mkdirSync(EXTRACT, { recursive: true })
const unzip = spawnSync(
  'powershell',
  ['-NoProfile', '-Command', `Expand-Archive -Path '${ZIP}' -DestinationPath '${EXTRACT}' -Force`],
  { encoding: 'utf-8' },
)
if (!existsSync(resolve(EXTRACT, '开始使用.bat'))) {
  console.error('解压失败：', unzip.stdout ?? '', unzip.stderr ?? '')
  process.exit(1)
}

/* ---------- 2. 内容检查 ---------- */
const must = [
  'Dadealbit Markdown 编辑器.html',
  '使用说明.txt',
  '开始使用.bat',
  '停止助手.bat',
  '启动知乎助手.bat',
  '安装助手自启 autostart-on.bat',
  '取消助手自启 autostart-off.bat',
  'runtime/node.exe',
  'assistant/zhihu-assistant.mjs',
  'assistant/package.json',
  'assistant/node_modules/playwright-core/package.json',
]
const missing = must.filter((f) => !existsSync(resolve(EXTRACT, f.replace(/\//g, '\\'))))
check('该有的文件都在（编辑器/说明/4 个 bat/便携 Node/助手 + 依赖）', missing.length === 0, missing.join('、') || `${must.length} 项`)

/* 包里绝不能出现自用版的东西：特效、那枚从游戏提取的指针素材、特效版 HTML */
const allFiles = []
const walk = (dir) => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = resolve(dir, e.name)
    if (e.isDirectory()) walk(full)
    else allFiles.push(full)
  }
}
walk(EXTRACT)
check(
  '没有把自用版的东西打进包（特效版 HTML / 指针素材）',
  !allFiles.some((f) => /特效版|cursor\.png|EffectPanel|mouseSpark/i.test(f)),
  `${allFiles.length} 个文件扫过`,
)

const html = readFileSync(resolve(EXTRACT, 'Dadealbit Markdown 编辑器.html'), 'utf-8')
const leaked = ['sparkCanvas', 'fx-cursor', 'zh-fx__', 'md-editor-mouse-effect'].filter((m) => html.includes(m))
check('包里的编辑器是分享版（无特效代码）', leaked.length === 0, leaked.join('、') || `${(html.length / 1048576).toFixed(2)} MB`)

/* bat 的纪律：纯 ASCII + CRLF（中文会因编码问题打不开，LF 在 cmd 下也可能出问题） */
const bats = readdirSync(EXTRACT).filter((f) => f.endsWith('.bat'))
const badBats = bats.filter((f) => {
  const buf = readFileSync(resolve(EXTRACT, f))
  const ascii = buf.every((b) => b < 0x80)
  const crlf = buf.includes(Buffer.from('\r\n'))
  return !ascii || !crlf
})
check('bat 仍是纯 ASCII + CRLF', badBats.length === 0, badBats.join('、') || `${bats.length} 个 bat`)

/* 说明文件是 UTF-8 with BOM（记事本双击不乱码） */
{
  const buf = readFileSync(resolve(EXTRACT, '使用说明.txt'))
  check('使用说明.txt 是 UTF-8 with BOM', buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf)
  const text = buf.toString('utf8')
  check(
    '说明里讲清了"怎么开始 / 怎么自启 / 出问题怎么办 / 不想用助手怎么办"',
    ['怎么用', '不想每次都双击', '出问题怎么办', '不想用助手'].every((k) => text.includes(k)),
  )
  check('说明里没有出现个人绝对路径', !/C:\\Users\\\w+/i.test(text))
}

/* ---------- 3. 交给启动器检查：解压后真起一遍 ---------- */
console.log('\n—— 下面这一节是"按用户的方式真跑一遍"（check-launcher.mjs）——\n')
const launcher = spawnSync(process.execPath, [resolve(ROOT, 'scripts', 'check-launcher.mjs'), EXTRACT], {
  encoding: 'utf-8',
  env: { ...process.env, NO_COLOR: '1' },
})
const out = `${launcher.stdout ?? ''}\n${launcher.stderr ?? ''}`
const last = out.split('\n').map((s) => s.trim()).filter(Boolean).slice(-1)[0] ?? ''
console.log(out.split('\n').slice(-16).join('\n'))
check('解压后能真的启动助手并通过鉴权（31 项启动器检查）', launcher.status === 0, last.slice(0, 80))

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} 项通过`)
process.exit(failed.length ? 1 : 0)
