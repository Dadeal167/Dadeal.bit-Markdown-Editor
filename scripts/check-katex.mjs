/**
 * KaTeX 兼容性体检：latexLive 的颜色/字体/字号/环境命令，哪些能真正渲染出来
 */
import katex from 'katex'

const cases = [
  ['颜色 color', '\\color{red}{x}'],
  ['颜色 textcolor', '\\textcolor{blue}{x}'],
  ['颜色 十六进制', '\\color{#ff8800}{x}'],
  ['字体 Roman', '\\mathrm{ABC}'],
  ['字体 Boldface', '\\mathbf{ABC}'],
  ['字体 Italics', '\\mathit{ABC}'],
  ['字体 Underline', '\\underline{ABC}'],
  ['字体 Sansserif', '\\mathsf{ABC}'],
  ['字体 Blackboard', '\\mathbb{ABC}'],
  ['字体 Calligraphy', '\\mathcal{ABC}'],
  ['字体 Fraktur', '\\mathfrak{ABC}'],
  ['字号 tiny', '\\tiny{abc}'],
  ['字号 scriptsize', '\\scriptsize{abc}'],
  ['字号 small', '\\small{abc}'],
  ['字号 normalsize', '\\normalsize{abc}'],
  ['字号 large', '\\large{abc}'],
  ['字号 Large', '\\Large{abc}'],
  ['字号 LARGE', '\\LARGE{abc}'],
  ['字号 huge', '\\huge{abc}'],
  ['字号 Huge', '\\Huge{abc}'],
  ['字号 displaystyle', '\\displaystyle x'],
  ['环境 none', 'x=1'],
  ['环境 eqnarray', '\\begin{eqnarray}a&=&b\\end{eqnarray}'],
  ['环境 align', '\\begin{align}a&=b\\end{align}'],
  ['环境 aligned', '\\begin{aligned}a&=b\\end{aligned}'],
  ['环境 gathered', '\\begin{gathered}a=b\\end{gathered}'],
  ['环境 split', '\\begin{split}a&=b\\end{split}'],
  ['环境 cases', '\\begin{cases}x,&a>0\\end{cases}'],
  ['环境 array', '\\begin{array}{cc}a&b\\end{array}'],
  ['环境 matrix', '\\begin{matrix}a&b\\end{matrix}'],
  ['环境 pmatrix', '\\begin{pmatrix}a&b\\end{pmatrix}'],
  ['环境 bmatrix', '\\begin{bmatrix}a&b\\end{bmatrix}'],
  ['环境 vmatrix', '\\begin{vmatrix}a&b\\end{vmatrix}'],
  ['环境 Bmatrix', '\\begin{Bmatrix}a&b\\end{Bmatrix}'],
  ['环境 Vmatrix', '\\begin{Vmatrix}a&b\\end{Vmatrix}'],
  ['环境 smallmatrix', '\\begin{smallmatrix}a&b\\end{smallmatrix}'],
  ['环境 multline', '\\begin{multline}a=b\\end{multline}'],
]

const results = []
for (const [name, tex] of cases) {
  let ok = true
  let html = ''
  try {
    html = katex.renderToString(tex, { throwOnError: false, displayMode: false })
    ok = !html.includes('katex-error')
  } catch (e) {
    ok = false
    html = String(e).slice(0, 60)
  }
  results.push({ name, ok })
  console.log(`${ok ? '✅' : '❌'}  ${name}`)
}
const bad = results.filter((r) => !r.ok)
console.log(`\n${results.length - bad.length}/${results.length} 可用`)
if (bad.length) console.log('不可用：' + bad.map((b) => b.name).join('、'))
