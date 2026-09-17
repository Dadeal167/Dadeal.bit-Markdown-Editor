/**
 * 两个版本的行为测试
 *  A. 完整版（开发服务器）：特效设置面板 —— 档位、缩放、不透明度、动画速度、拖尾刷新率、颜色、恢复默认
 *  B. 纯净版（file:// 双击的那个文件）：没有特效按钮、没有画布、其余功能照常
 */
import { chromium } from 'playwright-core'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`${ok ? '✅' : '❌'}  ${name}${detail ? '  — ' + detail : ''}`)
}

const browser = await chromium.launch({ channel: 'msedge', headless: true })

/* ================= A. 完整版 ================= */
{
  const page = await browser.newPage({ viewport: { width: 1400, height: 950 } })
  const errs = []
  page.on('pageerror', (e) => errs.push(String(e).slice(0, 110)))
  page.on('console', (m) => {
    if (m.type() === 'error' && !/ERR_CONNECTION_REFUSED/.test(m.text())) errs.push(m.text().slice(0, 110))
  })
  await page.goto('http://127.0.0.1:5173/', { waitUntil: 'load', timeout: 60000 })
  await page.waitForSelector('.ProseMirror', { timeout: 30000 })
  await page.waitForTimeout(1500)

  console.log('=== A. 完整版：特效设置面板 ===')
  await page.locator('.zh-btn[title="特效"]').click()
  await page.waitForSelector('.zh-fx', { timeout: 4000 })
  const panel = await page.evaluate(() => {
    const p = document.querySelector('.zh-fx')
    const rows = [...p.querySelectorAll('.zh-fx__label')].map((el) => el.textContent.trim())
    return { rows, modes: [...p.querySelectorAll('.zh-fx__mode')].map((b) => b.textContent.trim()) }
  })
  check('面板有「恢复默认设置」', (await page.locator('.zh-fx__reset').count()) === 1)
  check(
    '面板含缩放/不透明度/动画速度/拖尾刷新率',
    ['缩放比例', '全局不透明度', '动画播放速度', '拖尾刷新率'].every((t) => panel.rows.includes(t)),
    panel.rows.join(' / '),
  )
  check('面板含档位三选一', panel.modes.length === 3, panel.modes.join(' / '))
  check(
    '面板含颜色区（面板内取色器 + 预设 + 我的颜色 + 渐变 + 彩虹）',
    (await page.locator('.zh-cf').count()) >= 1 &&
      (await page.locator('.zh-cf__bar').count()) === 3 &&
      (await page.locator('.zh-fx__pick', { hasText: '加第二个颜色' }).count()) === 1 &&
      (await page.locator('.zh-fx__label', { hasText: '彩虹' }).count()) === 1,
    `取色器 ${await page.locator('.zh-cf').count()} 个，滑杆 ${await page.locator('.zh-cf__bar').count()} 条`,
  )

  // 改缩放：特效实例上的 scale 应该跟着变（按标签找那一行，别按序号 —— 面板加滑块就会挤位）
  const rowSlider = (label) => page.locator('.zh-fx__row', { hasText: label }).locator('.zh-fx__range').first()
  await rowSlider('缩放比例').fill('2.4')
  await page.waitForTimeout(400)
  let applied = await page.evaluate(() => ({
    scale: window.spark?.scale,
    opacity: window.spark?.opacity,
    hz: window.spark?.trailHz,
  }))
  check('拖动缩放比例真的改到了特效', Math.abs((applied.scale ?? 0) - 2.4) < 0.001, JSON.stringify(applied))

  // 改不透明度
  await rowSlider('全局不透明度').fill('40')
  await page.waitForTimeout(400)
  applied = await page.evaluate(() => ({ opacity: window.spark?.opacity }))
  check('改不透明度生效（40%）', Math.abs((applied.opacity ?? 0) - 0.4) < 0.001, JSON.stringify(applied))

  // 拖尾刷新率
  await rowSlider('拖尾刷新率').fill('30')
  await page.waitForTimeout(400)
  applied = await page.evaluate(() => ({ hz: window.spark?.trailHz }))
  check('改拖尾刷新率生效（30Hz）', applied.hz === 30, JSON.stringify(applied))

  // 关掉"同一动画速度"→ 应该多出两个滑块（开关是隐藏的 input，点它对应的 .zh-fx__slider）
  // 注意：面板里现在有两个开关（同一动画速度 / 彩虹），要按标签找，不能点第一个了事
  await page
    .locator('.zh-fx__toggle', { hasText: '同一动画速度' })
    .locator('.zh-fx__slider')
    .click()
  await page.waitForTimeout(400)
  const rows2 = await page.evaluate(() =>
    [...document.querySelectorAll('.zh-fx__label')].map((el) => el.textContent.trim()),
  )
  check(
    '关掉「同一动画速度」后出现拖尾/点击两个独立滑块',
    rows2.includes('拖尾衰减速度') && rows2.includes('点击爆发速度'),
    rows2.join(' / '),
  )

  // 换颜色
  await page.locator('.zh-fx__preset').nth(3).click()
  await page.waitForTimeout(400)
  const color = await page.evaluate(() => window.spark?.color)
  check('点预设色块能换色', color === '255,105,180', String(color))

  // 恢复默认
  await page.locator('.zh-fx__reset').click()
  await page.waitForTimeout(500)
  const afterReset = await page.evaluate(() => ({
    scale: window.spark?.scale,
    opacity: window.spark?.opacity,
    hz: window.spark?.trailHz,
    color: window.spark?.color,
  }))
  check(
    '恢复默认设置把参数全改回去',
    Math.abs(afterReset.scale - 1.5) < 0.001 &&
      Math.abs(afterReset.opacity - 0.8) < 0.001 &&
      afterReset.hz === 60 &&
      afterReset.color === '45,175,255',
    JSON.stringify(afterReset),
  )
  check('完整版无控制台错误', errs.length === 0, errs.slice(0, 2).join(' | '))
  await page.close()
}

/* ================= B. 纯净版 ================= */
{
  const file = resolve('Dadealbit Markdown 编辑器.html')
  console.log('\n=== B. 纯净版（双击版）===')
  if (!existsSync(file)) {
    check('纯净版文件存在', false, file)
  } else {
    const url = 'file:///' + file.replace(/\\/g, '/')
    const page = await browser.newPage({ viewport: { width: 1360, height: 900 } })
    const errs = []
    page.on('pageerror', (e) => errs.push(String(e).slice(0, 110)))
    await page.goto(url, { waitUntil: 'load', timeout: 60000 })
    await page.waitForSelector('.ProseMirror', { timeout: 30000 })
    await page.waitForTimeout(1500)

    const info = await page.evaluate(() => ({
      effectBtn: [...document.querySelectorAll('.zh-btn')].filter((b) =>
        (b.querySelector('.zh-btn__label')?.textContent || '').includes('特效'),
      ).length,
      canvas: !!document.getElementById('sparkCanvas'),
      buttons: [...document.querySelectorAll('.zh-btn')].map((b) =>
        (b.querySelector('.zh-btn__label')?.textContent || '').trim(),
      ),
    }))
    check('纯净版没有「特效」按钮', info.effectBtn === 0, `按钮：${info.buttons.join(' ')}`)
    check('纯净版没有特效画布', info.canvas === false)
    // 注：「导出」并进「保存」了（少一个），后来又加了「搜索」（多一个），正好抵消；
    //     纯净版 24 = 完整版 25 减掉「特效」
    check('纯净版按钮数 = 24（比完整版少一个「特效」）', info.buttons.length === 24, `${info.buttons.length} 个`)

    // 其余功能照常：打字 + 公式 + 主题
    await page.locator('.ProseMirror').click()
    await page.keyboard.type('纯净版测试')
    await page.waitForTimeout(300)
    const typed = await page.evaluate(() => document.querySelector('.ProseMirror').textContent.includes('纯净版测试'))
    check('纯净版能正常打字', typed)
    await page.locator('.zh-btn[title="主题"]').click()
    await page.waitForTimeout(300)
    await page.locator('.zh-menu__item', { hasText: '深色' }).click()
    await page.waitForTimeout(400)
    const dark = await page.evaluate(() => document.documentElement.dataset.theme)
    check('纯净版主题切换正常', dark === 'dark', String(dark))
    check('纯净版无页面错误', errs.length === 0, errs.slice(0, 2).join(' | '))
    await page.close()
  }
}

await browser.close()
for (const r of results) if (!r.ok) console.log(`\n待修：${r.name}`)
const failed = results.filter((r) => !r.ok).length
console.log(`\n${results.length - failed}/${results.length} 通过`)
process.exit(failed ? 1 : 0)
