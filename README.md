# CC Desk

Claude Code 桌面伴侣：历史会话、Workspace、供应商切换，一键在 Terminal.app 启动 / resume。

路径：`/Users/bo.yang.kou/code_workspace/webstorm_workspace/claude-panel`

## 安装依赖

```bash
npm install --ignore-scripts
bash scripts/install-electron.sh   # 若 Electron 二进制缺失
```

## 网页开发

```bash
npm run dev
```

浏览器打开 http://127.0.0.1:5173

## 桌面窗口开发

```bash
npm run electron:dev
```

## 打包可执行程序

```bash
npm run electron:build
```

产物：`release/mac-arm64/CC Desk.app`

双击即可用。首次若被 macOS 拦截：右键 → 打开，或拖到「应用程序」。

可选 DMG：`npm run electron:dist`（本机终端执行更稳）。

## 界面用法（类似 Codex）

- 左侧 **Projects**：Workspace + 自动发现的项目，展开后是历史会话
- **右键项目** → Edit project / 添加文件夹到 workspace
- 弹窗里管理 **Source folders**（Primary、Add folder），并可从「已知项目」一键并入
- New chat / Resume 会在 Terminal 启动 `claude`（多目录走 `--add-dir`）
