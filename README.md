# CC Desk

**Desktop companion for [Claude Code](https://docs.anthropic.com/en/docs/claude-code)** — browse sessions, manage workspaces, switch providers, and launch / resume chats in Terminal.

Claude Code 桌面伴侣：历史会话、Workspace、供应商切换，一键在 macOS Terminal 启动或 Resume。

[![macOS](https://img.shields.io/badge/platform-macOS-black)](https://github.com/kou-123/cc-desk)
[![Release](https://img.shields.io/github/v/release/kou-123/cc-desk)](https://github.com/kou-123/cc-desk/releases/latest)
[![Electron](https://img.shields.io/badge/Electron-35-47848F?logo=electron&logoColor=white)](https://www.electronjs.org/)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)

<p align="center">
  <img src="build/icons/preview.png" alt="CC Desk preview" width="720" />
</p>

---

## Download（推荐）

普通用户**不用拉代码**，直接下载安装包：

➡️ **[Latest Release](https://github.com/kou-123/cc-desk/releases/latest)**

| 文件 | 说明 |
|------|------|
| `CC Desk-*-arm64.dmg` | 拖进「应用程序」安装（Apple Silicon） |
| `CC-Desk-*-mac-arm64.zip` | 解压即得 `CC Desk.app` |

**打开提示：** 当前未做 Apple 公证签名。若提示「无法打开 / 已损坏」：

1. 右键应用 → **打开** → 仍选择打开；或  
2. 终端执行：`xattr -cr "/Applications/CC Desk.app"`

还需本机已安装 **Claude Code** CLI（`claude` 命令可用）。

---

## Why CC Desk?

Claude Code 本身很强，但会话散落在 `~/.claude/projects`，多项目、多供应商时切换成本高。CC Desk 把这些收成一个桌面面板：

| 痛点 | CC Desk |
|------|---------|
| 找不到旧会话 | 按项目 / Recents 浏览，Markdown 预览 transcript |
| 多目录协作麻烦 | Workspace + `--add-dir`，一键开聊 |
| 供应商 / 模型来回改 | 本地 Provider 管理，写入 `~/.claude/settings.json` |
| 只想继续上次 | Resume 拉起 Terminal，并自动同步预览 |

适合日常用 Claude Code 的 macOS 用户，尤其是多仓库、多 API 线路的场景。

---

## Features

- **Sessions** — 自动发现本机 Claude Code 会话，按项目树或 Recents 查看；支持删除、打开所在文件夹
- **Transcript preview** — Markdown 渲染、折叠块、图片缩略图；Resume 后实时同步 Terminal 里的更新
- **Workspaces** — 多文件夹项目（Primary + Add dirs），右键编辑，从已知项目一键并入
- **Launch / Resume** — 在 Terminal.app 启动 `claude` 或 resume 指定会话
- **Providers & models** — 本地 `providers.json` 优先；可从本机 CC Switch（`~/.cc-switch`）一次性合并导入；别名映射（Sonnet / Opus / Haiku 等）与 1M 上下文
- **Settings** — 全页设置：Model、Claude Code 版本检测与一键更新指引
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
2. 点选会话查看 transcript；需要继续时点 **Resume**（Terminal 启动，面板自动同步）
3. **New chat** 选择项目 / Workspace 后开新会话
4. 右键项目 → **Edit project** 管理 Source folders
5. 齿轮进入 **Settings** → 管理 Provider、模型别名，或查看 Claude Code 版本

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
- 仓库已忽略 `data/workspaces.json`、`data/providers.json` 等个人路径与密钥文件

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
