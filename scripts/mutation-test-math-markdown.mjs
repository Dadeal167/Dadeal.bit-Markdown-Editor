/* 变异测试：把"公式保护"的各个环节逐一拆掉，确认 check-math-markdown-safety 会变红。
   一次只变异一处，跑一遍套件，再恢复。

   为什么必须做：套件在**没修任何东西**的情况下就全绿（因为防线本来就在），
   所以"全绿"本身证明不了任何事 —— 只有证明"拆掉它会红"，这些断言才算数。

   支持多文件变异：每个变异可以用 `target` 指定文件（默认 mathMarkdown.ts）。
   剪贴板那条修复在 useMarkdownEditor.ts 上，所以需要这个能力。

   用法：node scripts/mutation-test-math-markdown.mjs
*/
import { execFileSync } from 'node:child_process'
import { copyFileSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

/** 可以变异的源文件（键名 = 变异里的 `target`，缺省用 defaultTarget） */
const TARGETS = {
  mathMarkdown: resolve('src/editor/tiptap/mathMarkdown.ts'),
  useMarkdownEditor: resolve('src/editor/useMarkdownEditor.ts'),
  /* 公式节点自己 —— "行内 ⇄ 行间"换排版、长公式缩放都在这里 */
  mathNode: resolve('src/editor/tiptap/MathNode.tsx'),
  /* 图片节点 —— 图片对齐写进 Markdown 的 title 哨兵在这里 */
  safeImage: resolve('src/editor/tiptap/SafeImage.ts'),
}
const DEFAULT_TARGET = 'mathMarkdown'
const SUITE = 'scripts/check-math-markdown-safety.mjs'

/* 每个目标文件各备份一份，跑完逐一恢复。
 *
 * ⚠️ **每次运行都要用当前源文件刷新备份** —— 不能"只在备份不存在时才写"。
 * 踩过的坑：备份是 09-25 建的，之后源文件里新加了 `stripLeakedMarks`；
 * 再跑变异时，脚本拿**旧备份**去变异（里面没有这个函数），于是
 * "整段替换函数"直接把函数删掉 → 别的文件 import 失败 → **所有变异都构建失败**，
 * 表现成"6 条全部无法判定"，看着像断言有问题，其实是脚本的备份过期了。
 * 现在改成：每次运行都以当前源文件为准重建备份，并在恢复后核对一次。
 */
const originals = {}
for (const [key, path] of Object.entries(TARGETS)) {
  const backup = resolve(`.probe/out/_mut_${key}.backup.ts`)
  copyFileSync(path, backup)
  originals[key] = readFileSync(path, 'utf8')
  console.log(`已备份 ${key}（取自当前源文件）→ ${backup}`)
}

/**
 * 不管怎么退出都要把源文件恢复回去 —— **包括被超时/信号杀掉**。
 *
 * 踩过的坑（2026-09-27）：这个脚本跑十几分钟，超过单次命令的 10 分钟上限被强杀，
 * 没走到结尾的恢复流程 → 工作区里**留着变异代码**（`SafeImage.ts` 里那行
 * `title + caption.slice(0, 0)` 就是残留）。之后几轮验证全被污染：
 * 图片套件报红、接着全量回归大面积失败，看着像"改坏了"，其实是脚本没清干净。
 * 所以：注册退出/信号处理器兜底恢复，并且在启动时先检查目标文件与 git 是否一致
 * （不一致就说明上次没清干净或有人手改过 —— 直接拒绝运行）。
 */
let restored = false
const restoreAll = () => {
  if (restored) return
  restored = true
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
process.on('uncaughtException', (e) => {
  restoreAll()
  console.error('未捕获异常，已恢复源文件：', e)
  process.exit(1)
})

/* 启动前自检：目标文件必须和 git 里的版本一致（工作区干净）。
   为什么要拦：留着上次的变异代码再跑，会出现"变异没能应用"和"套件莫名变红"，
   甚至把变异代码当成"原文件"备份下来、再"恢复"回去 —— 污染会一直传下去。 */
try {
  const dirty = execFileSync('git', ['status', '--porcelain', '--', ...Object.values(TARGETS)], {
    encoding: 'utf8',
  }).trim()
  if (dirty) {
    console.error('\n❌ 这些目标文件在工作区里有未提交的改动（可能是上次变异没清干净）：')
    console.error(dirty)
    console.error('   先把它们提交或还原（git checkout -- <文件>）再跑变异 —— 否则变异和"原文件"分不清。')
    process.exit(2)
  }
} catch {
  /* 没有 git 就跳过这道自检 */
}

const run = (cmd, args) => {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8', maxBuffer: 1 << 26, shell: true })
  } catch (e) {
    return (e.stdout || '') + (e.stderr || '')
  }
}

/** 整段函数替换（照抄 latex-repair 那套，不留碎片）
 *
 *  ⚠️ 踩过的坑：不能直接找第一个 `{` 当函数体起点 ——
 *  参数里有解构声明（`protectMathSpans(md: string): { md: string; spans: MathSpan[] }`）
 *  那个 `{` 在**返回类型**里，会被误当成函数体开头，切出来的代码语法直接坏掉
 *  （实测：TS1005 ';' expected，构建失败 → 变异无法判定）。
 *  正确做法：先配对**圆括号**找到参数表结尾，再从那里往后找函数体的 `{`。
 */
function replaceFunction(text, fnName, newBody) {
  const sig = `export function ${fnName}(`
  const at = text.indexOf(sig)
  if (at < 0) return null
  /* 1) 从参数表的左括号开始配平圆括号 */
  const paramOpen = at + sig.length - 1
  let pdepth = 0
  let paramClose = -1
  for (let i = paramOpen; i < text.length; i++) {
    if (text[i] === '(') pdepth += 1
    else if (text[i] === ')') {
      pdepth -= 1
      if (pdepth === 0) {
        paramClose = i
        break
      }
    }
  }
  if (paramClose < 0) return null
  /* 2) 参数表之后、函数体之前的返回类型：可能是 `{…}`（对象字面量类型）、
        也可能是 `void` / `string` / `boolean[]` 这类简单类型。
        简单类型一路跳过（不含花括号），对象类型要配平花括号。 */
  let i = paramClose + 1
  while (i < text.length && /\s/.test(text[i])) i++
  if (text[i] === ':') {
    i++
    while (i < text.length && /\s/.test(text[i])) i++
    if (text[i] === '{') {
      /* 对象字面量返回类型：配平花括号 */
      let rdepth = 0
      for (; i < text.length; i++) {
        if (text[i] === '{') rdepth += 1
        else if (text[i] === '}') {
          rdepth -= 1
          if (rdepth === 0) {
            i++
            break
          }
        }
      }
      while (i < text.length && /\s/.test(text[i])) i++
    } else {
      /* 简单类型（void / string / boolean[] …）：吃到函数体的 `{` 为止 */
      while (i < text.length && text[i] !== '{' && text[i] !== '\n') i++
      while (i < text.length && /\s/.test(text[i])) i++
    }
  }
  /* 3) 现在 i 指向函数体的 `{` */
  if (text[i] !== '{') return null
  const open = i
  let depth = 0
  for (let k = open; k < text.length; k++) {
    if (text[k] === '{') depth += 1
    else if (text[k] === '}') {
      depth -= 1
      if (depth === 0) {
        const signature = text.slice(at, open)
        return text.slice(0, at) + signature + '{\n' + newBody + '\n}\n' + text.slice(k + 1)
      }
    }
  }
  return null
}

/* 变异 1：让"像不像公式"的判定永远为假 → 这个 $ 不被消耗，原文直接进文档。
   为什么用"改判定表达式"而不是"改 out += 那行"：
   改了两次模板字符串拼接都栽在转义上（TS1127 Invalid character / TS1005）。
   改一个条件表达式不含反引号，最不容易把语法改坏。 */
const MUTATION_1 = {
  name: '把"像公式"的判定改成永远为假（公式不再被保护）→ 预期**红**',
  expectCaught: true,
  apply: (t) => t.replace('if (latex.trim() && looksLikeLatex(latex)) {', 'if (false && latex.trim() && looksLikeLatex(latex)) {'),
}

/* 变异 2：protectMathSpans 整个变成"什么都不做"。
   注意参数必须在函数体里被引用，否则 tsc 的 noUnusedParameters 会报 TS6133，
   于是构建失败、变异无法判定（第一次就是这么栽的）。 */
const MUTATION_2 = {
  name: 'protectMathSpans 什么也不做（公式完全不保护）→ 预期**红**',
  expectCaught: true,
  apply: (t) =>
    replaceFunction(
      t,
      'protectMathSpans',
      `  /* 变异：参数保留引用，避免 tsc 报未使用 */
  const spans: MathSpan[] = []
  if (md.length < 0) return { md: md + spans.length, spans }
  return { md, spans }`,
    ),
}

/* 变异 3：占位符不再还原成公式节点。同样要引用参数避免 TS6133。 */
const MUTATION_3 = {
  name: '取消还原（占位符不再变成公式节点）→ 预期**红**',
  expectCaught: true,
  apply: (t) =>
    replaceFunction(
      t,
      'restoreMathSpans',
      `  /* 变异：参数保留引用，避免 tsc 报未使用 */
  if (root.childNodes.length < 0 && spans.length < 0) return
  return`,
    ),
}

/* 变异 4：去掉剪贴板的纯文本降级方案。
   I 组断言（"复制成纯文本时公式不许消失"）守的就是它 ——
   去掉之后公式在 text/plain 里必然重新变空，这是实测过的原始缺陷形态。 */
const MUTATION_4 = {
  name: '去掉 clipboardTextSerializer（纯文本里公式重新消失）→ 预期**红**',
  expectCaught: true,
  target: 'useMarkdownEditor',
  /* 必须把**函数定义**、它专用的**类型导入**、以及**它用到的守卫 import** 一起处理 ——
     只删 `editorProps` 里那一行会撞 `TS6133 声明了但没人用`（tsc 的 noUnusedLocals），
     构建失败 → 变异无法判定。连撞三次，每次脚本都如实报"构建失败、不是没抓住"。
     ⚠️ 加了个新 import 之后（stripLeakedMarks）又撞一次：删了调用方，import 就悬空了。
     所以这里把整个 import 行替换成不带 stripLeakedMarks 的版本，而不是删行。 */
  apply: (t) =>
    t
      .replace(/^[ \t]*clipboardTextSerializer: clipboardTextSerializer as never,\r?\n/m, '')
      .replace(/^function clipboardTextSerializer\(slice: \{ content: PMNode \}\): string \{[\s\S]*?\r?\n\}\r?\n\r?\n/m, '')
      .replace(/^import type \{ Node as PMNode \} from '@tiptap\/pm\/model'\r?\n/m, '')
      .replace(
        /^import \{ protectMathSpans, recoverEscapedMath, stripLeakedMarks \} from '\.\/tiptap\/mathMarkdown'\r?\n/m,
        "import { protectMathSpans, recoverEscapedMath } from './tiptap/mathMarkdown'\n",
      ),
}

/* 变异 5：把"标记字符守卫"变成空操作（直通返回）。
   J 组断言守的就是它 —— 尤其 J5~J8 是**直接喂泄漏形态给守卫本体**的，
   去掉守卫之后那几条必然红。 */
const MUTATION_5 = {
  name: '标记字符守卫变成空操作（控制字符可能流出）→ 预期**红**',
  expectCaught: true,
  /* ⚠️ 正则在 `: string` 和 `{` 之间用 `\s*` —— 不能写死一个空格：
     新函数写成 `): string {`（换行再大括号）时就匹配不上，变异会"静默不生效"
     （脚本会如实报"没能应用"，但那一条就白跑了）。 */
  apply: (t) =>
    replaceFunction(
      t,
      'stripLeakedMarks',
      `  /* 变异：直通返回，不做任何清理（引用参数避免 tsc 报未使用） */
  if (md.length < 0 && where.length < 0) return md
  return md`,
      // eslint-disable-next-line no-undef
      { flexibleSignature: true },
    ),
}

/* 变异 6：把 onUpdate 改回"每敲一个键就整篇序列化一次"。
   check-typing-performance 的 C 组（连敲 20 个字只许交 2 次）守的就是它 ——
   改回去之后每键交一次，计数器直接涨到 20。
   ⚠️ 注入的是 `emitMarkdown(instance)`（= 序列化 + 交给界面，正是旧代码那一行的等价物），
   不是裸调 getMarkdown：不然计数器（在 emitMarkdown 里）看不到这次序列化，
   变异就"抓不住"了 —— 第一次就是这么假绿的。
   注入成"再加一行"而不是"替换掉 scheduleEmit"：后者会让 scheduleEmit 变成未使用，
   tsc 的 noUnusedLocals 直接让构建失败（变异无法判定，不是没抓住）。 */
const MUTATION_6 = {
  name: 'onUpdate 改回"每个键都整篇序列化"（打字重新变卡）→ 预期**红**',
  expectCaught: true,
  target: 'useMarkdownEditor',
  suite: 'scripts/check-typing-performance.mjs',
  apply: (t) => {
    /* ⚠️ 这几个源文件是 CRLF 换行 —— 用 '\n' 写死的 needle 一定匹配不上
       （第一次就是这么"变异没能应用"的：套件没红，看着像断言不行，其实是没改到代码）。
       所以这里用 `\r?\n`。 */
    const re = /^( {6}scheduleEmit\(instance\)\r?\n)( {4}\},)/m
    if (!re.test(t)) return null
    return t.replace(re, '$1      emitMarkdown(instance)\n$2')
  },
}

/* 变异 7：把 finalizeMarkdown 的转义改回"逐字符循环 + 整篇遮罩表"。
   check-typing-performance 的 A 组大正文那条（2MB 级必须 < 25ms）守的就是它 ——
   改回去之后每调用一次要建一张和正文一样长的遮罩表、再逐字符拼一遍（实测 ≈80ms）。
   按行替换（不整段替换函数）：函数体里有模板字符串，整段替换很容易在转义上栽跟头。 */
const MUTATION_7 = {
  name: 'finalizeMarkdown 改回"逐字符循环 + 整篇遮罩表"→ 预期**红**',
  expectCaught: true,
  suite: 'scripts/check-typing-performance.mjs',
  apply: (t) => {
    const lines = t.split('\n')
    const i = lines.findIndex((l) => l.includes('withEscaped = md.replace('))
    if (i < 0) return null
    lines[i] = [
      "    let acc = ''",
      "    for (let k = 0; k < md.length; k += 1) acc += md[k] === '$' && !inCode[k] ? '\\\\$' : md[k]",
      '    withEscaped = acc',
    ].join('\n')
    const out = lines
      .join('\n')
      .replace('const inCode = hasCodeMarkup(md) ? codeMask(md) : null', 'const inCode = codeMask(md)')
    return out === t ? null : out
  },
}

/* 变异 8：把"改排版"那条路改回去（display 忽略，只改 latex）。
   audit-review 里那组新断言守的就是它（用户 2026-09-26："公式怎么单独占一行"）——
   改回去之后"点开行内公式 → 切行间 → 确认"文档里一点不变，那几条必然红。
   注意 `void display`：不引用参数会被 tsc 的 noUnusedParameters 拦下（构建失败 = 无法判定）。 */
const MUTATION_8 = {
  name: '公式排版切换改回"只改内容不动排版"（行内⇄行间失效）→ 预期**红**',
  expectCaught: true,
  target: 'mathNode',
  suite: 'scripts/audit-review.mjs',
  apply: (t) =>
    t.replace(
      'const wantBlock = display === undefined ? isBlockNode : !!display',
      'const wantBlock = isBlockNode\n          void display',
    ),
}

/* 变异 9：行内→行间 退回"把整段交给 ProseMirror 切"（不做三种边界特判）。
   实测那样会在"整段只有一个公式"时切出一个**空段落**（导出的 Markdown 顶上多一个空行）——
   audit-review 里"不留空段落"那条守的就是它。 */
const MUTATION_9 = {
  name: '行内→行间 退回"整段交给 Fitter"（会切出空段落）→ 预期**红**',
  expectCaught: true,
  target: 'mathNode',
  suite: 'scripts/audit-review.mjs',
  apply: (t) => {
    const a = t.replace('const nothingBefore = idx === 0', 'const nothingBefore = false && idx === 0')
    const b = a.replace(
      'const nothingAfter = idx === parent.childCount - 1',
      'const nothingAfter = false && idx === parent.childCount - 1',
    )
    return b === t ? null : b
  },
}

/* 变异 10：图片对齐不再写进 Markdown（title 哨兵失效）。
   check-image-align 里"存盘再打开：居中还在"那条守的就是它 —— 文档是以 Markdown 存的，
   哨兵不写进去，刷新后就退回左边（用户看到的就是"设了没用"）。 */
const MUTATION_10 = {
  name: '图片对齐不写进 Markdown（存盘后对齐丢失）→ 预期**红**',
  expectCaught: true,
  target: 'safeImage',
  suite: 'scripts/check-image-align.mjs',
  apply: (t) => {
    const lines = t.split('\n')
    const i = lines.findIndex((l) => l.includes('const outTitle = encodeImageTitle('))
    if (i < 0) return null
    /* ⚠️ 保留 `caption` 的引用：这一行改完之后 caption 会变成"声明了没用"，
       tsc 的 noUnusedLocals 直接让构建失败（变异就"无法判定"了，不是没抓住）。 */
    lines[i] = '          const outTitle = title + caption.slice(0, 0)'
    return lines.join('\n')
  },
}

/* 变异 11：长公式不再缩放（内容又被裁在公式盒子里）。
   check-math-overflow 里"公式本体不越出正文列 / 盒子里没有被裁掉的内容"守的就是它。 */
const MUTATION_11 = {
  name: '长公式不再缩放（内容又被裁在公式盒子里）→ 预期**红**',
  expectCaught: true,
  target: 'mathNode',
  suite: 'scripts/check-math-overflow.mjs',
  apply: (t) => {
    const a = t.replace('let k = natural > budget', 'let k = false && natural > budget')
    const b = a.replace('const k = natural > budget', 'const k = false && natural > budget')
    return b === t ? null : b
  },
}

/* 变异 12：图片说明不写进 Markdown（title 槽位里只剩对齐）。
   check-image-align 里"存盘再打开：说明还在、还在图下面"那条守的就是它 —— 不写进去，
   刷新后说明就没了（用户看到的是"填了白填"）。注意**保留对齐**，只丢掉说明。 */
const MUTATION_12 = {
  name: '图片说明不写进 Markdown（刷新后说明丢失）→ 预期**红**',
  expectCaught: true,
  target: 'safeImage',
  suite: 'scripts/check-image-align.mjs',
  apply: (t) => {
    const lines = t.split('\n')
    const i = lines.findIndex((l) => l.includes('if (cap) return `${marker}|${cap}`'))
    if (i < 0) return null
    lines[i] = "  if (cap) return marker === '=' ? '' : marker"
    return lines.join('\n')
  },
}

const MUTATIONS = [
  MUTATION_1,
  MUTATION_2,
  MUTATION_3,
  MUTATION_4,
  MUTATION_5,
  MUTATION_6,
  MUTATION_7,
  MUTATION_8,
  MUTATION_9,
  MUTATION_10,
  MUTATION_11,
  MUTATION_12,
  {
    name: '对照：只改注释文字（不该影响行为）→ 预期**不红**',
    expectCaught: false,
    apply: (t) => t.replace(' * 公式保护：Markdown 解析器', ' * 公式保护（注释被改）：Markdown 解析器'),
  },
]

const results = []
for (const m of MUTATIONS) {
  /* ⚠️ 每次迭代开头先把**所有**目标文件恢复原状。
     不这么做的话变异会累积：变异 4 把 useMarkdownEditor 改坏之后没恢复，
     下一个"对照"变异就在"已经坏了"的代码上跑，于是对照组也变红（实测踩到，
     表现是"对照应全绿却红了 59/67"，很容易误判成断言有问题）。 */
  for (const [key, path] of Object.entries(TARGETS)) writeFileSync(path, originals[key], 'utf8')

  const targetKey = m.target ?? DEFAULT_TARGET
  const targetPath = TARGETS[targetKey]
  const original = originals[targetKey]
  if (!targetPath || !original) {
    console.log(`\n=== 变异：${m.name} ===\n  ❌ target "${targetKey}" 不存在，这一条**无法判定**`)
    results.push({ name: m.name, applied: false, asExpected: false })
    continue
  }
  const mutated = m.apply(original)
  if (!mutated || mutated === original) {
    console.log(`\n=== 变异：${m.name} ===\n  ❌ 变异没能应用（没匹配上），这一条**无法判定**`)
    results.push({ name: m.name, applied: false, asExpected: false })
    continue
  }
  writeFileSync(targetPath, mutated, 'utf8')

  /* 关键：先确认构建真的成功，否则会拿旧产物跑出假绿 */
  const build = run('pnpm', ['build:pure'])
  const buildOk = /已生成可直接双击的文件/.test(build) && !/error TS|Build failed/i.test(build)
  if (!buildOk) {
    console.log(`\n=== 变异：${m.name} ===\n  ❌ 变异后**构建失败** —— 无法判定，不是"没抓住"`)
    console.log('     ' + build.split('\n').filter((l) => /error|Error/.test(l)).slice(0, 2).join(' | '))
    writeFileSync(targetPath, original, 'utf8')
    results.push({ name: m.name, applied: true, buildOk: false, asExpected: false })
    continue
  }

  const suite = m.suite ?? SUITE
  const out = run('node', [suite])
  const failed = /❌/.test(out)
  const failedNames = [...out.matchAll(/^❌\s+(.+?)\s+—/gm)].map((x) => x[1].slice(0, 46))
  const summary = (out.match(/(\d+)\/(\d+) 条断言通过/) || [])[0] ?? '(没跑到汇总)'
  const asExpected = failed === m.expectCaught
  console.log(`\n=== 变异：${m.name} ===`)
  console.log(`  跑的套件：${suite}`)
  console.log(
    `  结果：${failed ? '套件变红' : '套件仍全绿'}  预期：${m.expectCaught ? '应红' : '应不红'}  → ${asExpected ? '✅ 符合预期' : '⚠️ 与预期不符'}`,
  )
  console.log(`  ${summary}`)
  if (failedNames.length) console.log(`  红了哪些：${failedNames.slice(0, 4).join('、')}${failedNames.length > 4 ? ` …共 ${failedNames.length} 条` : ''}`)
  results.push({ name: m.name, applied: true, buildOk: true, caught: failed, asExpected, summary, failedNames })
}

/* 恢复所有目标文件 */
for (const [key, path] of Object.entries(TARGETS)) {
  writeFileSync(path, originals[key], 'utf8')
}
run('pnpm', ['build:pure'])
const check = run('node', [SUITE])
const restoredSummary = (check.match(/(\d+)\/(\d+) 条断言通过/) || [])[0] ?? '(没跑到汇总)'
const checkPerf = run('node', ['scripts/check-typing-performance.mjs'])
const restoredPerf = (checkPerf.match(/(\d+)\/(\d+) 条断言通过/) || [])[0] ?? '(没跑到汇总)'
console.log(`\n=== 已恢复原文件 ===\n  恢复后套件：${restoredSummary}\n  恢复后打字性能套件：${restoredPerf}`)
if (/❌/.test(check) || /❌/.test(checkPerf)) console.log('  ⚠️ 恢复后套件竟然是红的 —— 说明变异没清理干净，请检查！')

const missed = results.filter((r) => !r.asExpected)
console.log(
  `\n${
    missed.length
      ? `⚠️ ${missed.length} 条变异与预期不符（或无法判定）：\n   ` +
        missed.map((m) => `${m.name}${m.applied === false ? '（变异没应用）' : m.buildOk === false ? '（构建失败）' : ''}`).join('\n   ')
      : '✅ 每一处变异的表现都符合预期（该红的红了、该被兜住的不红）'
  }`,
)
console.log('  （脚本自己校验"变异是否真的应用 + 构建是否成功"，避免拿旧产物跑出假绿）')
process.exit(missed.length ? 1 : 0)
