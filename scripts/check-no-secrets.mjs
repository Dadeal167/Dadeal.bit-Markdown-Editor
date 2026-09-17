/**
 * 密钥体检：仓库代码 / 构建产物 / 交付文件夹里，有没有不该出现的令牌、API key、密码。
 *
 * 为什么要有这个：这个项目天生要碰两类凭据 ——
 *   · 知乎助手令牌（每次启动随机生成，落在 ~/.dadealbit/token.txt）
 *   · 图床用的 GitHub 令牌（用户自己在浏览器里填，只存在 localStorage）
 * 它们**都不该出现在代码、产物、交付文件夹、git 历史里**。这个脚本把这些地方全扫一遍，
 * 顺带当"发布前体检"用（进 check:all）。
 *
 * 用法：node scripts/check-no-secrets.mjs [--verbose]
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { resolve } from 'node:path'

const VERBOSE = process.argv.includes('--verbose')
const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`${ok ? '✅' : '❌'}  ${name}${detail ? '  — ' + detail : ''}`)
}

/** 一眼就知道是凭据的写法。
 *  两个坑（都实测踩过，都会误报）：
 *   · 内联的字体/图片是超长 base64，里面偶尔会凑出 "AKIA…" 这种字样 —— 扫描前先把 base64 串抹掉
 *   · 测试里会写假令牌（launcher-token-abc123、ghp_fake_token_for_test），用 ALLOW 放行 */
const SECRET_PATTERNS = [
  ['GitHub 经典令牌', /gh[pousr]_[A-Za-z0-9]{20,}/],
  ['GitHub 细粒度令牌', /github_pat_[A-Za-z0-9_]{30,}/],
  ['AWS Access Key', /(?<![A-Za-z0-9+/])AKIA[0-9A-Z]{16}(?![A-Za-z0-9+/=])/],
  ['OpenAI 风格 key', /(?<![A-Za-z0-9])\bsk-[A-Za-z0-9]{20,}/],
  ['硬编码 Bearer', /Bearer\s+[A-Za-z0-9_\-.]{24,}/],
  ['写死的 token 赋值', /\b(?:token|secret|password|passwd|api[_-]?key)\s*[:=]\s*['"][A-Za-z0-9_\-]{20,}['"]/i],
  ['知乎私有图片签名', /pic-private\.zhihu\.com/],
]
/** 允许出现的例外：测试里故意用的假令牌、说明文字 */
const ALLOW = [/ghp_fake_token_for_test/, /fake-1\.png/, /DEFAULT_ADDR/, /randomBytes/, /fake|test|abc123|example|dummy|placeholder|xxxx/i]

/** 扫描前把超长 base64（内联字体、图片）抹掉，免得凑出假命中 */
const stripBlobs = (text) => text.replace(/[A-Za-z0-9+/]{300,}={0,2}/g, '<base64>')

const scan = (label, text) => {
  const clean = stripBlobs(text)
  const hits = []
  for (const [name, re] of SECRET_PATTERNS) {
    const m = clean.match(re)
    if (m && !ALLOW.some((a) => a.test(m[0]))) hits.push(`${name}: ${m[0].slice(0, 24)}…`)
  }
  return hits
}

/* ---------- 1. 仓库里被跟踪的文件（当前分支） ---------- */
const tracked = execFileSync('git', ['ls-files'], { encoding: 'utf-8' }).split('\n').filter(Boolean)
const fileHits = []
for (const f of tracked) {
  let st
  try {
    st = statSync(f)
  } catch {
    continue
  }
  if (st.size > 8 * 1024 * 1024) continue
  if (/\.(png|jpg|jpeg|gif|webp|ico|woff2?|ttf|zip)$/i.test(f)) continue
  let text = ''
  try {
    text = readFileSync(f, 'utf-8')
  } catch {
    continue
  }
  const hits = scan(f, text)
  if (hits.length) fileHits.push(`${f} → ${hits.join('；')}`)
}
check(
  '仓库被跟踪的文件里没有令牌 / API key',
  fileHits.length === 0,
  fileHits.length ? fileHits.slice(0, 5).join(' | ') : `${tracked.length} 个文件扫过`,
)

/* ---------- 2. 两个分支的全部 git 历史（删过的也算泄露） ---------- */
const refs = execFileSync('git', ['for-each-ref', '--format=%(refname)', 'refs/heads', 'refs/tags'], { encoding: 'utf-8' })
  .split('\n')
  .filter(Boolean)
// 只用本地分支/标签：refs/remotes 在强推前指着旧提交，会把已经清掉的东西算进来（踩过）
const historyHits = []
for (const [name, re] of SECRET_PATTERNS) {
  for (const ref of refs) {
    try {
      const out = execFileSync('git', ['grep', '-l', '-I', '-E', re.source, ref], { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
      if (out) {
        const lines = out.split('\n').filter((l) => !ALLOW.some((a) => a.test(l)))
        if (lines.length) historyHits.push(`${name} → ${lines.slice(0, 3).join(' , ')}`)
      }
    } catch {
      /* 没命中 */
    }
  }
}
check(
  'git 历史（所有本地分支 + 标签）里没有令牌',
  historyHits.length === 0,
  historyHits.length ? historyHits.slice(0, 4).join(' | ') : `${refs.length} 个 ref 扫过`,
)

/* ---------- 3. 构建产物 ---------- */
const built = resolve('Dadealbit Markdown 编辑器.html')
if (existsSync(built)) {
  const text = readFileSync(built, 'utf-8')
  const hits = scan('built', text)
  // 产物里不该出现任何真实令牌；助手令牌是运行时才生成的
  check('双击用的单文件 HTML 里没有令牌', hits.length === 0, hits.join('；') || `${(statSync(built).size / 1024 / 1024).toFixed(1)} MB 扫过`)
} else {
  check('双击用的单文件 HTML 存在', false, '先 pnpm build')
}

/* ---------- 4. 桌面上的交付文件夹（要拷给别人的东西） ---------- */
const folders = [
  resolve(homedir(), 'Desktop', 'Dadealbit Markdown编辑器'),
  resolve(homedir(), 'Desktop', '自用'),
]
const walk = (dir, out = []) => {
  for (const entry of execFileSync('powershell', ['-NoProfile', '-Command', `Get-ChildItem -LiteralPath '${dir.replace(/'/g, "''")}' -Recurse -File | Select-Object -ExpandProperty FullName`], { encoding: 'utf-8' })
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)) {
    out.push(entry)
  }
  return out
}
for (const dir of folders) {
  if (!existsSync(dir)) {
    check(`交付文件夹 ${dir} 存在`, false, '还没打包')
    continue
  }
  const bad = []
  let n = 0
  for (const f of walk(dir)) {
    if (/(node\.exe|\.png|\.jpg|playwright)/i.test(f)) continue
    let text = ''
    try {
      text = readFileSync(f, 'utf-8')
    } catch {
      continue
    }
    n += 1
    const hits = scan(f, text)
    // 说明文件里"令牌"这个词是正常的（教用户去哪填）；只有真的像令牌的值才算问题
    if (hits.length) bad.push(`${f.replace(dir, '.')} → ${hits.join('；')}`)
  }
  check(`交付文件夹「${dir.split('\\').pop()}」里没有令牌`, bad.length === 0, bad.slice(0, 3).join(' | ') || `${n} 个文本文件扫过`)
}

/* ---------- 5. 助手令牌的来历：必须每次随机 ---------- */
const assistant = readFileSync(resolve('scripts', 'zhihu-assistant.mjs'), 'utf-8')
check(
  '助手令牌是运行时随机生成的（不是写死的）',
  /randomBytes\(\d+\)\.toString\('hex'\)/.test(assistant) && !/const TOKEN = '[A-Za-z0-9]{16,}'/.test(assistant),
)
check('助手所有写操作都要令牌（没有免令牌的写接口）', /if \(token !== TOKEN\)/.test(assistant))
check(
  '图床令牌只从浏览器 localStorage 读，不进代码',
  !/ghp_[A-Za-z0-9]{20,}/.test(readFileSync(resolve('src', 'editor', 'imageBed.ts'), 'utf-8')),
)

/* ---------- 6. 对外请求白名单：令牌只能发给"该收它的那两个地方" ----------
   图床令牌只该发 api.github.com；助手令牌只该发本机助手。
   这里把 src 里所有 fetch 的第一个参数抓出来，只允许白名单里的几个；
   顺带禁掉 XHR / sendBeacon / WebSocket 这些"另开一条外发通道"的写法。 */
const ALLOWED_REQUESTS = [
  { re: /^`\$\{addr\}\/(status|draft|login|selfcheck|upload-images|snapshot)`$/, why: '本机助手（含令牌的接口 + 只读的排障快照）' },
  { re: /^`\$\{nextAddr\}\/(status|draft|login|selfcheck|upload-images|snapshot)`$/, why: '本机助手（面板里那份地址）' },
  { re: /^`https:\/\/api\.github\.com\/repos\/\$\{repo\}\/contents\/\$\{path\}`$/, why: '图床：只发 api.github.com' },
  { re: /^url$/, why: 'jsDelivr 镜像探活（只 GET 图片本身，不带任何凭据）' },
  { re: /^`\$\{host\}\/gh\//, why: 'jsDelivr 镜像探活' },
]
const srcFiles = execFileSync('git', ['ls-files', 'src'], { encoding: 'utf-8' }).split('\n').filter((f) => /\.(ts|tsx)$/.test(f))
const weird = []
for (const f of srcFiles) {
  const text = readFileSync(f, 'utf-8')
  for (const m of text.matchAll(/fetch\(\s*([^,)\n]+)/g)) {
    const arg = m[1].trim()
    if (!ALLOWED_REQUESTS.some((a) => a.re.test(arg))) weird.push(`${f}: fetch(${arg.slice(0, 70)})`)
  }
  for (const m of text.matchAll(/new\s+XMLHttpRequest|sendBeacon|new\s+WebSocket|EventSource\(/g)) {
    weird.push(`${f}: ${m[0]}`)
  }
}
check(
  '对外请求只有"本机助手 + api.github.com + jsDelivr 探活"这几条',
  weird.length === 0,
  weird.slice(0, 4).join(' | ') || `${srcFiles.length} 个源文件扫过`,
)
check(
  '带令牌的请求只发这两个地方（代码里能对上）',
  /authorization: `Bearer \$\{token\}`/.test(readFileSync(resolve('src', 'editor', 'imageBed.ts'), 'utf-8')) &&
    /'x-dadealbit-token': token/.test(readFileSync(resolve('src', 'editor', 'saveFormats.ts'), 'utf-8')),
)

for (const r of results) if (!r.ok) console.log(`\n待查：${r.name}`)
const failed = results.filter((r) => !r.ok).length
console.log(`\n${results.length - failed}/${results.length} 通过`)
if (VERBOSE) console.log(`扫描范围：${tracked.length} 个跟踪文件 + ${refs.length} 个 git ref + 产物 + ${folders.length} 个交付文件夹`)
process.exit(failed ? 1 : 0)
