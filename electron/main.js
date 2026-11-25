import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  nativeImage,
  shell,
} from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { startServer } from '../server/app.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const isDev = !app.isPackaged

/** @type {import('node:http').Server | null} */
let server = null
/** @type {BrowserWindow | null} */
let mainWindow = null
let booting = false

function registerIpc() {
  ipcMain.handle('dialog:openDirectory', async (_evt, opts = {}) => {
    const win = BrowserWindow.getFocusedWindow() || mainWindow
    const multi = opts.multi !== false
    const properties = ['openDirectory', 'createDirectory']
    if (multi) properties.push('multiSelections')

    const result = await dialog.showOpenDialog(win ?? undefined, {
      title: opts.title || (multi ? '选择文件夹（可多选）' : '选择文件夹'),
      defaultPath: opts.defaultPath || app.getPath('home'),
      properties,
      message:
        opts.message ||
        (multi
          ? '按住 ⌘ 可多选文件夹；第一个将作为 Primary 主目录'
          : '选择要加入 workspace 的项目 / 文件夹'),
      buttonLabel: opts.buttonLabel || '打开',
    })
    if (result.canceled || !result.filePaths?.length) {
      return multi ? [] : null
    }
    // Always return array for multi mode; single path string when multi=false
    return multi ? result.filePaths : result.filePaths[0]
  })

  /** Copy PNG/JPEG bytes to the system clipboard as an image. */
  ipcMain.handle('clipboard:copyImage', async (_evt, payload = {}) => {
    try {
      let image = null
      if (payload.filePath && typeof payload.filePath === 'string') {
        image = nativeImage.createFromPath(payload.filePath)
      } else if (payload.data) {
        const buf = Buffer.from(payload.data)
        image = nativeImage.createFromBuffer(buf)
      }
      if (!image || image.isEmpty()) {
        return { ok: false, error: 'Invalid image data' }
      }
      clipboard.writeImage(image)
      return { ok: true }
    } catch (err) {
      return { ok: false, error: String(err?.message || err) }
    }
  })
}

async function createWindow() {
  if (booting) return
  booting = true

  try {
    if (!server) {
      const dataFile = path.join(app.getPath('userData'), 'workspaces.json')
      const staticDir = isDev ? null : path.join(__dirname, '..', 'dist')

      const started = await startServer({
        port: Number(process.env.CLAUDE_PANEL_PORT || 8787),
        staticDir,
        dataFile,
      })
      server = started.server

      if (isDev && started.port !== 8787) {
        console.warn(
          `API listening on ${started.port}, but Vite proxies to 8787. Free port 8787 and restart.`,
        )
      }

      globalThis.__claudePanelPort = started.port
    }

    const port = globalThis.__claudePanelPort || 8787

    mainWindow = new BrowserWindow({
      width: 1180,
      height: 780,
      minWidth: 860,
      minHeight: 560,
      title: 'CC Desk',
      backgroundColor: '#161616',
      show: false,
      autoHideMenuBar: true,
      webPreferences: {
        preload: path.join(__dirname, 'preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    })

    mainWindow.once('ready-to-show', () => mainWindow?.show())

    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
      void shell.openExternal(url)
      return { action: 'deny' }
    })

    if (isDev) {
      await mainWindow.loadURL(
        process.env.CLAUDE_PANEL_DEV_URL || 'http://127.0.0.1:5173',
      )
    } else {
      await mainWindow.loadURL(`http://127.0.0.1:${port}`)
    }
  } finally {
    booting = false
  }
}

app.whenReady().then(() => {
  registerIpc()
  createWindow().catch((err) => {
    console.error(err)
    app.quit()
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow().catch(console.error)
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  try {
    server?.close()
  } catch {
    /* ignore */
  }
})
