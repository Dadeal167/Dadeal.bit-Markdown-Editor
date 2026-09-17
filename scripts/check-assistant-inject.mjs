/**
 * 助手「往知乎正文里放内容」的手法守卫（静态检查，不需要真账号）
 *
 * 背景（踩过的坑）：正文曾经用 document.execCommand('insertHTML') 注入 ——
 * DOM 上立刻看得见，看着一切正常，但**刷新草稿后正文是空的**：
 * Draft.js 只认真实的编辑事件，insertHTML 不触发 beforeinput，它内部状态没更新，
 * 知乎自动保存就把空正文存了下去。整篇稿子白传，而且失败得很安静。
 *
 * 现在改成"页面里合成 paste 事件（自带 DataTransfer）"，走 Draft.js 自己的粘贴处理。
 * 这个脚本守住这几件事，免得哪天又被改回去（真出问题只有很慢的 audit:zhihu 能发现）。
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const RAW = readFileSync(resolve('scripts', 'zhihu-assistant.mjs'), 'utf-8')
// 注释里会提到"当年用 insertHTML"这种历史，检查代码时先把注释去掉，免得误报
const SRC = RAW.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`${ok ? '✅' : '❌'}  ${name}${detail ? '  — ' + detail : ''}`)
}

// 1. 不许再用 insertHTML 注入正文
const insertHtml = [...SRC.matchAll(/execCommand\(\s*'insertHTML'/g)]
check('不再用 execCommand(\'insertHTML\') 注入正文', insertHtml.length === 0, insertHtml.length ? `还有 ${insertHtml.length} 处` : '没有')

// 2. 必须是合成 paste 事件，并且带 text/html
check('用合成 paste 事件注入（new ClipboardEvent(\'paste\')）', /new ClipboardEvent\(\s*'paste'/.test(SRC))
check('粘贴内容带 text/html（走 Draft.js 的粘贴处理）', /setData\(\s*'text\/html'/.test(SRC))
check('同时给了 text/plain 兜底', /setData\(\s*'text\/plain'/.test(SRC))

// 3. 粘贴前要把光标放到正文末尾，否则内容会插到中间
check(
  '粘贴前把光标放到正文末尾（selectNodeContents + collapse(false)）',
  /selectNodeContents\(el\)/.test(SRC) && /collapse\(false\)/.test(SRC),
)

// 4. 清空正文那条路（selectAll + delete）是 Draft.js 认的，别删掉
check('清空正文仍用 selectAll + delete（实测能存住）', /execCommand\(\s*'selectAll'/.test(SRC) && /execCommand\(\s*'delete'/.test(SRC))

// 5. 图片：**走系统剪贴板真粘贴**（2026-09-22 按实测改的）
//    原来这里断言的是"绝不用剪贴板、整篇一次粘完"——当时的假设是知乎会把内容里的
//    data: 图片自己接过去托管。实测（.probe/test-image-routes.mjs，真账号）：
//      · 内嵌 data: 图跟着正文粘 → 知乎前端报 Cannot read properties of null，图**根本没进去**
//      · 点工具栏「图片」按钮想触发文件选择 → 8 秒内没有 filechooser 事件，这条路不成立
//      · 写进系统剪贴板 + 真 Ctrl+V → 图片正常进草稿（草稿私有图床那个域），刷新后还在 ✅
//    所以现在：正文分段粘，图片一张张直接插。下面几条断言跟着改成新事实。
//    注意：SRC 里注释已经被剥掉了，所以只能断言**代码**，别断言注释文字。
const splitFn = (() => {
  const from = SRC.indexOf('export function splitParts')
  const to = SRC.indexOf('export function countInlineImages')
  return from >= 0 && to > from ? SRC.slice(from, to) : ''
})()
check(
  'splitParts 只按公式切段（图片不走它，改由 extractImageFiles 单独处理）',
  /export function countInlineImages/.test(SRC) && /data-latex/.test(splitFn) && !/img/i.test(splitFn),
)
check(
  '有 extractImageFiles：把"整块是图"的段落切出来落成本地文件',
  /export async function extractImageFiles/.test(SRC) && /push-img-/.test(SRC),
)
check(
  '图片走系统剪贴板真粘贴（SetImage + 真 Ctrl+V）——实测唯一能让知乎收下图片的路',
  /Clipboard\]::SetImage/.test(SRC) && /keyboard\.press\(\s*'Control\+V'/.test(SRC) && /async function pasteViaClipboard/.test(SRC),
)
/* 用户报过"图全跑到文末"：根因就是剪贴板粘贴前调了 focusBodyEnd（把光标甩到正文末尾），
   而图片应该插在"标记被删掉的那个位置"。这条断言把它钉死。 */
check(
  '剪贴板粘贴前不许移动光标（一移动，所有图就全被贴到正文末尾）',
  /async function keepEditorFocus/.test(SRC) &&
    (() => {
      const from = SRC.indexOf('async function pasteViaClipboard')
      const to = SRC.indexOf('async function insertImageDirect')
      const body = from >= 0 && to > from ? SRC.slice(from, to) : ''
      return body.length > 0 && !/focusBodyEnd/.test(body)
    })(),
)
check(
  '剪贴板贴图要可见窗口（无头浏览器没有系统剪贴板）',
  /ensureBrowser\(\{\s*visible:\s*imagesExpected > 0\s*\}\)/.test(SRC),
)
check(
  '正文一次粘完 + 图片位置留标记，再把标记逐个换成真图（"粘一段插一张"实测会丢图）',
  /const MARK = \(i\)/.test(SRC) &&
    /await pasteHtmlInto\(page, pasteHtml\)/.test(SRC) &&
    /for \(const item of queue\)/.test(SRC) &&
    /insertImageDirect\(page, item\.file\)/.test(SRC) &&
    /sel\.addRange\(r\)/.test(SRC),
)
check(
  '插图失败要退回旧办法并如实记下来（不能假装成功）',
  /插不进去，退回/.test(SRC) && /pastedFallback \+= 1/.test(SRC),
)
// 正文区上面压着浮动工具条，click() 会被挡住并一直重试到 30 秒超时（白等半分钟，实测）
check('不点正文区（那个 click 会白等 30 秒）', !/locator\(['"]\.public-DraftEditor-content['"]\)\.click/.test(SRC))

// 6. 上传完必须刷新复核（自动保存是防抖的，不刷新就不知道自己到底存住没有）
check('上传后刷新草稿复核（reload + 比对正文/公式/图片）', /page\.reload\(/.test(SRC) && /刷新后/.test(SRC))

// 7. 公式跟着正文一起粘（写 <img eeimg>），并且以"刷新后草稿里的公式数"为准
check('公式写成 <img eeimg> 跟正文一起粘', /formulaImgHtml\(/.test(SRC) && /eeimg/.test(SRC))
check(
  '公式是否成功以"刷新后草稿里的公式节点数"为准（不看注入后的 DOM）',
  /after\.formulas < formulaParts\.length/.test(SRC),
)
check('没有"探针公式"那套残留（它会把一段公式留在草稿开头）', !/探针/.test(SRC) || !/pasteHtml\(`<p>\$\{formulaImgHtml/.test(SRC))

// 8. 自检端点：知乎改版导致过"静默失效"，用户需要一个随时能验的按钮
check('有 /selfcheck 端点（面板「检查一下能不能用」走它）', /url\.pathname === '\/selfcheck'/.test(SRC))
check('自检复用同一套合成粘贴，不是另起一套写法', /pasteHtmlInto\(page, probe\)/.test(SRC) && /async function pasteHtmlInto/.test(SRC))
{
  const self = SRC.slice(SRC.indexOf('async function runSelfCheck'))
  check(
    '自检四项都验（正文/公式/图片/表格），并且以"刷新后的草稿"为准',
    /正文能粘进去、刷新后还在/.test(self) &&
      /公式变成了知乎的真公式节点/.test(self) &&
      /图片被知乎接管托管/.test(self) &&
      /表格能过去/.test(self) &&
      /page\.reload\(/.test(self),
  )
  check(
    '自检只碰自己那篇草稿（标题固定「Dadealbit 自检（可删）」，复用而不是每次新建）',
    /SELFCHECK_TITLE = 'Dadealbit 自检（可删）'/.test(SRC) &&
      /reuseExistingDraft\(page, SELFCHECK_TITLE\)/.test(self) &&
      /await clearEditor\(page\)/.test(self),
  )
}

// 9. 同名草稿复用 + 彻底清空（知乎写作页每次打开都是新草稿，不复用就会越堆越多）
check('有"按标题找回已有草稿"的实现', /async function reuseExistingDraft/.test(SRC) && /DRAFT_LIST_URL/.test(SRC))
check(
  '只认标题完全一样的（不会误改别人的稿子）',
  /t === w && \/zhuanlan\\\.zhihu\\\.com\\\/p\\\/\\d\+\\\/edit\//.test(SRC),
)
check(
  '清空正文是"真键盘 + 复查零残留"（表格/图片/公式这些原子块 execCommand 删不掉）',
  /async function clearEditor/.test(SRC) && /Control\+a/.test(SRC) && /c\.atoms === 0/.test(SRC),
)
check(
  '上传流程用 clearEditor，并把"复用还是新建"报给面板',
  /const cleared = await clearEditor\(page\)/.test(SRC) && /reusedDraft,/.test(SRC),
  /reusedDraft/.test(readFileSync(resolve('src', 'editor', 'ZhihuModal.tsx'), 'utf-8')) ? '面板也读了 reusedDraft' : '面板没读 reusedDraft',
)

// 10. 失败快照：知乎改版导致失败时得把现场留下来（不然只能靠复现）
check('有 saveFailureSnapshot（截图 + 页面 DOM + 日志 + 结果）', /async function saveFailureSnapshot/.test(SRC) && /screenshot\.png/.test(SRC) && /page\.html/.test(SRC))
check('日志有环形缓冲（最近 300 行），快照里带得上', /LOG_RING/.test(SRC) && /LOG_RING\.length > 300/.test(SRC))
check('上传失败 / 自检没通过时都会存现场', /where: 'uploadDraft'/.test(SRC) && /where: 'selfcheck'/.test(SRC))
check('有手动存现场的 /snapshot 端点（也走令牌鉴权）', /url\.pathname === '\/snapshot'/.test(SRC))
check(
  '面板会把失败现场目录显示出来',
  /failureDir/.test(readFileSync(resolve('src', 'editor', 'ZhihuModal.tsx'), 'utf-8')),
)
check('快照目录只留最近 10 份（不会越攒越多）', /dirs\.length - 10/.test(SRC) && /rmSync\(resolve\(root, old\)/.test(SRC))

// 11. 本地路径图片的守卫：知乎读不到用户电脑上的文件，推过去只会是「图片导入失败」
//     （这条路的细节验证在 check-zhihu-images.mjs，这里只钉住"别被删掉"）
check(
  '推送前拦掉本地路径图片（开浏览器之前就返回，不动草稿）',
  /export function classifyImages/.test(SRC) &&
    /imgStats0?\.local > 0/.test(SRC) &&
    /localImageBlockText\(/.test(SRC) &&
    // 守卫必须在**本函数里**的 ensureBrowser 之前（否则会白开一个浏览器窗口）
    (() => {
      const at = SRC.indexOf('imgStats0.local > 0')
      return at >= 0 && /const ctx = await ensureBrowser\(/.test(SRC.slice(at, at + 4000))
    })(),
)
check(
  '校验"图片有没有被知乎接管"（光数 <img> 不够：导入失败的图元素还在）',
  /hosted: real\.filter/.test(SRC) && /after\.hosted >= dataExpected/.test(SRC) && /imagesUnhosted === 0/.test(SRC),
)
check(
  '自检的探针图是真实截图的体积（150 字节的小图测不出"图片导入失败"）',
  /SELFCHECK_IMG_BYTES = 120 \* 1024/.test(SRC) && /noisePng\(SELFCHECK_IMG_BYTES\)/.test(SRC),
)

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} 通过`)
process.exit(failed.length ? 1 : 0)
