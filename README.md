# VSCode 摸鱼阅读器 (VSCode Reader)

**隐蔽阅读，极致摸鱼。**

VSCode 摸鱼阅读器允许你在编辑器中直接阅读本地电子书（支持 **TXT** 与 **EPUB**）。它巧妙地利用了 VS Code 的 **行内补全** (Ghost Text) 功能，将小说内容显示为灰色的代码提示，完美融入代码环境，不易被察觉。

> 本仓库基于 [zhoupb01/vscode-reader](https://github.com/zhoupb01/vscode-reader)（v0.0.3）改进，新增 EPUB 支持、书籍文件选择器，并适配 VS Code 1.85.x。

## 功能特性

- **多格式支持**: 同时支持 `.txt` 纯文本与 `.epub` 电子书，按文件后缀自动分发解析。
- **EPUB 深度解析**:
    - 沿 OPF spine 阅读顺序逐章提取，跳过目录/封面等导航页；
    - 章节标题优先取正文 `h1-h3`，回退 `<title>`，重名自动消歧；
    - HTML 标签剥离、实体解码（`&amp;` `&#x...;` 等）、样式脚本过滤。
- **幽灵文本显示**: 内容以灰色"幽灵文本"形式出现在光标处，类似 Copilot 的建议，不干扰正常代码（不按下 Tab 键不会上屏）。
- **状态栏信息**: 底部状态栏实时显示当前章节标题和页码进度。
- **智能导航**:
    - **极简翻页**: 开启模式下，直接使用 `[` 和 `]` 键翻页。
    - **老板键**: 按下 `Space` (空格) 键立即关闭阅读模式，瞬间消失。
    - **章节跳转**: 支持搜索章节标题快速定位。
    - TXT 自动识别章节目录（"第x章"、"Chapter x" 等格式）；EPUB 按 spine 结构分章。
    - 自动保存阅读进度，下次打开自动恢复。
- **书籍选择器**: 快捷键唤起系统文件选择器选书，无需手输路径。
- **自定义设置**: 可调整每页显示的行数和每行字符数，适应不同屏幕。

## 使用说明

1. **选择书籍文件（推荐）**:
   按下快捷键 `Ctrl+Alt+E`（Mac 为 `Cmd+Alt+E`，或命令面板执行 `阅读器: 选择书籍文件`），在文件选择器中挑选 `.txt` 或 `.epub` 文件。
   *对话框会自动定位到当前书籍所在目录；选择后立即生效。*

2. **或手动配置路径**:
   打开设置 (`Ctrl+,`) -> 搜索 `vscode-reader` -> 在 `File Path` 中填入本地 `.txt` / `.epub` 文件的绝对路径。

3. **开启/关闭阅读**:
   按下快捷键 `Ctrl+Alt+.` (或在命令面板执行 `阅读器: 开关显示`)。
   *状态栏右下角会出现 `$(book) ...` 图标。*

4. **翻页控制 (仅阅读模式下生效)**:
   - **下一页**: `]`
   - **上一页**: `[`

5. **紧急隐藏 (老板键)**:
   - 在阅读模式下，按下 **`Space` (空格键)** 立即关闭阅读器。

6. **章节跳转**:
   - 按下 `Ctrl+Alt+J` (或执行 `阅读器: 跳转章节`) 打开章节搜索框。

   *提示：将光标移动到一个空行，阅读体验最佳。*

## 快捷键一览

| 按键 | 功能 | 生效条件 |
|------|------|----------|
| `Ctrl+Alt+E`（Mac: `Cmd+Alt+E`） | 选择书籍文件 | 任意时刻 |
| `Ctrl+Alt+.`（Mac: `Cmd+Alt+.`） | 开关阅读模式 | 任意时刻 |
| `Ctrl+Alt+J`（Mac: `Cmd+Alt+J`） | 跳转章节 | 任意时刻 |
| `[` / `]` | 上一页 / 下一页 | 阅读模式中 |
| `Space` | 关闭阅读（老板键） | 阅读模式中 |

## 扩展设置

本扩展提供以下配置项：

* `vscode-reader.filePath`: 书籍文件的绝对路径，支持 `.txt` 与 `.epub`。
* `vscode-reader.linesPerPage`: 每页显示的行数 (默认: 15)。
* `vscode-reader.charsPerLine`: 每行显示的字符数，超过会自动换行 (默认: 50)。

## 常见问题

- **冲突**: 如果你同时开启了 Copilot 或其他行内补全插件，可能会在视觉上产生重叠。建议在专心摸鱼时暂时禁用其他补全插件，或者在不需要阅读时通过快捷键关闭本插件。
- **编码**: `.txt` 仅支持 UTF-8 编码；EPUB 内部统一 UTF-8，无编码问题。
- **EPUB 限制**: 不支持 DRM 加密的正版电子书；图片、表格等富元素会被拍平为纯文本（幽灵文本只显示文字）。
- **切换书籍**: 更换文件后阅读进度会重置到第一章（当前版本为全局单份进度）。

## 开发与调试

```bash
npm install        # 安装依赖
node esbuild.js    # 构建，产物在 dist/extension.js
npm run watch      # watch 模式（esbuild + tsc 并行）
npm test           # 集成测试（需下载独立 VS Code 实例）
```

- **EPUB 解析冒烟测试**（不依赖 VS Code 宿主）:
  ```bash
  npx esbuild scripts/test-epub.ts --bundle --platform=node --outfile=/tmp/epub-test.cjs --alias:vscode=./scripts/vscode-stub.cjs && node /tmp/epub-test.cjs
  ```
- **真实 EPUB 质检**（章节结构 / 标签泄漏 / 实体残留抽检）:
  ```bash
  npx esbuild scripts/inspect-epub.ts --bundle --platform=node --outfile=/tmp/inspect-epub.cjs --alias:vscode=./scripts/vscode-stub.cjs && node /tmp/inspect-epub.cjs "<epub路径>"
  ```
- **F5 调试**: 直接按 `F5` 启动 Extension Development Host（launch.json 已移除 preLaunchTask，不依赖 npm 任务链）；断点打在 `src/extension.ts`，sourcemap 已配置。

### 兼容性说明

- 目标引擎为 **VS Code ^1.85.2**（`@types/vscode` 锁定 1.85.0），代码未使用 1.85 之后的 API。
- esbuild 锁定 **0.21.5**：新版 esbuild 二进制要求 macOS 12+，在 macOS 11 上会报 `_SecTrustCopyCertificateChain` 缺失。

## 代码结构

```
src/
├── book.ts        # Book 接口 + 共享分页函数 paginate()
├── extension.ts   # 扩展入口、Reader（Ghost Text）、DispatchBook 按后缀分发、FileBook（txt）
└── epubBook.ts    # parseEpub 纯函数 + EpubBook 实现（jszip + fast-xml-parser）
scripts/
├── test-epub.ts       # EPUB 解析冒烟测试
├── inspect-epub.ts    # 真实 EPUB 质检
└── vscode-stub.cjs    # 脚本脱离 VS Code 运行时的模块桩
```

## 更新日志

### 0.0.4（本仓库改进，未发布）
- **新增 EPUB 支持**: jszip + fast-xml-parser 解析，spine 顺序分章、h1-h3 章节标题提取、目录页跳过、实体解码与标签剥离。
- **新增书籍选择器**: `Ctrl+Alt+E`（Mac `Cmd+Alt+E`）唤起文件选择器选书，按原配置作用域写回路径。
- **适配 VS Code 1.85.2**: engines/types 降级，launch.json 移除 preLaunchTask，esbuild 锁定 0.21.5。
- 重构: 抽出 `Book` 接口与共享分页逻辑，新增 `DispatchBook` 按后缀分发。

### 0.0.3（上游）
- 优化快捷键：使用 `[` / `]` 直接翻页。
- 新增老板键：`Space` 键立即关闭。
- 修复显示刷新延迟问题。

### 0.0.2（上游）
- 新增章节跳转功能 (`Ctrl+Alt+J`)。
- 添加开源许可证。

### 0.0.1（上游）
- 首次发布。
- 支持本地 TXT 读取与章节自动解析。
- 实现幽灵文本阅读模式。
