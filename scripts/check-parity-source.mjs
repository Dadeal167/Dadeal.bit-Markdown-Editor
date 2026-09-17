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
 *   4. 特效版产物**没被 git 跟踪**、被 .gitignore 排除；`自用` 的上游**不是公开仓库**
 *      （自用版有自己的私密仓库 private，那个上游是故意配的；不许配向 origin）
 *   5. 本机的 pre-push 钩子只放行 main/master/tags；所有 tag 指向的树里也没有特效代码
 *   6. README：`自用` 那份 = 公开那份 + 标记块（见 README 里的 `自用专属` 注释），
 *      把标记块连同标记一起删掉后，必须与公开那份**逐字节相同**
 *   7. 桌面两个交付文件夹（存在时）：分享版的 HTML 不含特效标记，自用版含
 *
 * 在公开仓库（没有 `自用` 分支）里跑会**自动跳过**，不会误报失败。
 *
 * 断言条数锁在这里（文档里写 `<!-- TEST_COUNT:check:parity-source -->` 占位符，
 * 由 check-docs-counts 对着这个常量渲染；收尾还会自检"实际条数 === 常量"）。
 * 加条数时只改这一处 —— 以前这里手写过"13 项"，改完忘了同步文档就漂了。
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { resolve } from 'node:path'

export const TEST_COUNT = 16

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
  ['scripts/check-components.mjs', '公开分支没有特效面板，面板巡游表里少一行'],
  ['scripts/coverage-report.mjs', '只多一行 baSprites 的覆盖登记（那个源文件只有自用分支有）'],
  /* 注意：本文件（check-parity-source.mjs）现在两个分支**完全一样**，所以不在这张白名单里。
     它以前写着"自用分支多几条特效素材白名单"；自从第 3 段改成"按内容判空壳"之后，两边查的东西
     就一致了 —— 白名单里留一条已经不相差的文件，只会让人以为它还在差。真要再分歧，这里会立刻报红。 */
  // 自用分支独有的文件（公开分支没有），所以它内部的改动不会两边不一致
  ['scripts/audit-mouse-effect.mjs', '特效体检（公开分支没有这个文件）'],
  ['scripts/check-file-effect.mjs', '特效落地文件检查（同上）'],
  ['scripts/import-mouse-spark.mjs', '特效导入脚本（同上）'],
  ['scripts/measure-cursor-tip.mjs', '指针尖端量测（只对自用版的指针素材有意义，公开分支没有那枚素材）'],
  ['scripts/audit-two-builds.mjs', '两版行为对比体检（同上）'],
  ['scripts/mutation-test-latex-repair.mjs', '公式修复的变异测试（开发期工具：临时改源码 + 反复构建，只在自用分支上跑）'],
  ['scripts/mutation-test-math-markdown.mjs', '公式保护的变异测试（同上是开发期工具：临时改源码 + 反复构建；配套的 check-math-markdown-safety 两个分支都有）'],
  ['scripts/mutation-test-parity-stubs.mjs', '本段守卫自己的变异测试（开发期工具：拿 main 的树造游离提交来试守卫是否真会翻红；公开分支上没有 `自用` 分支，会直接跳过）'],
  ['scripts/mutation-test-md-dest.mjs', '导入路径转义的变异测试（开发期工具：临时改源码 + 重新构建，只在本机跑；配套的 check-md-dest 两个分支都有）'],
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

/* ---------- 3. 公开分支上一个"另一个版本"的字样都不许有 ----------
 *
 * 这一条改过两次，把两次的原因都记下来（不然很容易又改回去）：
 *
 * 第一版：只查"文件树里不许出现 effects/ 或 EffectPanel 这些**路径**"。
 *   问题：公开分支就**编译不过**了 —— 共享源码 import 着 `./EffectPanel`、`./effects/mouseEffect`，
 *   而 vite 的 alias 只在 `--mode pure` 时挂、tsc 完全不认 alias，实测 tsc 直接报
 *   "Cannot find module './EffectPanel'"。
 *
 * 第二版：公开分支上放三个**空壳**（与自用分支的 *.pure 同内容），于是共享源码逐字相同、
 *   两边都能编译。代价：谁翻一下 src/ 都能看到 `EffectPanel.tsx`、`effects/mouseEffect.ts`
 *   这些**文件名和符号**，还有 `__NO_MOUSE_EFFECT__`、"鼠标点击特效"的注释 ——
 *   而用户的要求是："新用户只看分享版的仓库，**完全不知道**有自己用的这个版本"。
 *
 * 现在（第三版）：公开分支**完全没有这些东西**（文件删掉、接线摘掉、共享源码按需分叉，
 *   这几个文件本来就在下面的白名单里、逐块只允许"特效相关"的改动）。
 *   代价是两版共享源码不再逐字相同 —— 换来的正是用户要的那件事。
 *
 * 所以这里查两件事：
 *   a) 素材/实现/空壳文件在公开分支上**一律不许存在**（包括以前那三个空壳的路径）
 *   b) 公开分支的产物 HTML 里不许有特效标记（下面第 4 条）
 * 另外相对 import 解析守卫（第 5 条）保证"删了文件但没摘引用"这种坏法会被立刻抓住。
 */
const publicTree = git('ls-tree', '-r', '--name-only', PUBLIC).split('\n')
const FORBIDDEN_ON_PUBLIC = [
  'src/editor/effects/customCursor.ts', // 指针开关
  'src/editor/effects/cursor.png', // 指针素材
  'src/editor/effects/effectStyles.css', // 特效面板样式
  'src/editor/ColorField.tsx', // 特效面板里的取色器
  'src/editor/EffectPanel.tsx', // 特效面板本体（含空壳）
  'src/editor/EffectPanel.pure.tsx', // 空壳（第二版的老做法）
  'src/editor/effects/mouseEffect.ts',
  'src/editor/effects/mouseEffect.pure.ts',
  'src/editor/effects/mouseSpark.ts',
  'src/editor/effects/mouseSpark.pure.ts',
]
const leaked = FORBIDDEN_ON_PUBLIC.filter((f) => publicTree.includes(f))
check(
  '公开分支上没有任何特效文件（实现、素材、空壳一律不许有）',
  leaked.length === 0,
  leaked.join('、') || `检查了 ${FORBIDDEN_ON_PUBLIC.length} 个路径，一个都没出现`,
)

/** 特效**实现**的特征串（真代码里才有的东西）—— 判"空壳有没有被换成真实现"用它 */
const IMPL_MARKERS = /sparkCanvas|wavesPool|CREATE_CLICK_CFG|zh-fx__|cursorUrl|customCursor|rainbowPhase/
/** 特效**接线/符号**的特征串 —— 现在公开分支上连这些也不许有（用户要的是"完全看不出"）。
    注意与上面分开：老标签里那三个空壳文件是 `import type { MouseEffectSettings } …` 这种
    纯类型引用，它是"空壳"而不是"实现"，拿这一组去判会把历史标签误报（实测踩过）。 */
const TRACE_MARKERS = /sparkCanvas|wavesPool|CREATE_CLICK_CFG|zh-fx__|cursorUrl|customCursor|rainbowPhase|__NO_MOUSE_EFFECT__|MouseEffectSettings|自用版|自用分支|自用包|特效|纯净版|鼠标点击|波纹/
const sourceProblems = []
for (const f of publicTree.filter((x) => /^src\/.*\.(ts|tsx|css)$/.test(x))) {
  const text = show(PUBLIC, f).toString('utf-8')
  if (TRACE_MARKERS.test(text)) sourceProblems.push(f)
}
check(
  '公开分支的源码里没有特效符号（EffectPanel / __NO_MOUSE_EFFECT__ / sparkCanvas …）',
  sourceProblems.length === 0,
  sourceProblems.slice(0, 3).join('、') || `扫了 ${publicTree.filter((x) => /^src\/.*\.(ts|tsx|css)$/.test(x)).length} 个源文件`,
)

/**
 * 静态守卫：**树里每个相对 import 都要解析得到**。
 *
 * 为什么必须单独守这一条：上面那个"公开分支编译不过"的问题，所有功能套件都发现不了
 * （它们跑在自用分支上，那边文件是全的）。而"import 指向一个不存在的文件"是纯静态就能查的 ——
 * 一次遍历即可，比真跑一遍构建便宜得多。
 * 踩过：main 上 import 着只存在于自用分支的 ./EffectPanel，clone 下来 `pnpm build` 直接失败。
 * ⚠️ 路径必须先归一化（`../` 要真的往上走）：第一版只处理了 `./`，
 * 于是 src/editor/tiptap/MathNode.tsx → ../mathEvents 这种正常写法被误报成"解析不到"。
 */
const normalizePath = (p) => {
  const out = []
  for (const seg of p.split('/')) {
    if (!seg || seg === '.') continue
    if (seg === '..') out.pop()
    else out.push(seg)
  }
  return out.join('/')
}
function unresolvedImports(ref) {
  const files = git('ls-tree', '-r', '--name-only', ref).split('\n').filter(Boolean)
  const set = new Set(files)
  const relRe = /(?:from\s+|import\s*\(\s*|import\s+)['"](\.[^'"]*)['"]/g
  const bad = []
  let scanned = 0
  for (const f of files.filter((x) => /^src\/.*\.(ts|tsx)$/.test(x))) {
    const text = show(ref, f).toString('utf-8')
    for (const m of text.matchAll(relRe)) {
      scanned += 1
      const spec = m[1]
      const dir = f.split('/').slice(0, -1).join('/')
      const base = normalizePath(`${dir}/${spec}`)
      /* 归一化后再拼后缀。注意这里**不是**"只认 .ts/.tsx"：main.tsx 真的 import 了
         ./index.css、./dark.css，EffectPanel 真的 import 了 ./effects/effectStyles.css ——
         按"文件在同名路径下存在"判定，这几处才不会被误报。 */
      const cands = [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`]
      if (!cands.some((c) => set.has(c))) bad.push(`${f} → ${spec}`)
    }
  }
  return { bad, scanned }
}
/* 扫描条数的下限：这个守卫的价值全在"真的走过了源码"。
   如果哪天正则失配（比如 import 写法变了），scanned 会掉到 0 —— 那时 bad 也是空的、
   断言照样绿，等于守卫悄悄失效。所以这里连**覆盖量**一起断言（实测 main 109 处、自用 117 处）。 */
const MIN_SCANNED = 50
for (const ref of [PUBLIC, MINE]) {
  const { bad, scanned } = unresolvedImports(ref)
  check(
    `${ref} 分支的源码能编译（每个相对 import 都解析得到）`,
    bad.length === 0 && scanned >= MIN_SCANNED,
    bad.length
      ? bad.slice(0, 3).join('；')
      : scanned >= MIN_SCANNED
        ? `扫过 ${scanned} 处相对 import`
        : `只扫到 ${scanned} 处相对 import（少于 ${MIN_SCANNED}，守卫几乎没生效）`,
  )
}

/** 产物 HTML 里"出现即说明带了特效"的标记串（公开分支与所有标签共用同一份口径） */
const EFFECT_HTML_MARKERS = /sparkCanvas|mouseSpark|__NO_MOUSE_EFFECT__|zh-fx__/

const publicArtifact = show(PUBLIC, ARTIFACT).toString('utf-8')
check(
  '公开分支的 HTML 里没有特效代码',
  !EFFECT_HTML_MARKERS.test(publicArtifact),
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
check(
  '`自用` 的上游不是公开仓库（推不到 origin 上去）',
  (() => {
    /* 这条以前写的是"`自用` 必须没有上游"。后来自用版有了自己那个**私密**仓库
       （private），上游是**故意**配上的 —— 不该再禁止。
       真正要守的性质没变，而且更准了：自用版**永远推不到公开仓库**上去。
       配套的 pre-push 钩子（下面一条）做同一件事的第二道闸。 */
    const up = gitMaybe('rev-parse', '--abbrev-ref', '--symbolic-full-name', `${MINE}@{upstream}`)
    return up === null || up.split('/')[0] !== 'origin'
  })(),
  gitMaybe('rev-parse', '--abbrev-ref', '--symbolic-full-name', `${MINE}@{upstream}`) ?? '没有上游',
)
const hook = resolve('.git', 'hooks', 'pre-push')
const hookText = existsSync(hook) ? readFileSync(hook, 'utf-8') : ''
check(
  'pre-push 钩子只放行 main / master / 标签',
  /refs\/heads\/main/.test(hookText) && /refs\/tags/.test(hookText) && /exit 1/.test(hookText),
  existsSync(hook) ? '钩子在' : '❗钩子不存在（防误推保护缺失）',
)
const tags = git('tag', '-l').split('\n').filter(Boolean)
/* 标签的树：口径与第 3 段一致 ——
   · 素材/实现/空壳这些路径**一律不许出现**（v1.1.2 之前的标签里带过那三个空壳，
     所以旧标签的树会命中这条；这是"历史留痕"，下面按"允许旧标签"处理，
     只对**新打的标签**严格 —— 判据是"这个标签是不是指向现在这个 main"）
   · 树里的产物 HTML 不许带特效标记（对任何标签都严格查）
   踩过的坑：以前这条按"路径正则"判，公开分支改成空壳之后把 v1.1.1 误报成"树里有特效代码"；
   后来改成"空壳按内容判"，又留了个引用已删常量的坑（直接 ReferenceError 崩掉整个脚本，
   而变异测试把它当成"没翻红"，差点混过去）。 */
const badTags = []
const mainSha = gitMaybe('rev-parse', PUBLIC) ?? ''
for (const t of tags) {
  const tree = gitMaybe('ls-tree', '-r', '--name-only', t)
  if (tree === null) {
    badTags.push(`${t}（树读不到）`)
    continue
  }
  const files = tree.split('\n')
  const why = []
  /* 旧标签（发布过的历史快照）里合法存在过那三个"空壳"文件，所以对它们放宽到：
     · 素材/实现文件依然一个都不许有
     · 那三个路径若存在，内容里不许出现实现特征串
     指向**当前 main** 的标签则按第 3 段的严格口径查（一个文件、一个符号都不许有）。 */
  const LEGACY_STUB_PATHS = ['src/editor/EffectPanel.tsx', 'src/editor/effects/mouseEffect.ts', 'src/editor/effects/mouseSpark.ts']
  const materialOnly = FORBIDDEN_ON_PUBLIC.filter((f) => !LEGACY_STUB_PATHS.includes(f))
  const isCurrent = (gitMaybe('rev-list', '-n1', t) ?? '') === mainSha
  const strictPaths = isCurrent ? FORBIDDEN_ON_PUBLIC : materialOnly
  for (const f of strictPaths) if (files.includes(f)) why.push(`${f} 在树里`)
  for (const f of LEGACY_STUB_PATHS) {
    if (!files.includes(f)) continue
    if (IMPL_MARKERS.test(show(t, f).toString('utf-8'))) why.push(`${f} 里有特效实现`)
  }
  if (isCurrent) {
    for (const f of files.filter((x) => /^src\/.*\.(ts|tsx|css)$/.test(x))) {
      if (TRACE_MARKERS.test(show(t, f).toString('utf-8'))) why.push(`${f} 里有特效符号`)
    }
  }
  if (files.includes(ARTIFACT) && EFFECT_HTML_MARKERS.test(show(t, ARTIFACT).toString('utf-8'))) {
    why.push('产物 HTML 里有特效代码')
  }
  if (why.length) badTags.push(`${t}（${why.join('、')}）`)
}
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
/* 自检：实际跑了几条就必须是几条。
   少了说明某一段被跳过/条件写错（比如某段被挪进 if 里、条件再也进不去）——
   这种情况下剩下的断言照样全绿，"全绿"就是假的。
   实测（`pnpm mutation:parity` 的变异五/六）：把"桌面交付文件夹"那一整段的条件换成 `if (false)`，
   条数从 16 掉到 13 而其余全绿；只有这条自检能拦住它。 */
if (results.length !== TEST_COUNT) {
  console.log(`\n❌  断言条数自检：实际 ${results.length} 条，TEST_COUNT 写的是 ${TEST_COUNT}`)
  process.exit(1)
}
console.log(`\n${results.length - failed.length}/${results.length} 项通过`)
process.exit(failed.length ? 1 : 0)
