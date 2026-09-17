/**
 * 组件覆盖表：src/ 下每个源文件，到底被哪些检查脚本碰到过？
 *
 * 用途：回答"是不是每个组件都体检过了"。它不判对错，只把**没人碰过的**列出来
 * ——那些就是下一轮该补测试的地方（本轮就是这么发现 CodeBlockView 缺覆盖的）。
 *
 * 两种覆盖方式都算：
 *   · UI 组件：脚本里会出现它的类名 / 按钮文字（比如 `zh-tablemenu__btn`）
 *   · 行为模块（存储层、导出、快捷键…）：脚本里出现它留下的**可观测痕迹**
 *     （`__DOCSTORE__`、`md-editor-theme-v1`、`zh-dim-color`、`zh-typomenu`…）
 *
 * 用法：node scripts/coverage-report.mjs
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

/** 递归列出 src 下所有源文件 */
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.(ts|tsx)$/.test(name)) out.push(full)
  }
  return out
}

const srcFiles = walk(resolve('src'))
const scriptFiles = readdirSync(resolve('scripts'))
  .filter((f) => /\.mjs$/.test(f))
  .map((f) => resolve('scripts', f))
const scriptText = scriptFiles.map((f) => ({ f, t: readFileSync(f, 'utf-8') }))

/** 每个源文件"被脚本观测到的痕迹"。空数组 = 只能靠脚本里写文件名来匹配 */
const MARKERS = {
  'App.tsx': ['.ProseMirror'],
  'main.tsx': ['#root', '.ProseMirror'],
  'editor/CodeBlockView.tsx': ['zh-codeblock__lang', 'zh-codeblock__menu'],
  'editor/ColorField.tsx': ['zh-cf__bar', 'zh-cf__hex'],
  'editor/DocMenu.tsx': ['zh-docmenu__new', 'zh-docmenu__open'],
  'editor/EffectPanel.tsx': ['zh-fx__mode', 'zh-fx__preset'],
  'editor/HelpModal.tsx': ['zh-modal--help', 'zh-help'],
  'editor/LinkModal.tsx': ['zh-link-form'],
  'editor/MathModal.tsx': ['zh-modal--math', 'zh-mathsource', 'zh-autocomplete__item', 'zh-symbol'],
  'editor/SaveMenu.tsx': ['zh-menu--save', 'zh-menu__item--tall'],
  'editor/ShortcutModal.tsx': ['自定义快捷键', 'zh-sckey'],
  'editor/StatusBar.tsx': ['zh-statusbar__count', 'zh-switch__state'],
  'editor/TableMenu.tsx': ['zh-tablemenu__btn', 'zh-tablemenu__size'],
  'editor/TableModal.tsx': ['zh-modal-mask'],
  'editor/Toolbar.tsx': ['zh-toolbar', 'zh-btn'],
  'editor/TypographyMenu.tsx': ['zh-typomenu'],
  'editor/VideoModal.tsx': ['video-node', 'iframe'],
  'editor/ZhihuEditor.tsx': ['__EDITOR__', '__MD__'],
  'editor/ZhihuModal.tsx': ['存到草稿箱', 'x-dadealbit-token'],
  'editor/icons.tsx': ['IconTheme', 'IconSpark'],
  'editor/tiptap/MathNode.tsx': ['math-node', 'katex'],
  'editor/tiptap/SafeImage.ts': ['data:image/png;base64'],
  'editor/tiptap/VideoNode.tsx': ['video-node', 'iframe'],
  'editor/tiptap/TextColor.ts': ['zh-dim-color', 'color: rgb'],
  'editor/tiptap/mathMarkdown.ts': ['formula-import', '\\frac'],
  'editor/tiptap/tableMarkdown.ts': ['zhihu-export', '| --- |'],
  'editor/effects/mouseSpark.ts': ['sparkCanvas'],
  'editor/effects/mouseEffect.ts': ['md-editor-mouse-effect'],
  'editor/effects/customCursor.ts': ['fx-cursor', '自定义鼠标指针'],
  'editor/codeLanguages.ts': ['zh-codeblock__lang', 'javascript'],
  'editor/types.ts': ['__EDITOR__'],
  'editor/customFonts.ts': ['zh-typecustom', '字体'],
  'editor/docStore.ts': ['__DOCSTORE__', 'indexedDB'],
  'editor/documents.ts': ['__DOCSTORE__', 'md-editor-docs-v1'],
  'editor/editorActions.ts': ['window.alert', 'getImageData'],
  'editor/imageBed.ts': ['jsdelivr', 'x-dadealbit-token'],
  'editor/math/latexRepair.ts': ['一键修复公式', 'fixMath'],
  'editor/math/latexSuggest.ts': ['zh-autocomplete__cmd', '补全'],
  'editor/math/rawMathText.ts': ['hardbreak', '行内公式'],
  'editor/math/symbolData.ts': ['zh-mathcat', 'zh-symbol'],
  'editor/mathEvents.ts': ['zh-modal--math'],
  'editor/readableColors.ts': ['zh-dim-color'],
  'editor/saveFormats.ts': ['zhihu-export', '存到草稿箱'],
  'editor/shortcuts.ts': ['md-editor-shortcuts', 'zh-sckey'],
  'editor/theme.ts': ['md-editor-theme-v1', 'data-theme'],
  'editor/typography.ts': ['md-editor-typography', 'zh-typomenu'],
  'editor/useDimColorFix.ts': ['zh-dim-color'],
  'editor/useEscapeClose.ts': ['Escape'],
  'editor/useMarkdownEditor.ts': ['zh-codeblock', 'markdownInput'],
  'editor/zhihuMarkdown.ts': ['zhihu-export', '知乎'],
  'editor/zhihuImages.ts': ['本地路径', '图片导入失败'],
  'editor/codeLanguages.ts': ['zh-codeblock__lang', 'javascript'],
  'editor/types.ts': ['__EDITOR__'],
  // 纯净版空壳：它们"什么都不做"正是被测的东西 —— 由纯净版产物检查兜（纯净版里没有画布/面板）
  'editor/EffectPanel.pure.tsx': ['纯净版', '__NO_MOUSE_EFFECT__'],
  'editor/effects/mouseEffect.pure.ts': ['纯净版', 'md-editor-mouse-effect'],
  'editor/effects/mouseSpark.pure.ts': ['纯净版', 'sparkCanvas'],
}

const rows = []
for (const file of srcFiles) {
  const rel = relative(resolve('src'), file).replace(/\\/g, '/')
  const markers = MARKERS[rel] ?? []
  const hits = new Set()
  for (const { f, t } of scriptText) {
    const name = relative(resolve('scripts'), f)
    const byName = t.includes(rel) || t.includes(rel.replace(/\.tsx?$/, ''))
    const byMarker = markers.length > 0 && markers.some((m) => t.includes(m))
    if (byName || byMarker) hits.add(name)
  }
  rows.push({ rel, hits: [...hits].sort() })
}

const covered = rows.filter((r) => r.hits.length > 0)
const uncovered = rows.filter((r) => r.hits.length === 0)
const unmapped = rows.filter((r) => !MARKERS[r.rel])

console.log(`src/ 下一共 ${rows.length} 个源文件；被检查脚本碰到的 ${covered.length} 个\n`)
console.log('== 覆盖最多的（前 10）==')
for (const r of covered.sort((a, b) => b.hits.length - a.hits.length).slice(0, 10)) {
  console.log(`  ${r.rel.padEnd(36)} ${String(r.hits.length).padStart(2)} 个脚本  如 ${r.hits.slice(0, 3).join('、')}`)
}
console.log('\n== 没有任何脚本碰到的 ==')
if (!uncovered.length) console.log('  （无）')
for (const r of uncovered) console.log(`  ${r.rel}`)

/* 顺带看看产物里"两版都该有"的功能标记在不在 */
for (const [label, file] of [
  ['特效版', 'Dadealbit Markdown 编辑器-特效版.html'],
  ['纯净版', 'Dadealbit Markdown 编辑器.html'],
]) {
  try {
    const html = readFileSync(file, 'utf-8')
    const must = ['zh-codeblock', 'zh-switch', 'zh-outline', 'zh-docmenu', 'zh-typomenu', 'zh-tablemenu', 'md-editor-docs']
    const missing = must.filter((m) => !html.includes(m))
    console.log(`\n${label}产物里缺这些功能标记：${missing.length ? missing.join('、') : '（无，全在）'}`)
  } catch {
    /* 这个分支上没有这份产物，跳过 */
  }
}

console.log(`\n${uncovered.length === 0 ? '每个源文件都在某个检查脚本的射程内 ✅' : `还有 ${uncovered.length} 个没被覆盖 ⚠️`}`)

/* 守门：新加的源文件必须在上面登记"可观测痕迹"。
   为什么要这样：新写一个组件很容易忘了给它补检查，而"没被任何脚本碰到"是静默的 ——
   登记一次至少逼着人想一遍"这个东西怎么测"。 */
if (unmapped.length) {
  console.log(`\n❌ 这些源文件还没登记"可观测痕迹"（在 coverage-report.mjs 的 MARKERS 里补一行）：`)
  for (const r of unmapped) console.log(`   ${r.rel}`)
  process.exit(1)
}
console.log('新增文件都登记过可观测痕迹 ✅')
process.exit(0)

