# Dadealbit Markdown 编辑器

一个本地 Markdown 编辑器，适合写数学笔记、题解和讲义。下载 HTML，用浏览器双击打开即可写作。

## 下载与使用

- [下载当前版本 v1.2](https://github.com/Dadeal167/Dadeal.bit-Markdown-Editor/releases/latest)。下载 `Dadealbit-Markdown-Editor-v1.2.html`，用 Edge 或 Chrome 打开。日常编辑可离线使用。
- 从旧版升级前，用原来的浏览器和 HTML 打开编辑器，把文档导出为 Markdown。浏览器按文件路径隔离本地存储，换文件名、目录或浏览器后可重新导入。
- 如需自动保存到知乎草稿箱，可另外下载同一版本的 Windows 知乎助手包。解压后首次运行「安装知乎助手.bat」，之后打开包内 HTML，从「知乎」面板启动助手。手动导入可在单文件 HTML 中选择「导出知乎用 Markdown」，再打开知乎写作页导入。
- 从源码启动的 Windows 桌面编辑器可在「知乎」面板启动、连接或停止助手，自动填写连接信息。已用外部启动器开启的助手仍由原启动器管理。

## 写作与工作区

- 公式可用符号面板插入，也可输入 LaTeX。支持行内和行间公式、语法修复、自动编号、交叉引用和文档宏。
- 「工具 → 本地工作区」可以搜索目录内的文件名、标题、正文和公式，点击结果定位。支持反向链接、版本对比、文档库备份和原文件写回。浏览器会在打开文件夹或写入时请求权限。
- 打开包含 Markdown 和 `assets` 的文件夹可以读取正文引用的本地图片，保留 GIF 动画。「素材管理与断链修复」提供预览和批量修复。
- 长文支持章节折叠和重排、脚注、BibTeX 参考文献和 Mermaid 图表。阅读模式隐藏上下栏并锁定正文。「界面」可以切换到可拖动的悬浮球，默认按 `Ctrl + Alt + T` 唤出。

## 导出与发布

- 「保存」可导出 Word、PDF、HTML 和 Markdown 资源包。Word 和 PDF 支持纸张、页边距、页眉页脚与分页。
- 标记提示、答案和解析后，可以从同一份文稿预览并导出学生版和教师版。
- 「知乎」可以导出供知乎导入的 Markdown，并直接打开知乎写作页。通过本机助手保存草稿后，编辑器会核对草稿里的公式、表格和图片。视频在知乎稿件中以原始链接保留。

## 动态壁纸

在「特效 → 背景」导入图片、视频或兼容的 Wallpaper Engine 项目。可调整正文位置、透明度、毛玻璃材质和背景缩放。壁纸历史支持备注、搜索、删除和复用，也可把外观与壁纸绑定到某篇文档。

- 网页内可播放兼容的场景和本地资源完整的 Live2D 项目。部分时段配置可自动匹配，其他项目可导入自己的 `wallpaper-time.json`。场景着色器与项目脚本的兼容性取决于具体壁纸。
- Windows 用户可以从源码构建后双击「启动器 → 启动桌面编辑器.bat」。桌面模式使用独立文档库。电脑已安装 Wallpaper Engine 时，可以直接从「特效 → 背景」选择原生壁纸。
- Spine 运行库遵循单独许可。符合许可的开发者可用 `pnpm build:spine` 启用 Spine 4.2 导入，以及兼容角色的视线追踪和摸头。壁纸与游戏素材由使用者自行提供。 [Spine 运行库许可](https://esotericsoftware.com/spine-runtimes-license)

### Spine 动态背景示例

两张截图的背景均为作者从《蔚蓝档案》官方游戏中提取并导入编辑器的 Spine 动画。正文面板放在画面左侧，可调整位置、材质和透明度。

**未花（泳装）**

![未花（泳装）的 Spine 动态背景和左侧半透明正文](docs/screenshots/wallpaper-mika-swimsuit.png)

**未花**

![未花的 Spine 动态背景和左侧半透明正文](docs/screenshots/wallpaper-mika.png)

## 鼠标效果

在「特效」面板的「鼠标效果」中，可以开关点击效果和拖尾，调整颜色、透明度及拖尾刷新率。拖尾特效来自 [BASpark](https://github.com/DoomVoss/BASpark)。

演示中的自定义鼠标指针来自《蔚蓝档案》的游戏素材，素材来源见 [BA-Pointer](https://github.com/Dr-hydra/BA-Pointer)。公开版使用自绘指针。

## 从源码构建

需要 Node.js 22.12 或以上版本和 pnpm。

```sh
pnpm install --frozen-lockfile
pnpm build
```

打开生成的 `Dadealbit Markdown 编辑器.html`。开发服务器用 `pnpm dev`，Windows 上安装 Edge 后可用 `pnpm check:effects` 跑核心回归。知乎助手包用 `pnpm make:bundle` 构建。

## 功能示例

### 工作区公式搜索

在多篇讲义中搜索同一个公式，点击命中项打开并定位。

![工作区搜索结果与二次函数讲义](docs/screenshots/workspace.png)

### Word 与 PDF 排版

导出前可以设置纸张、页边距、页眉页脚和按章分页。

![Word 与 PDF 的排版设置](docs/screenshots/publication.png)

## 许可

项目使用 [LICENSE](LICENSE) 中所列的 Dadealbit 使用许可。WebWallGL、Mediabunny 和可选的 Spine 运行库适用各自的许可。
