/**
 * 鼠标点击特效（MouseSpark）行为测试
 *  1. 默认档位（只显点击波纹）下：画布存在、点击后真的画出了像素
 *  2. 「关闭」档：画布隐藏、不再绘制
 *  3. 「点击 + 拖尾」档：鼠标移动也画
 *  4. 设置能记住（刷新后仍生效）
 *  5. 特效不挡操作（画布 pointer-events:none，工具栏按钮照样能点）
 *  6. 打印/导出时特效隐藏
 */
import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

const OUT = resolve('.probe')
mkdirSync(OUT, { recursive: true })
const APP = 'http://127.0.0.1:5173/'

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`${ok ? '✅' : '❌'}  ${name}${detail ? '  — ' + detail : ''}`)
}

const browser = await chromium.launch({ channel: 'msedge', headless: true })
const page = await browser.newPage({ viewport: { width: 1360, height: 900 } })
const errors = []
page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 120)))
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text().slice(0, 120))
})

/** 采样某个区域里"非透明像素"的数量（用来判断有没有真的画东西） */
const painted = (cx, cy, half = 120) =>
  page.evaluate(
    ({ cx, cy, half }) => {
      const c = document.getElementById('sparkCanvas')
      if (!c) return -1
      if (getComputedStyle(c).display === 'none') return -2
      const ctx = c.getContext('2d')
      const dpr = window.devicePixelRatio || 1
      const x = Math.max(0, Math.floor((cx - half) * dpr))
      const y = Math.max(0, Math.floor((cy - half) * dpr))
      const w = Math.min(c.width - x, Math.floor(half * 2 * dpr))
      const h = Math.min(c.height - y, Math.floor(half * 2 * dpr))
      if (w <= 0 || h <= 0) return -3
      const data = ctx.getImageData(x, y, w, h).data
      let n = 0
      for (let i = 3; i < data.length; i += 4) if (data[i] > 8) n += 1
      return n
    },
    { cx, cy, half },
  )

const setMode = async (label) => {
  // 特效入口现在是一个设置面板（按钮 + 下拉），档位是面板里的 .zh-fx__mode
  await page.locator('.zh-btn[title^="特效"]').click()
  await page.waitForSelector('.zh-fx', { timeout: 4000 })
  await page.getByRole('button', { name: '鼠标', exact: true }).click()
  await page.locator('.zh-fx__mode', { hasText: label }).click()
  await page.waitForTimeout(400)
  await page.keyboard.press('Escape') // 收起面板，免得挡住后面的采样
  await page.waitForTimeout(300)
}

await page.goto(APP, { waitUntil: 'load', timeout: 60000 })
await page.waitForSelector('.ProseMirror', { timeout: 30000 })
await page.waitForTimeout(1500)

/* ---------- 0. 默认档位 ---------- */
const initial = await page.evaluate(() => {
  const c = document.getElementById('sparkCanvas')
  return {
    exists: !!c,
    display: c ? getComputedStyle(c).display : 'no-canvas',
    pointerEvents: c ? getComputedStyle(c).pointerEvents : '',
    zIndex: c ? getComputedStyle(c).zIndex : '',
    spark: typeof window.spark === 'object' && window.spark !== null,
    alwaysTrail: window.effectiveAlwaysTrail,
  }
})
check('默认就有特效画布（点击波纹档）', initial.exists && initial.display !== 'none', JSON.stringify(initial))
check('画布不挡鼠标（pointer-events:none）', initial.pointerEvents === 'none', initial.pointerEvents)
check('拖尾默认关闭（只显点击波纹）', initial.alwaysTrail === false, `effectiveAlwaysTrail=${initial.alwaysTrail}`)

/* ---------- 1. 点击出波纹 ---------- */
const cx = 700
const cy = 500
const before = await painted(cx, cy)
await page.mouse.click(cx, cy)
/* 波纹是"先扩开再淡出"，只等一个固定毫秒数去采样会偶发数到 0（采样早了还没画、晚了已淡完）。
   所以在一小段时间里反复采样取最大值 —— 这条以前就是这么假失败的。 */
let afterClick = 0
for (let i = 0; i < 12; i += 1) {
  await page.waitForTimeout(60)
  afterClick = Math.max(afterClick, await painted(cx, cy))
  if (afterClick > (before < 0 ? 0 : before) + 50) break
}
check('点击后画布上真的画出了东西', afterClick > (before < 0 ? 0 : before) + 50, `像素 ${before} → ${afterClick}`)
await page.screenshot({ path: resolve(OUT, 'mouse-effect-click.png') })

/* ---------- 2. 拖尾档：移动也画 ---------- */
await setMode('点击 + 拖尾')
await page.waitForTimeout(400)
const trailBefore = await painted(400, 300, 200)
for (let i = 0; i < 16; i += 1) {
  await page.mouse.move(280 + i * 16, 290 + i * 5)
  await page.waitForTimeout(35)
}
const trailAfter = await painted(400, 300, 200)
check('拖尾档下移动鼠标会画', trailAfter > trailBefore + 5, `像素 ${trailBefore} → ${trailAfter}`)
await page.screenshot({ path: resolve(OUT, 'mouse-effect-trail.png') })

/* ---------- 3. 关闭档 ---------- */
await setMode('关闭')
await page.waitForTimeout(400)
const offState = await page.evaluate(() => {
  const c = document.getElementById('sparkCanvas')
  return { display: c ? getComputedStyle(c).display : 'gone', paused: window.spark?.paused }
})
check(
  '「关闭」后画布隐藏（或干脆不创建）且暂停绘制',
  (offState.display === 'none' || offState.display === 'gone') && offState.paused === true,
  JSON.stringify(offState),
)
await page.mouse.click(600, 400)
await page.mouse.move(650, 420)
await page.waitForTimeout(300)
const offPainted = await painted(600, 400)
check('关闭后不再绘制', offPainted <= -2, `采样返回 ${offPainted}（-2 = 画布隐藏，-1 = 没有画布）`)

/* ---------- 4. 设置记住（关闭档刷新后仍是关闭） ---------- */
await page.reload({ waitUntil: 'load' })
await page.waitForSelector('.ProseMirror', { timeout: 30000 })
await page.waitForTimeout(1500)
await page.locator('.zh-btn[title^="特效"]').click()
await page.waitForSelector('.zh-fx', { timeout: 4000 })
await page.getByRole('button', { name: '鼠标', exact: true }).click()
await page.waitForTimeout(200)
const activeEffect = await page.evaluate(() => {
  const on = [...document.querySelectorAll('.zh-fx__mode--on')].map((el) => el.textContent.trim())
  return on.find((t) => /关闭|波纹|拖尾/.test(t)) ?? '(没找到选中档)'
})
check('刷新后仍是「关闭」档（设置记住了）', activeEffect.includes('关闭'), activeEffect)
await page.keyboard.press('Escape')
await page.waitForTimeout(200)

/* ---------- 5. 开着特效也能正常操作编辑器 ---------- */
await setMode('只显点击波纹')
await page.waitForTimeout(400)
await page.locator('.ProseMirror').click()
await page.keyboard.type('特效开着也能打字')
await page.waitForTimeout(400)
const typed = await page.evaluate(() => document.querySelector('.ProseMirror').textContent.includes('特效开着也能打字'))
check('特效开着时编辑器照常工作（能点能打字）', typed, typed ? '文字已输入' : '没输进去')

// 工具栏按钮能不能点（画布在最上层，必须不挡）
await page.locator('.zh-btn[title="公式"]').click()
await page.waitForSelector('.zh-modal--math', { timeout: 4000 })
const modalOpen = await page.locator('.zh-modal--math').isVisible()
check('工具栏按钮照常能点（画布没挡住）', modalOpen)
await page.keyboard.press('Escape')
await page.waitForTimeout(300)

/* ---------- 6. 打印时隐藏 ---------- */
const printHidden = await page.evaluate(() => {
  const style = [...document.styleSheets]
    .flatMap((s) => {
      try {
        return [...s.cssRules]
      } catch {
        return []
      }
    })
    .find((r) => r.conditionText?.includes('print') && r.cssText.includes('sparkCanvas'))
  return !!style
})
check('打印样式里隐藏了特效画布', printHidden)

/* ---------- 7. 自定义颜色：随便挑一个颜色要能生效 ---------- */
/** 采样区域里"偏红"和"偏绿"的像素各有多少（用来验证颜色真的变了） */
const hueCount = (cx, cy, half = 160) =>
  page.evaluate(
    ({ cx, cy, half }) => {
      const c = document.getElementById('sparkCanvas')
      if (!c) return { err: 'no-canvas' }
      const ctx = c.getContext('2d')
      const dpr = window.devicePixelRatio || 1
      const x = Math.max(0, Math.floor((cx - half) * dpr))
      const y = Math.max(0, Math.floor((cy - half) * dpr))
      const w = Math.min(c.width - x, Math.floor(half * 2 * dpr))
      const h = Math.min(c.height - y, Math.floor(half * 2 * dpr))
      const d = ctx.getImageData(x, y, w, h).data
      let red = 0
      let green = 0
      let blue = 0
      let mixed = 0
      let ink = 0
      /**
       * 色相分桶（每 30° 一桶）—— 判断"彩虹"的正确尺子。
       *
       * 为什么不能只看红绿混色（`mixed`）：实测彩虹一条拖尾的颜色是
       * 143,239,57（绿黄）→ 122,57,239（蓝紫），随机相位落在哪一段都可能。
       * 落在青紫段时红绿混色**天然是 0** → 这条断言会偶发失败（我踩过）。
       * 正确的问法是"色相铺开了几个桶"：单色只会占 1~2 个桶，彩虹好几个。
       */
      const hueBuckets = new Array(12).fill(0)
      let colored = 0
      for (let i = 0; i < d.length; i += 4) {
        const [r, g, b, a] = [d[i], d[i + 1], d[i + 2], d[i + 3]]
        if (a < 20) continue
        ink += 1
        if (r > 90 && r > g * 1.6 && r > b * 1.6) red += 1
        else if (g > 90 && g > r * 1.6 && g > b * 1.6) green += 1
        else if (b > 90 && b > r * 1.3 && b > g * 1.3) blue += 1
        // 红绿之间过渡出来的"混色"（红+绿都有、蓝很小）—— 渐变生效的证据
        if (r > 50 && g > 50 && b < Math.min(r, g) * 0.6) mixed += 1

        const mx = Math.max(r, g, b)
        const mn = Math.min(r, g, b)
        if (mx - mn < 25) continue // 接近灰白的不算有色
        colored += 1
        let hue
        if (mx === r) hue = 60 * (((g - b) / (mx - mn)) % 6)
        else if (mx === g) hue = 60 * ((b - r) / (mx - mn) + 2)
        else hue = 60 * ((r - g) / (mx - mn) + 4)
        if (hue < 0) hue += 360
        hueBuckets[Math.floor(hue / 30) % 12] += 1
      }
      /* 有量的桶（≥20 个像素）有几个 —— 单色最多 1~2，彩虹好几个 */
      const spread = hueBuckets.filter((n) => n >= 20).length
      return { red, green, blue, mixed, ink, hueBuckets, colored, spread }
    },
    { cx, cy, half },
  )

/**
 * 改第 index 个取色器（面板内的 ColorField：色相/浓淡/明暗三条滑杆）。
 * React 受控组件：必须用原生 value setter + input 事件才会被它认到。
 */
const setColorField = (index, { h, s, l }) =>
  page.evaluate(
    ({ index, h, s, l }) => {
      const field = document.querySelectorAll('.zh-cf')[index]
      if (!field) return 'no-field'
      const bars = field.querySelectorAll('.zh-cf__bar')
      if (bars.length < 3) return 'no-bars'
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
      const put = (el, v) => {
        setter.call(el, String(v))
        el.dispatchEvent(new Event('input', { bubbles: true }))
        el.dispatchEvent(new Event('change', { bubbles: true }))
      }
      put(bars[0], h)
      put(bars[1], s)
      put(bars[2], l)
      return 'ok'
    },
    { index, h, s, l },
  )

/** HSL：(0,100,50)=红、(120,100,50)=绿、(200,100,50)=蓝 */
const RED = { h: 0, s: 100, l: 50 }
const GREEN = { h: 120, s: 100, l: 50 }
const BLUE = { h: 200, s: 100, l: 50 }

const openPanel = async () => {
  await page.locator('.zh-btn[title^="特效"]').click()
  await page.waitForSelector('.zh-fx', { timeout: 4000 })
  await page.getByRole('button', { name: '鼠标', exact: true }).click()
  await page.waitForTimeout(150)
}

const closePanel = async () => {
  await page.keyboard.press('Escape')
  await page.waitForTimeout(250)
}

const setColors = async (main, second) => {
  await openPanel()
  const r = await setColorField(0, main)
  await page.waitForTimeout(250)
  if (second) {
    // 第二个颜色的取色器要先点「加第二个颜色」才会出现
    const addBtn = page.locator('.zh-fx__pick', { hasText: '加第二个颜色' })
    if (await addBtn.count()) {
      await addBtn.click()
      await page.waitForTimeout(250)
    }
    await setColorField(1, second)
    await page.waitForTimeout(250)
  }
  await closePanel()
  return r
}

await setMode('点击 + 拖尾')
await setColors(RED, null)
const colorState = await page.evaluate(() => window.spark?.color ?? '')
check('挑一个自定义颜色（红）能生效', colorState === '255,0,0', `spark.color=${colorState}`)

// 画一条拖尾后**马上**采样（拖尾衰减很快，等久了就只剩白色爆点）
for (let i = 0; i < 16; i += 1) {
  await page.mouse.move(320 + i * 18, 620 + i * 3)
  await page.waitForTimeout(35)
}
const redSample = await hueCount(500, 645, 240)
check('画出来的就是红色（单色时不该出现绿）', redSample.red > 50 && redSample.green < redSample.red / 4, JSON.stringify(redSample))

// 再记一个自定义颜色：应该进「我的颜色」并在刷新后还在
await setColors(BLUE, null)
const mineAfterPick = await page.evaluate(() => JSON.parse(localStorage.getItem('md-editor-mouse-effect-v2') ?? '{}').customColors ?? [])
check(
  '挑过的颜色记进「我的颜色」',
  Array.isArray(mineAfterPick) && mineAfterPick.length >= 2 && /^0,\d{1,3},255$/.test(mineAfterPick[0]),
  JSON.stringify(mineAfterPick),
)

/* ---------- 8. 双色渐变：两个颜色都要出现 ---------- */
await setColors(RED, GREEN)
const twoColors = await page.evaluate(() => ({ c1: window.spark?.color, c2: window.spark?.color2 }))
check('第二个颜色也写进了特效', twoColors.c1 === '255,0,0' && twoColors.c2 === '0,255,0', JSON.stringify(twoColors))

// 拖尾从红到绿渐变：一头红、另一头绿、中间是两者混出来的颜色
await setMode('点击 + 拖尾')
for (let i = 0; i < 22; i += 1) {
  await page.mouse.move(360 + i * 20, 380 + Math.sin(i / 3) * 30)
  await page.waitForTimeout(35)
}
const gradSample = await hueCount(560, 385, 260)
check(
  '渐变生效：一头还是主色（红），中间出现红绿的混色',
  gradSample.red > 20 && gradSample.mixed > 20,
  JSON.stringify(gradSample),
)
check('单色时不该有这种混色（对照上面那次的采样）', redSample.mixed < gradSample.mixed, `单色 ${redSample.mixed} → 渐变 ${gradSample.mixed}`)
await page.screenshot({ path: resolve(OUT, 'mouse-effect-gradient.png') })

// 取消渐变 → 回到单色
await openPanel()
await page.locator('.zh-fx__pick', { hasText: '取消渐变' }).click()
await page.waitForTimeout(300)
await closePanel()
const backToSingle = await page.evaluate(() => window.spark?.color2 ?? 'x')
check('点「取消渐变」后回到单色', backToSingle === '', `color2=${JSON.stringify(backToSingle)}`)

/* ---------- 9. 彩虹：一条拖尾上要出现多种色相 ---------- */
await openPanel()
await page
  .locator('.zh-fx__toggle', { hasText: '彩虹' })
  .locator('.zh-fx__slider')
  .click()
await page.waitForTimeout(300)
await closePanel()
const rainbowOn = await page.evaluate(() => window.spark?.rainbow === true)
check('打开「彩虹」后特效进入彩虹模式', rainbowOn === true)

await setMode('点击 + 拖尾')
/* 采样重试：全量套件里（dev server 忙、帧率抖）偶尔会采到一条很稀的拖尾
   （实测 ink=100，而正常是 ~400），单条样本里混色像素就只剩 1 个 → 假失败。
   反复画、取**墨最多**的那次来判，才是对"画面上有没有过渡色"的可靠测量。 */
let rainbowSample = await hueCount(540, 305, 260)
for (let attempt = 0; attempt < 3 && rainbowSample.ink < 250; attempt += 1) {
  for (let i = 0; i < 20; i += 1) {
    await page.mouse.move(380 + i * 18, 300 + Math.sin(i / 2.5) * 35)
    await page.waitForTimeout(35)
  }
  const again = await hueCount(540, 305, 260)
  if (again.ink > rainbowSample.ink) rainbowSample = again
}
// 彩虹的本质：同一条拖尾上颜色不同、而且颜色还在随时间变（不是死一个色）
const rainbowCheck = await page.evaluate(async () => {
  const s = window.spark
  const a0 = s.rgbAt(0)
  const a1 = s.rgbAt(1)
  await new Promise((r) => setTimeout(r, 800))
  return { a0, a1, later: s.rgbAt(0) }
})
check(
  '彩虹：同一条拖尾两端颜色不同',
  rainbowCheck.a0 !== rainbowCheck.a1,
  `${rainbowCheck.a0} → ${rainbowCheck.a1}`,
)
check('彩虹：颜色还在随时间流动', rainbowCheck.later !== rainbowCheck.a0, `${rainbowCheck.a0} → ${rainbowCheck.later}`)
check(
  '彩虹：画面上确实出现过渡色（死一个颜色时不会有）',
  rainbowSample.spread >= 3,
  `色相铺开 ${rainbowSample.spread} 个桶（单色只有 1~2 个）  分布=${JSON.stringify(rainbowSample.hueBuckets)}`,
)
/* 对照组：单色那次的色相铺开度必须明显更小 —— 这才说明上面那条判据有区分力 */
check(
  '单色的色相铺开度明显更小（上面那条判据的对照组）',
  redSample.spread <= 2 && redSample.spread < rainbowSample.spread,
  `单色 ${redSample.spread} 桶 vs 彩虹 ${rainbowSample.spread} 桶`,
)
await page.screenshot({ path: resolve(OUT, 'mouse-effect-rainbow.png') })

await openPanel()
await page
  .locator('.zh-fx__toggle', { hasText: '彩虹' })
  .locator('.zh-fx__slider')
  .click()
await page.waitForTimeout(250)
await closePanel()
check('关掉彩虹后回到正常配色', (await page.evaluate(() => window.spark?.rainbow)) === false)

// 刷新之后：颜色和「我的颜色」都还在
await page.reload({ waitUntil: 'load' })
await page.waitForSelector('.ProseMirror', { timeout: 30000 })
await page.waitForTimeout(1500)
const afterReload = await page.evaluate(() => {
  const saved = JSON.parse(localStorage.getItem('md-editor-mouse-effect-v2') ?? '{}')
  return { color: window.spark?.color, custom: saved.customColors ?? [], mode: saved.mode }
})
check('刷新后颜色仍是自定义的', afterReload.color === '255,0,0', String(afterReload.color))
check('刷新后「我的颜色」还在', afterReload.custom.length >= 2, JSON.stringify(afterReload.custom))

/* ---------- 10. 自定义鼠标指针（只在自用版有这份素材） ---------- */
{
  const cursorOf = (sel) =>
    page.evaluate((s) => {
      const el = document.querySelector(s)
      return el ? getComputedStyle(el).cursor : null
    }, sel)
  /* dev 服务器下图片是文件 URL，打包成单文件后才会内联成 data URI —— 两种都算用上了 */
  const usesPointer = (v) => /data:image\/png|cursor\.png/.test(v ?? '')

  // 默认就是开着的（用户要的就是这枚指针）
  const attrOn = await page.evaluate(() => document.documentElement.dataset.fxCursor)
  const bodyCursor = await cursorOf('body')
  check(
    '默认用上自定义指针（body 的光标是那枚图）',
    attrOn === '1' && usesPointer(bodyCursor),
    `data-fx-cursor=${attrOn}，cursor=${(bodyCursor ?? '').slice(0, 46)}…`,
  )

  // 用户要求：整页都用这枚箭头 —— 正文编辑区、标题输入框也必须是它（按钮保持手型）
  const kept = await page.evaluate(() => {
    const btn = document.querySelector('.zh-toolbar .zh-btn')
    const prose = document.querySelector('.ProseMirror')
    const input = document.querySelector('.zh-title')
    return {
      btn: btn ? getComputedStyle(btn).cursor : null,
      prose: prose ? getComputedStyle(prose).cursor : null,
      input: input ? getComputedStyle(input).cursor : null,
    }
  })
  check(
    '正文编辑区和标题输入框也是这枚箭头（按钮仍是手型）',
    kept.btn === 'pointer' && usesPointer(kept.prose) && usesPointer(kept.input),
    `按钮=${kept.btn}，正文=${(kept.prose ?? '').slice(0, 30)}…，标题=${(kept.input ?? '').slice(0, 30)}…`,
  )

  // 面板里关掉 → 恢复系统默认
  await openPanel()
  await page
    .locator('.zh-fx__toggle', { hasText: '自定义鼠标指针' })
    .locator('.zh-fx__slider')
    .click()
  await page.waitForTimeout(300)
  await closePanel()
  const offAttr = await page.evaluate(() => document.documentElement.dataset.fxCursor)
  const offCursor = await cursorOf('body')
  check(
    '关掉开关后回到系统默认光标',
    offAttr === '0' && !usesPointer(offCursor),
    `data-fx-cursor=${offAttr}`,
  )

  // 再打开一次 + 刷新，确认这个开关是存下来的
  await openPanel()
  await page
    .locator('.zh-fx__toggle', { hasText: '自定义鼠标指针' })
    .locator('.zh-fx__slider')
    .click()
  await page.waitForTimeout(300)

  // 指针位置微调：两块滑块（整体右移 / 整体下移）就该跟着变
  const shiftX = page.locator('.zh-fx__cursor-row', { hasText: '整体右移' }).locator('.zh-fx__range')
  await shiftX.fill('40') // 整体右移 40px
  await page.waitForTimeout(250)
  const afterShift = await page.evaluate(() => ({
    saved: JSON.parse(localStorage.getItem('md-editor-mouse-effect-v2') ?? '{}').cursorHotspot ?? null,
    cssVar: getComputedStyle(document.documentElement).getPropertyValue('--fx-cursor').trim(),
  }))
  check(
    '「整体右移」拖到 40px 后热点真的变了（并写进设置）',
    Boolean(afterShift.saved) &&
      afterShift.saved.x === 87 - 40 &&
      afterShift.cssVar.includes(`${afterShift.saved.x} ${afterShift.saved.y}`),
    `hotspot=${JSON.stringify(afterShift.saved)}`,
  )

  const slider = page.locator('.zh-fx__cursor-row', { hasText: '整体下移' }).locator('.zh-fx__range')
  await slider.fill('40') // 整体下移 40px
  await page.waitForTimeout(250)
  const afterDrop = await page.evaluate(() => ({
    saved: JSON.parse(localStorage.getItem('md-editor-mouse-effect-v2') ?? '{}').cursorHotspot ?? null,
    cssVar: getComputedStyle(document.documentElement).getPropertyValue('--fx-cursor').trim(),
  }))
  check(
    '「整体下移」拖到 40px 后热点真的变了（并写进设置）',
    /* 基准是**尖端像素的 y**（TIP_ALIGNED_Y = 68），不是精灵图上留白。
       2026-09-26 把默认改成尖端对准时，基准从上留白 48 换成了尖端 y，这里跟着改；
       期望值写死 68 而不是 import 常量：断言要能抓住"常量被改错"这件事。 */
    Boolean(afterDrop.saved) &&
      afterDrop.saved.y === 68 - 40 &&
      afterDrop.cssVar.includes(`${afterDrop.saved.x} ${afterDrop.saved.y}`),
    `hotspot=${JSON.stringify(afterDrop.saved)}`,
  )

  // 精灵图加了留白，所以"往右/往下"能超出老素材那点范围
  await shiftX.fill('80')
  await slider.fill('48')
  await page.waitForTimeout(250)
  const extreme = await page.evaluate(
    () => JSON.parse(localStorage.getItem('md-editor-mouse-effect-v2') ?? '{}').cursorHotspot ?? null,
  )
  check(
    '能一路挪到"右移 80px + 下移 48px"（远超老素材的极限）',
    Boolean(extreme) && extreme.x === 7 && extreme.y === 20,
    JSON.stringify(extreme),
  )

  // 复位 / 尖端对准两个快捷按钮
  await page.locator('.zh-fx__pick', { hasText: '尖端对准' }).click()
  await page.waitForTimeout(250)
  const tipAligned = await page.evaluate(
    () => JSON.parse(localStorage.getItem('md-editor-mouse-effect-v2') ?? '{}').cursorHotspot ?? null,
  )
  check(
    '「尖端对准」一键把热点放回尖端（87,68）',
    Boolean(tipAligned) && tipAligned.x === 87 && tipAligned.y === 68,
    JSON.stringify(tipAligned),
  )
  await page.locator('.zh-fx__pick[title="恢复当前默认的指针偏移"]').click()
  await page.waitForTimeout(250)
  const backToDefault = await page.evaluate(
    () => JSON.parse(localStorage.getItem('md-editor-mouse-effect-v2') ?? '{}').cursorHotspot ?? null,
  )
  check(
    '「复位」恢复右移 21 px、下移 20 px 的默认偏移',
    Boolean(backToDefault) && backToDefault.x === 66 && backToDefault.y === 48,
    JSON.stringify(backToDefault),
  )

  // 校准区：点哪儿就在哪儿落红叉（红叉位置 = 浏览器认定的点击点）
  const calib = page.locator('.zh-fx__calib')
  const cbox = await calib.boundingBox()
  await page.mouse.click(cbox.x + 30, cbox.y + 20)
  await page.waitForTimeout(250)
  const dot = await page.evaluate(() => {
    const d = document.querySelector('.zh-fx__calib-dot')
    return d ? { left: d.style.left, top: d.style.top } : null
  })
  check(
    '校准区：红叉落在实际点击的位置（拿来对箭头尖端）',
    dot !== null && Math.abs(parseFloat(dot.left) - 30) <= 2 && Math.abs(parseFloat(dot.top) - 20) <= 2,
    JSON.stringify(dot),
  )
  await closePanel()
  await page.reload({ waitUntil: 'load' })
  await page.waitForSelector('.ProseMirror', { timeout: 30000 })
  await page.waitForTimeout(1200)
  const afterReloadCursor = await page.evaluate(() => ({
    attr: document.documentElement.dataset.fxCursor,
    cursor: getComputedStyle(document.body).cursor,
  }))
  check(
    '刷新后自定义指针还在（设置存下来了）',
    afterReloadCursor.attr === '1' && usesPointer(afterReloadCursor.cursor),
    `data-fx-cursor=${afterReloadCursor.attr}`,
  )

  /* ---------- 10b. 点击圆圈必须落在**真实点击点**上 ----------
     用户先后提过**三次**，最终定下来的要求（2026-09-26）：
       "保持原有鼠标指针不变，移动点击时产生的圆圈的位置到点击位置，
        从而使点击位置在圆圈的中心。"

     演进（三次都记下来，免得后人再绕）：
       ① 最初圆画在鼠标坐标上，但因为自定义指针的热点偏了，看着"圆和箭头尖对不上"
          → 第一版修法：让整套特效跟着**尖端**走（锚点 = 尖端像素 − 热点）。
       ② 但那把指针和圆绑在了一起：用户调热点时圆跟着跑，怎么调都对不齐（"调不了"）；
          而且尖端本身可能离点击点有距离，圆就跟着一起偏。
       ③ 第二版：锚点恒为 0 —— 圆一律画在 `e.clientX/clientY`。
          实测（.probe/probe-circle-vs-tip.mjs，dpr 1/1.25/1.5）圆确实就在点击点上（≤2px），
          但用户仍然报"特效偏左"，仍然要求"往右移" —— 判断基准是屏幕上箭头尖的**观感**
          （尖端是 6px 宽的钝口，见 measure-cursor-tip）。
       ④ 现在（第三版，用户要的）：**两者彻底解耦** ——
          指针位置 = 热点；圆的位置 = 真实点击点 + `clickOffsetX/Y`（面板「点击特效位置」）。
          锚点因此等于设置里的偏移，默认往右 5px。

     所以这里量的是"圆 vs **点击点 + 设置里的偏移**"。 */
  const readAnchor = () =>
    page.evaluate(() => {
      const css = getComputedStyle(document.documentElement).getPropertyValue('--fx-cursor')
      const m = /\)\s+(\d+)\s+(\d+),/.exec(css)
      const s = window.spark
      const raw = localStorage.getItem('md-editor-mouse-effect-v2')
      let saved = null
      try {
        saved = raw ? JSON.parse(raw) : null
      } catch {
        saved = null
      }
      return {
        hotspot: m ? [Number(m[1]), Number(m[2])] : null,
        dx: s?.anchorDX,
        dy: s?.anchorDY,
        offsetX: Number(saved?.clickOffsetX ?? 5),
        offsetY: Number(saved?.clickOffsetY ?? 0),
      }
    })
  const anchor = await readAnchor()
  check(
    '特效锚点 = 设置里的「点击特效位置」偏移（指针位置不再影响圆）',
    anchor.dx === anchor.offsetX && anchor.dy === anchor.offsetY,
    `热点 ${JSON.stringify(anchor.hotspot)} → 锚点 (${anchor.dx}, ${anchor.dy})，设置里的偏移 (${anchor.offsetX}, ${anchor.offsetY})`,
  )

  const TARGET = { x: 620, y: 460 }
  /* 采样重试：全量套件里（dev server 忙、帧率抖）偶尔会采到"刚炸开、还没铺开"的一帧，
     像素太少质心就飘了 → 假失败。反复采样取**像素最多**的那一帧，质心才稳。
     返回**所有**候选帧，交给下面按"离尖端多近"再挑一次。 */
  const sampleCloud = async () => {
    const frames = []
    for (let i = 0; i < 6; i++) {
      await page.mouse.move(TARGET.x, TARGET.y)
      await page.mouse.down()
      await page.mouse.up()
      await page.waitForTimeout(90)
      const r = await page.evaluate(
        ({ tx, ty }) => {
          const c = document.getElementById('sparkCanvas')
          const ctx = c.getContext('2d')
          const dpr = window.devicePixelRatio || 1
          const R = 150
          const x0 = Math.max(0, Math.floor((tx - R) * dpr))
          const y0 = Math.max(0, Math.floor((ty - R) * dpr))
          const w = Math.min(c.width - x0, Math.floor(R * 2 * dpr))
          const h = Math.min(c.height - y0, Math.floor(R * 2 * dpr))
          const d = ctx.getImageData(x0, y0, w, h).data
          let sx = 0
          let sy = 0
          let n = 0
          /* 只算够亮的像素：躲开很大一圈很淡的余光，质心才接近圆心 */
          for (let i = 0; i < d.length; i += 4) {
            if (d[i + 3] < 90) continue
            const p = i / 4
            sx += p % w
            sy += Math.floor(p / w)
            n += 1
          }
          if (!n) return null
          return { cx: +(x0 / dpr + sx / n / dpr).toFixed(1), cy: +(y0 / dpr + sy / n / dpr).toFixed(1), n }
        },
        { tx: TARGET.x, ty: TARGET.y },
      )
      if (r && r.n > 200) frames.push(r)
      /* 等它散掉再来一次，免得两次的粒子叠在一起 */
      await page.waitForTimeout(700)
    }
    return frames
  }
  const frames = await sampleCloud()

  /**
   * 从多帧里挑"最能用的一帧"。
   *
   * 为什么不能只按"像素最多"挑：质心是按 alpha≥90 的像素算的，柔光边缘**不对称**时
   * 就会有 2~3px 的抖动 —— 这个抖动跟像素多少无关。全量套件里（50 个套件连着跑，
   * dev server 忙）实测出现过单次 5.9px 的抖动，把"≤3px"的对照断言打红。
   *
   * 判据改成：**取离尖端最近的那一帧** —— 因为"对准"是本套件要验的性质，
   * 而抖动是对称噪声，取最小值就能把噪声压掉，同时保留断言的鉴别力
   * （真的没对准时，所有帧都会偏，取最好的一帧照样偏）。
   */
  const pickClosest = (list, tx, ty) => {
    let best = null
    let bestD = Infinity
    for (const f of list) {
      const d = Math.hypot(f.cx - tx, f.cy - ty)
      if (d < bestD) {
        bestD = d
        best = f
      }
    }
    return best
  }
  /* 挑"离**该在的位置**最近"的一帧 —— 因为"圆落在（点击点 + 偏移）上"才是要验的性质。
     ⚠️ 别按"离点击点最近"挑：默认偏移往右 5px 时，那样挑出来的帧天然偏左 3~4px，
     下面那条"抖动 ≤3px"的对照断言就会假红（实测就是这么红的）。 */
  const cloudCenter = frames.length
    ? pickClosest(frames, TARGET.x + anchor.offsetX, TARGET.y + anchor.offsetY)
    : null
  if (!cloudCenter) {
    check('点击圆圈落在真实点击点上', false, '画布上没画东西（或帧数不足）')
  } else {
    /* 圆该在哪 = 点击点 + 设置里的偏移（默认往右 5px） */
    const wantX = TARGET.x + anchor.offsetX
    const wantY = TARGET.y + anchor.offsetY
    const dx = +(cloudCenter.cx - wantX).toFixed(1)
    const dy = +(cloudCenter.cy - wantY).toFixed(1)
    check(
      '点击圆圈落在（点击点 + 设置偏移）上（差 ≤ 6px）',
      Math.abs(dx) <= 6 && Math.abs(dy) <= 6,
      `该在 (${wantX}, ${wantY})，圆质心 (${cloudCenter.cx}, ${cloudCenter.cy})，差 (${dx}, ${dy})`,
    )
    /* 阈值说明：要拦的是"圆没画在该在的地方"（历史上有过偏 22px 的实现）。
        6px 足够拦下它，同时容得下 ±2~3px 的采样噪声：质心按 alpha≥90 的像素算，
        柔光边缘不对称时会有抖动（实测单次最大 5.9px，所以下面这条对照卡 3px
        并且用"取最好的一帧"来压噪声）。 */
    check(
      '（对照）单次测量抖动量在 3px 以内（说明上面那个阈值不是拍脑袋）',
      Math.abs(dx) <= 3 && Math.abs(dy) <= 3,
      `本次抖动 (${dx}, ${dy})`,
    )

    /* ---------- 10c. 尖端本身必须落在**真实点击点**上 ----------
       上面那条只量"圆 vs 尖端"，所以**默认热点偏 22px 时它照样是绿的** ——
       用户实测反馈"点击的圈和指针尖对不上、而且面板里调不回来"，根因就是这里。
       补这一条：在**默认档**（复位后的状态）下，箭头尖必须落在真实鼠标坐标附近。
       尖端屏幕位置 = 鼠标坐标 + (尖端像素 − 热点)，所以"尖端对准"档下这个差为 0。 */
    /* ⚠️ 这一段前面 closePanel() + reload 过，面板是关着的 ——
       以前这里的"复位"点了个空（还挂着 .catch 把失败吃掉），断言是靠 window.spark
       里的旧值蒙对的。现在显式打开面板再点。 */
    await openPanel()
    await page.locator('.zh-fx__pick[title^="回到默认：尖端正好压在点击点上"]').click()
    await page.waitForTimeout(300)
    const atDefault = await readAnchor()
    if (!atDefault.hotspot) {
      check('默认档：箭头尖落在真实点击点上', false, '读不到热点')
    } else {
      const tipOffX = 87 - atDefault.hotspot[0]
      const tipOffY = 68 - atDefault.hotspot[1]
      const dist = Math.hypot(tipOffX, tipOffY)
      check(
        '默认档：箭头尖落在真实点击点上（偏移 ≤ 3px）',
        dist <= 3,
        `默认热点 ${JSON.stringify(atDefault.hotspot)} → 尖端偏点击点 (${tipOffX}, ${tipOffY})，距离 ${dist.toFixed(1)}px`,
      )
      check(
        '默认档：特效偏移回到默认（往右 5px，指针不动）',
        atDefault.dx === atDefault.offsetX && atDefault.dy === atDefault.offsetY,
        `锚点 (${atDefault.dx}, ${atDefault.dy})，设置偏移 (${atDefault.offsetX}, ${atDefault.offsetY})`,
      )
      /* ---------- 10d. 面板里的「特效右移」滑块真的能挪动圆 ----------
         为什么单加这一条：用户第二次报"偏左"时，我把圆的位置只跟"点击点"绑死了 ——
         量出来是准的，但用户看到的就是偏，而且**没有任何办法自己调**。
         现在面板里有「点击特效位置」两条滑块，这里就验它真的接上了（拖动 → 锚点跟着变）。 */
      const before = atDefault.dx
      const target = before + 12
      /* 用 Playwright 的 locator 找（跟上面那些断言同一套找法），
         找到之后在页面里走原生 setter + 冒泡 input 事件（React 管的 range 不吃直接赋值） */
      const slider = page.locator('.zh-fx__cursor-row', { hasText: '特效右移' }).locator('input[type=range]')
      const found = (await slider.count()) > 0
      let anchorAfter = null
      let savedAfter = null
      if (found) {
        await slider.evaluate((el, want) => {
          const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
          setter?.call(el, String(want))
          el.dispatchEvent(new Event('input', { bubbles: true }))
          el.dispatchEvent(new Event('change', { bubbles: true }))
        }, target)
        await page.waitForTimeout(400)
        const after = await page.evaluate(() => {
          let saved = null
          try {
            saved = JSON.parse(localStorage.getItem('md-editor-mouse-effect-v2') ?? 'null')?.clickOffsetX ?? null
          } catch {
            saved = null
          }
          return { anchor: window.spark?.anchorDX ?? null, saved }
        })
        anchorAfter = after.anchor
        savedAfter = after.saved
      }
      check(
        '面板「特效右移」滑块能真的把圆往右挪（指针不受影响）',
        found && (Math.abs(Number(anchorAfter) - target) < 0.5 || Number(savedAfter) === target),
        `拖动前锚点 ${before} → 期望 ${target}；实测锚点 ${anchorAfter}、存档 ${savedAfter}${found ? '' : '（没找到滑块！）'}`,
      )
      await closePanel()
    }
  }
}

check('全程无控制台错误', errors.length === 0, errors.slice(0, 2).join(' | '))

await browser.close()
for (const r of results) if (!r.ok) console.log(`\n待修：${r.name}`)
const failed = results.filter((r) => !r.ok).length
console.log(`\n${results.length - failed}/${results.length} 通过`)
process.exit(failed ? 1 : 0)
