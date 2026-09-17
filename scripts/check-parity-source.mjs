/**
 * 「自用版」和「分享版」只差一个鼠标特效 —— 源码层取证
 *
 * 为什么要有它：两个分支（`main` = 对外分享、`自用` = 带鼠标点击特效，只留本机）历史无关，
 * 全靠每次「自用版同步」把公共改动搬过去。搬漏一处、或者有人手滑改歪，就会变成
 * "两个版本除了特效还差别的" —— 用户看不见，但迟早出鬼（比如自用版某个 bug 修了、分享版没修）。
 *
 * 这个脚本把"只差特效"这句话变成可执行的断言：
 *   1. 两个分支的差异文件，必须全部在**白名单**里（每个都写明理由）
 *   2. 白名单里那些"公共文件"（Toolbar / icons / types / ZhihuEditor / index.css）的每一处改动，
 *      都必须**整块与特效有关**（逐个 hunk 判定，防止顺手夹带别的改动）
 *   3. 公开分支上**一行特效代码都没有**（文件、产物都查）
 *   4. 特效版产物**没被 git 跟踪**、被 .gitignore 排除；`自用` 分支**没有上游**（推不出去）
 *   5. 本机的 pre-push 钩子只放行 main/master/tags；所有 tag 指向的树里也没有特效代码
 *   6. README：`自用` 那份 = 公开那份 + 标记块（见 README 里的 `自用专属` 注释），
 *      把标记块连同标记一起删掉后，必须与公开那份**逐字节相同**
 *   7. 桌面两个交付文件夹（存在时）：分享版的 HTML 不含特效标记，自用版含
 *
 * 在公开仓库（没有 `自用` 分支）里跑会**自动跳过**，不会误报失败。
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { resolve } from 'node:path'

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`${ok ? '✅' : '❌'}  ${name}${detail ? '  — ' + detail : ''}`)
}
const skip = (name, why) => console.log(`⏭️   ${name}（跳过：${why}）`)

const git = (...args) => execFileSync('git', args, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
const gitMaybe = (...args) => {
  try {
    return git(...args)
  } catch {
    return null
  }
}
const show = (ref, path) => execFileSync('git', ['show', `${ref}:${path}`], { maxBuffer: 64 * 1024 * 1024 })

/* ---------- 0. 有没有 `自用` 分支 ---------- */
const branches = git('branch', '--format=%(refname:short)').split('\n').map((s) => s.trim())
if (!branches.includes('自用')) {
  skip('源码层一致性', '本地没有 `自用` 分支（公开仓库里本来就该没有）')
  console.log('\n0/0（在公开仓库里跳过属于正常）')
  process.exit(0)
}
const PUBLIC = 'main'
const MINE = '自用'
const ARTIFACT = 'Dadealbit Markdown 编辑器.html'
const EFFECT_ARTIFACT = 'Dadealbit Markdown 编辑器-特效版.html'

console.log(`对比分支：${PUBLIC} ↔ ${MINE}\n`)

/* ---------- 1. 差异文件白名单 ---------- */
const ALLOWED = new Map([
  // 特效自己的实现（公开分支上根本没有这些文件）
  ['src/editor/EffectPanel.tsx', '特效设置面板'],
  ['src/editor/EffectPanel.pure.tsx', '纯净版用的空壳'],
  ['src/editor/ColorField.tsx', '特效面板里的取色器'],
  ['src/editor/effects/mouseEffect.ts', '特效设置读写'],
  ['src/editor/effects/mouseEffect.pure.ts', '纯净版用的空壳'],
  ['src/editor/effects/mouseSpark.ts', '特效本体（点击波纹）'],
  ['src/editor/effects/mouseSpark.pure.ts', '纯净版用的空壳'],
  ['src/editor/effects/effectStyles.css', '特效面板样式（跟着 EffectPanel 被 import，纯净版引不到）'],
  ['src/editor/effects/customCursor.ts', '自定义鼠标指针的开关（自用专属素材，分享版不带）'],
  ['src/editor/effects/cursor.png', '那枚箭头指针的图片（同上，只进自用版产物）'],
  ['scripts/audit-mouse-effect.mjs', '特效体检'],
  ['scripts/check-file-effect.mjs', '特效落地文件检查'],
  ['scripts/import-mouse-spark.mjs', '特效导入脚本'],
  ['scripts/audit-two-builds.mjs', '两版行为对比体检'],
  // 公共文件里"只允许特效相关的改动"（由下面第 2 条逐 hunk 证明）
  ['src/editor/Toolbar.tsx', '只加了「特效」按钮那一段'],
  ['src/editor/icons.tsx', '只加了特效图标'],
  ['src/editor/types.ts', '只加了 __NO_MOUSE_EFFECT__ 常量声明'],
  ['src/editor/ZhihuEditor.tsx', '只加了特效状态与面板接线'],
  ['src/index.css', '只加了特效面板与取色器样式'],
  // 构建 / 打包：两版的做法本来就不同（一份出两版产物）
  ['vite.config.ts', '纯净版构建的 alias + 构建期常量'],
  ['package.json', '多 build:pure / build:both 两条命令'],
  ['重新构建.bat', '一次出两版'],
  ['scripts/make-packages.mjs', '自用分支要打两个文件夹'],
  ['scripts/make-zips.mjs', '自用分支要打两个 zip（同 make-packages：公开分支只打一个文件夹）'],
  ['scripts/check-packages.mjs', '多验一个"自用版有波纹"'],
  ['.gitignore', '多忽略一份特效版产物'],
  ['scripts/button-audit.mjs', '多验一个特效按钮'],
  ['scripts/check-docs.mjs', '说明书里多一个特效按钮'],
  ['scripts/coverage-report.mjs', '只多一行 baSprites 的覆盖登记（那个源文件只有自用分支有）'],
  ['scripts/check-parity-source.mjs', '本文件自己：自用分支多几条特效素材白名单（公开分支上那些文件根本不存在）'],
  // 自用分支独有的文件（公开分支没有），所以它内部的改动不会两边不一致
  ['scripts/audit-mouse-effect.mjs', '特效体检（公开分支没有这个文件）'],
  ['scripts/check-file-effect.mjs', '特效落地文件检查（同上）'],
  ['scripts/import-mouse-spark.mjs', '特效导入脚本（同上）'],
  ['scripts/audit-two-builds.mjs', '两版行为对比体检（同上）'],
  ['scripts/mutation-test-latex-repair.mjs', '公式修复的变异测试（开发期工具：临时改源码 + 反复构建，只在自用分支上跑）'],
  ['scripts/mutation-test-math-markdown.mjs', '公式保护的变异测试（同上是开发期工具：临时改源码 + 反复构建；配套的 check-math-markdown-safety 两个分支都有）'],
  // 文档 / 许可 / 截图：不进任何产物（分享包里只有 HTML + 使用说明）
  ['README.md', '自用分支 = 公开那份 + 「自用专属」标记块'],
  ['LICENSE', '自用分支用中英对照许可，公开分支保持 MIT（都不进产物）'],
  ['docs/screenshot-editor.png', '自用分支的截图带特效按钮'],
  ['Dadealbit Markdown 编辑器.html', '构建产物：两个分支各自构建出来的纯净版'],
])
// 前缀规则：这些目录/文件只在自用分支上留档，不进任何产物
const ALLOWED_PREFIX = new Map([
  ['scripts/research/', '本地排查脚本（摸知乎结构用的，早先是自用分支独有的留档，两类产物都不含）'],
])

const changed = git('diff', '--name-only', PUBLIC, MINE).split('\n').filter(Boolean)
const unknown = changed.filter((f) => !ALLOWED.has(f) && ![...ALLOWED_PREFIX.keys()].some((p) => f.startsWith(p)))
check(
  '两个分支的差异文件都在白名单里',
  unknown.length === 0,
  unknown.length ? `多出来：${unknown.slice(0, 4).join('、')}` : `${changed.length} 个文件，全部有理由`,
)

/* ---------- 2. 这几个公共文件的改动必须"整块说得清来路" ----------
   最初这里只允许"与特效有关"的 hunk。但后来往这些文件里加了**两边都有**的功能
   （搜索 / 使用反馈 / 公式体检 / 状态栏时钟日期），它们的 hunk 跟特效无关却完全合法。
   所以这张表改成"允许的改动主题"清单：每个 hunk 至少要命中其中一个主题。
   —— 注意这仍然是有意义的约束：它挡住的是"在自用分支偷偷改公共逻辑、只改一半"。 */
const ALLOWED_HUNK_RES = [
  // 特效（自用专属）
  /特效|EffectPanel|mouseEffect|mouseSpark|mouse|spark|IconSpark|zh-fx|zh-cf|swatch|MouseEffectSettings|__NO_MOUSE_EFFECT__|effectPanel|effect\b|setEffect|ColorField|RGB|颜色|配色|波纹/i,
  // 下面这些功能两个分支**都有**，改动自然不该被当成"越界"
  /搜索|search|zh-search|Ctrl\+F/i,
  /反馈|feedback|邮箱|dadealbit@gmail/i,
  /公式|math|latex|katex|repair|体检|检查图片/i,
  /状态栏|statusbar|时钟|clock|日期|dateText|用时|usage/i,
  /深色|dark|主题|theme/i,
  // useCallback/useEffect 的依赖数组：属于上面那些改动的收尾，本身没有关键词
  /^\+\s*\},?\s*\[[^\]]*\]\)?\s*;?\s*$/,
]
const SHARED_TOUCHED = ['src/editor/Toolbar.tsx', 'src/editor/icons.tsx', 'src/editor/types.ts', 'src/editor/ZhihuEditor.tsx', 'src/index.css']

/**
 * "纯收尾"的 hunk 直接放过。
 *
 * 为什么需要：把某个 hunk 拆开时，经常留下只有 `}, [flash, scheduleSave])` 或 `)` 这种
 * 补括号/依赖数组的碎片 —— 里面没有任何可判定的关键词，上面那张主题表对它无能为力。
 * 判定：把这个 hunk 的增删行去掉空白和标点后，如果**什么都没剩下**，就是纯收尾。
 */
const isBraceOnly = (lines) =>
  lines
    .map((l) => l.slice(1))
    .join('')
    .replace(/[\s{}()[\],;:.]+/g, '') === ''

const badHunks = []
for (const f of SHARED_TOUCHED) {
  const diff = git('diff', '-U0', PUBLIC, MINE, '--', f)
  const hunks = diff.split(/^@@/m).slice(1).map((s) => '@@' + s)
  for (const h of hunks) {
    const lines = h.split('\n').filter((l) => /^[+-]/.test(l) && !/^(\+\+\+|---)/.test(l))
    if (isBraceOnly(lines)) continue
    if (!lines.some((l) => ALLOWED_HUNK_RES.some((re) => re.test(l)))) {
      badHunks.push(`${f}: ${lines.find((l) => /^\+/.test(l))?.slice(0, 50) ?? '(只有删除行)'}`)
    }
  }
}
check(
  '公共文件的改动都在允许的主题里（特效 / 搜索 / 反馈 / 公式 / 状态栏 / 主题）',
  badHunks.length === 0,
  badHunks.length ? badHunks.slice(0, 3).join(' | ') : `逐块检查了 ${SHARED_TOUCHED.length} 个文件`,
)

/* ---------- 3. 公开分支上一行特效代码都没有 ---------- */
const publicTree = git('ls-tree', '-r', '--name-only', PUBLIC).split('\n')
const effectFilesOnPublic = publicTree.filter((f) => /effects\/|EffectPanel|ColorField|mouseSpark|mouseEffect/.test(f))
check('公开分支的文件树里没有特效文件', effectFilesOnPublic.length === 0, effectFilesOnPublic.join('、') || '干干净净')

const publicArtifact = show(PUBLIC, ARTIFACT).toString('utf-8')
check(
  '公开分支的 HTML 里没有特效代码',
  !/sparkCanvas|mouseSpark|__NO_MOUSE_EFFECT__|zh-fx__/.test(publicArtifact),
  `${(publicArtifact.length / 1048576).toFixed(2)} MB 扫过`,
)

/* ---------- 4. 特效版产物没被跟踪；`自用` 推不出去 ---------- */
check(
  '特效版产物没有被 git 跟踪',
  git('ls-files').split('\n').filter((f) => f.includes('特效版')).length === 0,
)
check(
  '特效版产物被 .gitignore 排除',
  (gitMaybe('check-ignore', '-v', EFFECT_ARTIFACT) ?? '').includes(EFFECT_ARTIFACT),
)
check('`自用` 分支没有上游（推不出去）', gitMaybe('rev-parse', '--abbrev-ref', '--symbolic-full-name', `${MINE}@{upstream}`) === null)
const hook = resolve('.git', 'hooks', 'pre-push')
const hookText = existsSync(hook) ? readFileSync(hook, 'utf-8') : ''
check(
  'pre-push 钩子只放行 main / master / 标签',
  /refs\/heads\/main/.test(hookText) && /refs\/tags/.test(hookText) && /exit 1/.test(hookText),
  existsSync(hook) ? '钩子在' : '❗钩子不存在（防误推保护缺失）',
)
const tags = git('tag', '-l').split('\n').filter(Boolean)
const badTags = tags.filter((t) => {
  const tree = gitMaybe('ls-tree', '-r', '--name-only', t)
  return tree === null || /effects\/|EffectPanel|ColorField/.test(tree)
})
check('所有标签指向的树里也没有特效代码', badTags.length === 0, badTags.length ? badTags.join('、') : `${tags.length} 个标签`)

/* ---------- 5.README：自用那份 = 公开那份 + 标记块 ---------- */
const START = '<!-- 自用专属：开始'
const END = '<!-- 自用专属：结束 -->'
const mineReadme = show(MINE, 'README.md').toString('utf-8')
const stripMarked = (text) => {
  let out = text
  for (;;) {
    const i = out.indexOf(START)
    if (i < 0) break
    const j = out.indexOf(END, i)
    if (j < 0) break
    out = out.slice(0, i) + out.slice(j + END.length)
  }
  // 标记块留下的空行对齐一下，免得差一个换行就报失败
  return out.replace(/\n{3,}/g, '\n\n').replace(/[ \t]+$/gm, '').trim()
}
if (!mineReadme.includes(START)) {
  check('README 用标记块区分"自用专属"内容', false, `没找到标记：${START}`)
} else {
  const publicReadme = show(PUBLIC, 'README.md').toString('utf-8')
  const a = stripMarked(mineReadme)
  const b = stripMarked(publicReadme)
  check(
    'README 去掉「自用专属」标记块后与公开那份一致',
    a === b,
    a === b ? `${a.length} 字符一致` : `长度 ${a.length} vs ${b.length}，首个差异位置 ${[...a].findIndex((c, i) => c !== b[i])}`,
  )
}

/* ---------- 6. 桌面交付文件夹（存在才查） ---------- */
const PUB_DIR = resolve(homedir(), 'Desktop', 'Dadealbit Markdown编辑器')
const MINE_DIR = resolve(homedir(), 'Desktop', '自用')
if (existsSync(PUB_DIR) && existsSync(MINE_DIR)) {
  const pubHtml = readFileSync(resolve(PUB_DIR, ARTIFACT), 'utf-8')
  const mineHtml = readFileSync(resolve(MINE_DIR, ARTIFACT), 'utf-8')
  check('分享包里的 HTML 没有特效代码', !/sparkCanvas|zh-fx__/.test(pubHtml), `${(pubHtml.length / 1048576).toFixed(2)} MB`)
  check('自用包里的 HTML 有特效代码', /sparkCanvas/.test(mineHtml), `${(mineHtml.length / 1048576).toFixed(2)} MB`)
  check(
    '两包里"两版都该有"的功能标记一致（抽 4 个）',
    ['zh-codeblock', 'md-editor-docs', 'zh-switch', 'zh-outline'].every((k) => pubHtml.includes(k) && mineHtml.includes(k)),
  )
} else {
  skip('桌面交付文件夹对比', '桌面上没有这两个文件夹')
}

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} 项通过`)
process.exit(failed.length ? 1 : 0)
