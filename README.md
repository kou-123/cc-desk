# CC Desk

**Desktop companion for [Claude Code](https://docs.anthropic.com/en/docs/claude-code)** — browse sessions, manage workspaces, switch providers, and chat with the local CLI directly in the panel.

选择项目或历史会话即可在面板中提问，实时查看本地 Claude Code 的回复。Enter 发送，Shift+Enter 换行。长会话先显示最近 120 个消息块，滚到顶部会载入上一页，并保留当前阅读位置。

[![macOS](https://img.shields.io/badge/platform-macOS-black)](https://github.com/kou-123/cc-desk)
[![Release](https://img.shields.io/github/v/release/kou-123/cc-desk)](https://github.com/kou-123/cc-desk/releases/latest)
[![Electron](https://img.shields.io/badge/Electron-35-47848F?logo=electron&logoColor=white)](https://www.electronjs.org/)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)

<p align="center">
  <img src="build/icons/icon.png" alt="CC Desk app icon" width="180" />
</p>

---

## Download（推荐）

普通用户**不用拉代码**，直接下载安装包：

➡️ **[Latest Release](https://github.com/kou-123/cc-desk/releases/latest)**

在 Release 的 Assets 中下载 `CC-Desk-*-arm64.dmg`（适用于 Apple Silicon）。打开 DMG，将 **CC Desk** 拖进「应用程序」。

**首次打开（重要）：** 当前未加入 Apple 开发者公证，macOS 可能拦截为「已损坏 / 无法验证开发者」。这不是安装坏了，按下面任一方式即可：

```bash
# 推荐：去掉隔离标记后再打开
xattr -cr "/Applications/CC Desk.app"
open -a "CC Desk"
```

或：在「应用程序」里对 **CC Desk** **右键 → 打开** → 再点打开。

真正做到「双击无提示」需要 Apple Developer 证书 + 公证（付费账号），本仓库暂未启用。

还需本机已安装 **Claude Code** CLI（`claude` 命令可用）。

---

## Why CC Desk?

Claude Code 本身很强，但会话散落在 `~/.claude/projects`，多项目、多供应商时切换成本高。CC Desk 把这些收成一个桌面面板：

| 痛点 | CC Desk |
|------|---------|
| 找不到旧会话 | 按项目 / Recents 浏览，Markdown 预览 transcript |
| 多目录协作麻烦 | Workspace + `--add-dir`，一键开聊 |
| 供应商 / 模型来回改 | 本地 Provider 管理，写入 `~/.claude/settings.json` |
| 只想继续上次 | 面板里直接续聊，或一键打开 macOS Terminal（带模型 / 信任目录） |

适合日常用 Claude Code 的 macOS 用户，尤其是多仓库、多 API 线路的场景。

---

## Features

- **Sessions** — 自动发现本机 Claude Code 会话；侧栏悬停可新建（`+`）/ 删除（`×`）；空会话直接删，有内容会确认
- **Transcript preview** — Markdown 渲染、思考折叠（有思考内容时默认展开）；气泡里的图片可点击放大 / 右键或按钮复制；左侧提问目录（每条用户提问一条线，点击跳转）；打开 Terminal 后可「终端预览同步」；工具摘要 / 结果与思考全文不再截断
- **Workspaces** — 多文件夹项目（Primary + Add dirs），右键编辑；悬停 workspace 行的 `+` 可在该项目新建会话；列表按**添加顺序**（最近添加在最上），不会因新建会话而重排
- **Chat** — 面板内提问 / 停止 / 续聊；同会话 CLI worker 空闲约 **10 分钟**内复用；流式展示思考过程与回复；粘贴或拖入图片与文件；权限模式（Manual / Accept edits / Auto / Plan）；模型与思考强度（Effort → CLI `--effort`）
- **Sidebar attention** — 其它会话在等工具确认，或后台回合已结束时，该会话旁显示橙色圆点；点进会话后消失
- **Live CLI count** — 右下角显示本机正在运行的 Claude CLI 数量（约每 10 秒刷新），悬停可看简要列表
- **Quit guard** — 有回复或工具确认进行中时，关窗口 / ⌘Q 会弹出确认，避免误关中断任务
- **Terminal launch** — **Open Claude Code CLI** 打开 macOS Terminal；若该会话已有交互/后台进程则附着或切到已有窗口，不重复开进程；面板 worker 仍在时也不新开终端
- **Providers & models** — 本地 `providers.json`；可从本机 CC Switch（`~/.cc-switch`）合并导入；别名映射与 1M 上下文
- **Settings** — Model、Skills（`~/.claude/skills`）、MCP（`~/.claude.json`，可展开看工具 / 编辑用户级条目）、Appearance 字号、About / CLI 更新
- **UI** — 深色 / 浅色主题，侧栏搜索，截断路径 hover 提示

---

## Requirements

- macOS（当前发布包为 **Apple Silicon / arm64**）
- 已安装 [Claude Code](https://docs.anthropic.com/en/docs/claude-code) CLI（`claude` 在 PATH 中）
- 从源码开发时另需 [Node.js](https://nodejs.org/) 18+

---

## Build from source（开发者）

只想用软件 → 看上面的 [Download](#download推荐)。下面给改代码 / 自己打包用：

```bash
git clone git@github.com:kou-123/cc-desk.git
cd cc-desk
npm install --ignore-scripts
bash scripts/install-electron.sh   # 若 Electron 二进制缺失
```

```bash
# 浏览器 + 本地 API → http://127.0.0.1:5173
npm run dev

# 桌面窗口
npm run electron:dev

# 打出 .app
npm run electron:build
# → release/mac-arm64/CC Desk.app

# 打出 DMG（可上传到 GitHub Releases）
npm run electron:dist
```

---

## Usage

1. 打开 **CC Desk**，左侧浏览 **Projects** 或底部切到 **Recents**
2. 点选会话：可在底部输入框继续提问；长会话左侧目录可按提问跳转；需要完整 TUI 时点 **Open Claude Code CLI**
3. 输入框右下角可点 **模型名 + 思考强度**，调节 Effort，并切换供应商 / 模型
4. 拖入 / 粘贴图片后可点缩略图放大或复制；发送后聊天气泡里同样支持
5. **New chat**，或悬停 workspace 行的 **`+`**，在对应项目下新建会话
6. 悬停会话行的 **`×`** 删除会话（空会话直接删）；侧栏橙色圆点表示该会话待确认或已在后台跑完
7. 右下角可查看本机 **CLI** 进程数与 sessions / workspaces 统计
8. 任务进行中关应用会提示确认
9. 右键项目 → **Edit project** 管理 Source folders
10. 齿轮 → **Settings**：Provider / 模型、Skills、MCP、字号、Claude Code 版本

---

## Tech stack

| Layer | Stack |
|-------|--------|
| UI | React 19 · TypeScript · Vite |
| Desktop | Electron |
| Local API | Node.js · Express |
| Data | `~/.claude/projects`（jsonl）、本地 workspace / providers 配置 |

---

## Privacy

- 会话与配置数据都在本机；应用不会上传你的 transcript 或 API Key
- 开发时的工作区和 provider 配置保存在本机 `data/` 下。桌面应用从 Electron 用户数据目录读取这些配置。打包时会排除项目的 `data/` 目录，以及名为 `workspaces.json`、`providers.json` 的文件。

---

## Contributing

Issue / PR 都欢迎。改动前建议先跑通：

```bash
npm run build
npm run electron:dev
```

---

## License

MIT — see [LICENSE](./LICENSE).

---

<p align="center">
  <b>CC Desk</b> · Claude Code, but with a desk.
</p>
