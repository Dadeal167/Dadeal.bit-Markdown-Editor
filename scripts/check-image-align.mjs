/**
 * 图片对齐（每张图单独设：左 / 居中 / 居右）
 *
 * 为什么要有这一套：图片以前完全没法设对齐 —— 插进去就贴着左、宽度顶满正文列，
 * 学生拍的作业照片只能一直靠左。现在选中图片会浮出「图片位置」菜单。
 *
 * 这一套盯的是**最容易出鬼的三件事**（不是"菜单能不能点"）：
 *   1. 老文档零影响：没设对齐的图片，Markdown 必须**逐字节**保持老写法（`![alt](src)`）
 *   2. 对齐要能**存盘往返**：文档是以 Markdown 存的，写法必须能从 .md 里读回来
 *      （哨兵写在标准 Markdown 的 title 槽位里：`![alt](src "=c")`，见 SafeImage.ts）
 *   3. 哨兵不许吃掉真实标题；也不许改到**别的**图片上去（历史上"位置失效却照改"的坑）
 *
 * 断言读的是**文档模型 + 导出的 Markdown**，不看界面文字。
 */
import { chromium } from 'playwright-core'

/**
 * **本套件的断言总数** —— 文档里的数量占位符读的就是这个常量（见 check:docs-counts）。
 * 收尾处有自检：实际跑出来的断言数必须等于它。
 */
export const TEST_COUNT = 29

/* 测试图：用 canvas 现画两张**有真实尺寸**的图（400×300 / 240×180）。
   ⚠️ 别用 1×1 的假图：那样图片在页面上只有 1px，真实鼠标点过去会落到旁边的段落上，
   测出来的就不是"点图片"这条路了（踩过）。下面在页面就绪之后再生成。 */
let IMG = ''
let IMG2 = ''

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`${ok ? '✅' : '❌'}  ${name}${detail ? '  — ' + detail : ''}`)
}

const browser = await chromium.launch({ channel: 'msedge', headless: true })
const page = await browser.newPage({ viewport: { width: 1300, height: 900 } })
const errors = []
page.on('pageerror', (e) => errors.push(String(e).slice(0, 140)))
await page.goto('http://127.0.0.1:5173/', { waitUntil: 'load', timeout: 60000 })
await page.waitForSelector('.ProseMirror', { timeout: 30000 })
await page.waitForTimeout(1500)

/* 现画两张有真实尺寸的测试图（原因见上面注释） */
const made = await page.evaluate(() => {
  const mk = (w, h, color) => {
    const c = document.createElement('canvas')
    c.width = w
    c.height = h
    const g = c.getContext('2d')
    g.fillStyle = color
    g.fillRect(0, 0, w, h)
    g.fillStyle = '#fff'
    g.fillRect(12, 12, 80, 40)
    return c.toDataURL('image/png')
  }
  return { a: mk(400, 300, '#4a90d9'), b: mk(240, 180, '#d9534f') }
})
IMG = made.a
IMG2 = made.b

/** 文档里的图片节点（按出现顺序） + 导出的 Markdown */
const state = () =>
  page.evaluate(() => {
    const ed = window.__EDITOR__
    const imgs = []
    ed.state.doc.descendants((n) => {
      if (n.type.name === 'image') {
        imgs.push({ alt: n.attrs.alt, title: n.attrs.title, align: n.attrs.align })
      }
      return true
    })
    const dom = [...document.querySelectorAll('.zh-prose img')].map((el) => ({
      style: el.getAttribute('style'),
      dataAlign: el.getAttribute('data-align'),
      title: el.getAttribute('title'),
    }))
    return { imgs, dom, md: window.__MD__(), menu: !!document.querySelector('.zh-imgmenu') }
  })

const setMd = async (md) => {
  await page.evaluate((m) => window.__SET_MARKDOWN__(window.__EDITOR__, m), md)
  await page.waitForTimeout(800)
}
/**
 * 点第 i 张图片。
 *
 * ⚠️ 必须用**真实坐标**点（page.mouse），不能 `el.click()` ——
 * 合成 click 的 clientX/clientY 是 (0,0)，而 ProseMirror 是**按坐标**找"点到哪个节点"的，
 * 于是不管点第几张，选中的永远是页面左上角那张（实测：两张图时点第二张，居中的却是第一张）。
 */
const clickImage = async (i = 0) => {
  const box = await page.locator('.zh-prose img').nth(i).boundingBox()
  if (!box) throw new Error(`第 ${i} 张图片没有布局盒子`)
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  await page.waitForTimeout(400)
}
const clickMenu = async (label) => {
  await page.locator('.zh-imgmenu__btn', { hasText: label }).click()
  await page.waitForTimeout(400)
}

/* ---------- 1. 老文档零影响 ---------- */
await setMd(`看图：\n\n![作业](${IMG})\n`)
const s1 = await state()
check('老文档：图片对齐默认是「左」', s1.imgs[0]?.align === 'left', JSON.stringify(s1.imgs[0]))
check(
  '老文档：Markdown 逐字节保持老写法（不写任何哨兵、不加任何属性）',
  s1.md.endsWith(`![作业](${IMG})`) && !s1.md.includes('"='),
  JSON.stringify(s1.md.slice(-40)),
)
check('老文档：DOM 上不产生多余属性（老导出/老截图不变）', s1.dom[0]?.style == null && s1.dom[0]?.dataAlign == null, JSON.stringify(s1.dom[0]))

/* ---------- 2. 选中图片 → 菜单 ---------- */
await clickImage(0)
const s2 = await state()
check('点一下图片就浮出「图片位置」菜单', s2.menu, `menu=${s2.menu}`)

/* ---------- 3. 居中 ---------- */
await clickMenu('居中')
const s3 = await state()
check('点「居中」→ 图片节点的 align 变成 center', s3.imgs[0]?.align === 'center', JSON.stringify(s3.imgs[0]))
check(
  '居中的写法是标准 Markdown 的 title 槽位（`"=c"`），没有引入新语法',
  s3.md.includes(`![作业](${IMG} "=c")`),
  JSON.stringify(s3.md.slice(-24)),
)
check(
  '编辑器里当场就是居中的（导出的 HTML / PDF 走同一个 renderHTML）',
  /margin-left:\s*auto/.test(s3.dom[0]?.style ?? '') && s3.dom[0]?.dataAlign === 'center',
  JSON.stringify(s3.dom[0]),
)

/* ---------- 4. 存盘往返（文档是存成 Markdown 的，这一步才是关键） ---------- */
await setMd(s3.md)
const s4 = await state()
check('存盘再打开：居中还在（对齐信息真的能从 .md 读回来）', s4.imgs[0]?.align === 'center', JSON.stringify(s4.imgs[0]))
check('重新打开后 DOM 上也是居中的', /margin-left:\s*auto/.test(s4.dom[0]?.style ?? ''), JSON.stringify(s4.dom[0]))

/* ---------- 5. 居右、切回左 ---------- */
await clickImage(0)
await clickMenu('居右')
const s5 = await state()
check('点「居右」→ `"=r"` + 右对齐样式', s5.imgs[0]?.align === 'right' && s5.md.includes('"=r"') && /margin-left:\s*auto/.test(s5.dom[0]?.style ?? ''), JSON.stringify({ align: s5.imgs[0]?.align, style: s5.dom[0]?.style }))
await clickImage(0)
await clickMenu('左')
const s6 = await state()
check(
  '切回「左」→ Markdown 回到最朴素的老写法（不留哨兵、不留属性）',
  s6.imgs[0]?.align === 'left' && s6.md.endsWith(`![作业](${IMG})`) && s6.dom[0]?.style == null,
  JSON.stringify({ md: s6.md.slice(-24), style: s6.dom[0]?.style }),
)

/* ---------- 6. 真实标题不许被哨兵吃掉 ---------- */
await setMd(`![作业](${IMG} "我的照片")\n`)
await clickImage(0)
await clickMenu('居中')
const s7 = await state()
await setMd(s7.md)
const s7b = await state()
check(
  '有真实标题时居中：哨兵写在前、标题原样跟在后面',
  s7.imgs[0]?.title === '我的照片' && s7.md.includes('"=c 我的照片"'),
  JSON.stringify(s7.md.slice(-18)),
)
check(
  '往返后标题还是「我的照片」、对齐还是居中（两个都没丢）',
  s7b.imgs[0]?.title === '我的照片' && s7b.imgs[0]?.align === 'center' && s7b.dom[0]?.title === '我的照片',
  JSON.stringify({ img: s7b.imgs[0], domTitle: s7b.dom[0]?.title }),
)

/* ---------- 7. 只改选中的那一张 + 知乎导出仍认得出图片 ---------- */
await setMd(`![一](${IMG})\n\n![二](${IMG2})\n`)
await clickImage(1)
await clickMenu('居中')
const s8 = await state()
check(
  '两张图时只改选中的那一张（另一张保持原样）',
  s8.imgs[0]?.align === 'left' && s8.imgs[1]?.align === 'center',
  JSON.stringify(s8.imgs),
)
/* 知乎导出是按文本扫 `![alt](url …)` 的：哨兵不能让它漏掉这张图（否则导出会丢图） */
const zhihuSees = [...s8.md.matchAll(/!\[[^\]]*\]\(([^)\s]+)/g)].map((m) => m[1].slice(0, 22))
check(
  '带哨兵的图片在知乎导出那条路上仍然是"图片"（扫得到 src，不会漏图）',
  zhihuSees.length === 2 && zhihuSees[1] === IMG2.slice(0, 22),
  JSON.stringify(zhihuSees),
)

check('全程没有页面错误', errors.length === 0, errors.slice(0, 2).join(' | '))

/* ---------- 8. 图片说明（图下面那行居中的字） ----------
   用户："加一个能给图片加说明文字的功能，说明的文字就放在图片下面居中"。 */
const captionOf = () =>
  page.evaluate(() => {
    const ed = window.__EDITOR__
    let attrs = null
    ed.state.doc.descendants((n) => {
      if (n.type.name === 'image' && !attrs) attrs = { caption: n.attrs.caption, align: n.attrs.align }
      return true
    })
    const cap = document.querySelector('.zh-prose figcaption.zh-caption')
    const fig = document.querySelector('.zh-prose figure')
    return {
      attrs,
      md: window.__MD__(),
      html: ed.getHTML(),
      hasFigure: !!fig,
      figAlign: fig ? fig.getAttribute('data-align') : null,
      capText: cap ? cap.textContent : null,
      capCenter: cap ? getComputedStyle(cap).textAlign === 'center' : false,
      input: document.querySelector('.zh-imgmenu__input') !== null,
    }
  })

await setMd(`看图：\n\n![作业](${IMG})\n`)
await clickImage(0)
const c0 = await captionOf()
check('点图片后的菜单里有「说明」输入框', c0.input, `input=${c0.input}`)

/* ⚠️ 这一组必须用**真鼠标 + 真键盘**。
   用 `fill()` 直接赋值会绕过焦点与逐字输入，于是漏掉过两个真 bug：
     ① 菜单容器上的 mousedown 统一 preventDefault → 点输入框拿不到焦点（用户："没法改"）
     ② 加说明会把图片 DOM 从 <img> 换成 <figure><img>…，节点 DOM 重建后
        "存下来的那个 img 已脱离文档" → 菜单以为图没了就自己关掉（只进第一个字） */
const ibox = await page.locator('.zh-imgmenu__input').boundingBox()
await page.mouse.click(ibox.x + 20, ibox.y + ibox.height / 2)
const focused = await page.evaluate(
  () => document.activeElement?.classList?.contains('zh-imgmenu__input') ?? false,
)
check('鼠标点进「说明」输入框能拿到焦点（没被菜单的 mousedown 挡掉）', focused, `focused=${focused}`)

await page.keyboard.type('甲乙丙', { delay: 30 })
await page.waitForTimeout(500)
const typed = await captionOf()
check(
  '真键盘逐字输入：三个字都进了文档（不是只进第一个字菜单就关）',
  typed.attrs?.caption === '甲乙丙' && typed.capText === '甲乙丙',
  JSON.stringify({ caption: typed.attrs?.caption, 图上文字: typed.capText, 菜单还在: typed.input }),
)

await page.keyboard.press('Backspace')
await page.waitForTimeout(400)
const edited = await captionOf()
check(
  '还能接着退格改（说明可以反复编辑）',
  edited.attrs?.caption === '甲乙' && edited.capText === '甲乙',
  JSON.stringify({ caption: edited.attrs?.caption, 图上文字: edited.capText }),
)

await page.locator('.zh-imgmenu__input').fill('图 1：二次函数的图像')
await page.waitForTimeout(600)
const c1 = await captionOf()
check('填了说明：节点上就有 caption（不是正文里多一段字）', c1.attrs?.caption === '图 1：二次函数的图像', JSON.stringify(c1.attrs))
check(
  '说明显示在图下面（figure + figcaption 结构）',
  c1.hasFigure && c1.capText === '图 1：二次函数的图像',
  `figure=${c1.hasFigure} 文字=${JSON.stringify(c1.capText)}`,
)
check('说明是**居中**的', c1.capCenter, `text-align:center=${c1.capCenter}`)
check(
  '说明写进标准 Markdown 的 title 槽位（`"=|说明"`），没有引入新语法',
  c1.md.includes('"=|图 1：二次函数的图像"'),
  JSON.stringify(c1.md.slice(-30)),
)

await setMd(c1.md)
const c2 = await captionOf()
check(
  '存盘再打开：说明还在、还在图下面',
  c2.attrs?.caption === '图 1：二次函数的图像' && c2.capText === '图 1：二次函数的图像' && c2.hasFigure,
  JSON.stringify({ attrs: c2.attrs, text: c2.capText }),
)

await clickImage(0)
await page.locator('.zh-imgmenu__btn', { hasText: '居中' }).click()
await page.waitForTimeout(500)
const c3 = await captionOf()
await setMd(c3.md)
const c3b = await captionOf()
check(
  '说明 + 居中 一起用：写法是 `"=c|说明"`，往返后两个都不丢',
  c3.md.includes('"=c|图 1：二次函数的图像"') &&
    c3b.attrs?.align === 'center' &&
    c3b.attrs?.caption === '图 1：二次函数的图像' &&
    c3b.figAlign === 'center',
  JSON.stringify({ md: c3.md.slice(-34), again: c3b.attrs, figAlign: c3b.figAlign }),
)

await clickImage(0)
await page.locator('.zh-imgmenu__input').fill('她说的"重点"在这里')
await page.waitForTimeout(500)
const c4 = await captionOf()
await setMd(c4.md)
const c4b = await captionOf()
check(
  '说明里带引号也不会写坏（转义能往返）',
  c4b.attrs?.caption === '她说的"重点"在这里',
  JSON.stringify({ md: c4.md.slice(-34), again: c4b.attrs?.caption }),
)

check(
  '导出的 HTML 里带 figcaption（导出 / PDF 也显示说明）',
  c4.html.includes('<figcaption') && c4.html.includes('重点'),
  JSON.stringify(c4.html.slice(0, 120)),
)

await clickImage(0)
await page.locator('.zh-imgmenu__btn', { hasText: '✕' }).click()
await page.waitForTimeout(500)
const c5 = await captionOf()
check(
  '清空说明 → 图回到最朴素的老写法（figure 消失，对齐保留）',
  c5.attrs?.caption === '' && !c5.hasFigure && c5.md.includes('"=c"'),
  JSON.stringify({ attrs: c5.attrs, hasFigure: c5.hasFigure, md: c5.md.slice(-16) }),
)

await browser.close()

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} 条断言通过`)
if (results.length !== TEST_COUNT) {
  console.log(`❌ 断言条数与 TEST_COUNT(${TEST_COUNT}) 不一致：实际 ${results.length} 条`)
  process.exit(1)
}
process.exit(failed.length ? 1 : 0)
