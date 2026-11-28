import cors from 'cors'
import { cancelChatRun, listChatRuns, watchChatRun, decidePermission, reserveTerminal, releaseIdleWorker, finishTerminalLaunch, streamChat } from './chat.js'
import express from 'express'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  buildClaudeCommand,
  dirsFromFiles,
  focusExistingTerminal,
  startingTerminalTty,
  launchInTerminal,
} from './launch.js'
import {
  deleteSession,
  getSessionContextUsage,
  getSessionMessages,
  getSessionMeta,
  listSessions,
  MEDIA_ROOT,
  removeProjectData,
} from './sessions.js'
import {
  createWorkspace,
  deleteWorkspace,
  listWorkspaces,
  setDataFile,
  updateWorkspace,
} from './workspaces.js'
import {
  getClaudeSettings,
  updateClaudeSettings,
} from './claudeSettings.js'
import {
  createProvider,
  deleteProvider,
  importFromCcSwitch,
  listLocalProviders,
  markProviderCurrent,
  setProvidersFileFromWorkspaces,
  updateProvider,
} from './providersStore.js'
import {
  getClaudeCliInfo,
  launchClaudeUpdate,
  listActiveClaudeCli,
  resolveClaudeBin,
} from './claudeCli.js'
import {
  addMcpServer,
  createSkill,
  deleteSkill,
  getMcpServerDetail,
  getMcpServerTools,
  listMcpServers,
  listSkills,
  removeMcpServer,
  updateMcpServer,
} from './claudeExt.js'

export function createApp({ staticDir } = {}) {
  const app = express()

  app.use(cors())
  // Chat attachments are base64-encoded (images / PDFs / staged files).
  app.use(express.json({ limit: '48mb' }))

  app.post('/api/chat/permission', decidePermission)
  app.get('/api/chat/runs', listChatRuns)
  app.get('/api/chat/runs/:id', watchChatRun)
  app.post('/api/chat/runs/:id/stop', cancelChatRun)
  app.post('/api/chat', streamChat)

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, home: os.homedir() })
  })

  app.get('/api/claude-settings', async (_req, res) => {
    try {
      res.json(await getClaudeSettings())
    } catch (err) {
      res.status(500).json({ error: String(err.message || err) })
    }
  })

  app.get('/api/claude-cli', async (_req, res) => {
    try {
      res.json(await getClaudeCliInfo())
    } catch (err) {
      res.status(500).json({ error: String(err.message || err) })
    }
  })

  /** How many Claude Code CLI processes are running on this Mac right now. */
  app.get('/api/claude-cli/active', async (_req, res) => {
    try {
      res.json(await listActiveClaudeCli())
    } catch (err) {
      res.status(500).json({ error: String(err.message || err) })
    }
  })

  /** Open Terminal and run npm install -g @anthropic-ai/claude-code@latest */
  app.post('/api/claude-cli/update', async (_req, res) => {
    try {
      const info = await getClaudeCliInfo()
      const launched = await launchClaudeUpdate()
      res.json({ ...info, ...launched, updateCommand: info.updateCommand })
    } catch (err) {
      res.status(500).json({ error: String(err.message || err) })
    }
  })

  app.put('/api/claude-settings', async (req, res) => {
    try {
      const next = await updateClaudeSettings(req.body || {})
      res.json(next)
    } catch (err) {
      res.status(500).json({ error: String(err.message || err) })
    }
  })

  /**
   * Local provider library (providers.json).
   * First run may bootstrap from CC Switch; afterwards local is source of truth.
   */
  app.get('/api/claude-providers', async (_req, res) => {
    try {
      res.json(await listLocalProviders())
    } catch (err) {
      res.status(500).json({ error: String(err.message || err) })
    }
  })

  app.post('/api/claude-providers', async (req, res) => {
    try {
      const created = await createProvider(req.body || {})
      res.status(201).json(created)
    } catch (err) {
      res.status(500).json({ error: String(err.message || err) })
    }
  })

  app.put('/api/claude-providers/:id', async (req, res) => {
    try {
      const next = await updateProvider(req.params.id, req.body || {})
      if (!next) return res.status(404).json({ error: 'Provider not found' })
      res.json(next)
    } catch (err) {
      res.status(500).json({ error: String(err.message || err) })
    }
  })

  app.delete('/api/claude-providers/:id', async (req, res) => {
    try {
      const ok = await deleteProvider(req.params.id)
      if (!ok) return res.status(404).json({ error: 'Provider not found' })
      res.json({ ok: true })
    } catch (err) {
      res.status(500).json({ error: String(err.message || err) })
    }
  })

  /** Optional re-import. Local entries win; only adds missing ids unless replace=true. */
  app.post('/api/claude-providers/import-cc-switch', async (req, res) => {
    try {
      const replace = Boolean(req.body?.replace)
      res.json(await importFromCcSwitch({ replace }))
    } catch (err) {
      res.status(500).json({ error: String(err.message || err) })
    }
  })

  app.post('/api/claude-providers/:id/use', async (req, res) => {
    try {
      const listed = await markProviderCurrent(req.params.id)
      if (!listed) return res.status(404).json({ error: 'Provider not found' })
      res.json(listed)
    } catch (err) {
      res.status(500).json({ error: String(err.message || err) })
    }
  })

  /** Claude Code personal skills (~/.claude/skills) + plugin skills (read-only). */
  app.get('/api/claude-skills', async (_req, res) => {
    try {
      res.json(await listSkills())
    } catch (err) {
      res.status(500).json({ error: String(err.message || err) })
    }
  })

  app.post('/api/claude-skills', async (req, res) => {
    try {
      res.status(201).json(await createSkill(req.body || {}))
    } catch (err) {
      res.status(400).json({ error: String(err.message || err) })
    }
  })

  app.delete('/api/claude-skills/:name', async (req, res) => {
    try {
      res.json(await deleteSkill(req.params.name))
    } catch (err) {
      res.status(400).json({ error: String(err.message || err) })
    }
  })

  /** Claude Code MCP servers (user scope writable; local/project listed read-only). */
  app.get('/api/claude-mcp', async (_req, res) => {
    try {
      res.json(await listMcpServers())
    } catch (err) {
      res.status(500).json({ error: String(err.message || err) })
    }
  })

  app.get('/api/claude-mcp/:name', async (req, res) => {
    try {
      res.json(await getMcpServerDetail(req.params.name))
    } catch (err) {
      res.status(404).json({ error: String(err.message || err) })
    }
  })

  app.get('/api/claude-mcp/:name/tools', async (req, res) => {
    try {
      res.json(
        await getMcpServerTools(req.params.name, {
          scope: req.query.scope,
          projectPath: req.query.projectPath,
        }),
      )
    } catch (err) {
      res.status(400).json({ error: String(err.message || err) })
    }
  })

  app.post('/api/claude-mcp', async (req, res) => {
    try {
      res.status(201).json(await addMcpServer(req.body || {}))
    } catch (err) {
      res.status(400).json({ error: String(err.message || err) })
    }
  })

  app.put('/api/claude-mcp/:name', async (req, res) => {
    try {
      res.json(await updateMcpServer(req.params.name, req.body || {}))
    } catch (err) {
      res.status(400).json({ error: String(err.message || err) })
    }
  })

  app.delete('/api/claude-mcp/:name', async (req, res) => {
    try {
      res.json(await removeMcpServer(req.params.name))
    } catch (err) {
      res.status(400).json({ error: String(err.message || err) })
    }
  })

  /** Serve cached transcript images (written under MEDIA_ROOT only). */
  app.get('/api/media/:sessionId/:file', (req, res) => {
    const sessionId = req.params.sessionId
    const file = req.params.file
    if (
      !sessionId ||
      !file ||
      sessionId.includes('..') ||
      file.includes('..') ||
      file.includes('/') ||
      file.includes('\\')
    ) {
      return res.status(400).json({ error: 'Invalid path' })
    }
    const full = path.join(MEDIA_ROOT, sessionId, file)
    if (!full.startsWith(path.join(MEDIA_ROOT, sessionId))) {
      return res.status(400).json({ error: 'Invalid path' })
    }
    if (!fs.existsSync(full)) return res.status(404).json({ error: 'Not found' })
    res.sendFile(full)
  })

  app.get('/api/sessions', async (_req, res) => {
    try {
      const sessions = await listSessions()
      res.json({ sessions })
    } catch (err) {
      res.status(500).json({ error: String(err.message || err) })
    }
  })

  app.get('/api/sessions/:id/meta', async (req, res) => {
    try {
      const meta = await getSessionMeta(req.params.id)
      if (!meta) return res.status(404).json({ error: 'Session not found' })
      res.json(meta)
    } catch (err) {
      res.status(500).json({ error: String(err.message || err) })
    }
  })

  app.get('/api/sessions/:id/context', async (req, res) => {
    try {
      res.json(await getSessionContextUsage(req.params.id))
    } catch (err) {
      res.status(500).json({ error: String(err.message || err) })
    }
  })

  app.get('/api/sessions/:id', async (req, res) => {
    try {
      const before = req.query.before === undefined ? null : Number(req.query.before)
      if (before !== null && (!Number.isSafeInteger(before) || before < 0)) {
        return res.status(400).json({ error: '无效的历史消息位置' })
      }
      const detail = await getSessionMessages(req.params.id, 120, before)
      if (!detail) return res.status(404).json({ error: 'Session not found' })
      res.json(detail)
    } catch (err) {
      res.status(500).json({ error: String(err.message || err) })
    }
  })

  app.delete('/api/sessions/:id', async (req, res) => {
    try {
      const result = await deleteSession(req.params.id)
      if (!result) return res.status(404).json({ error: 'Session not found' })
      res.json(result)
    } catch (err) {
      res.status(500).json({ error: String(err.message || err) })
    }
  })

  /** Remove project: optional workspace row + Claude local data (purge / sessions). */
  app.post('/api/projects/remove', async (req, res) => {
    try {
      const {
        workspaceId = null,
        cwd = null,
        sessionIds = [],
        purgeClaude = true,
      } = req.body || {}

      let workspaceDeleted = false
      if (workspaceId) {
        workspaceDeleted = await deleteWorkspace(workspaceId)
      }

      const data = purgeClaude
        ? await removeProjectData({
            cwd,
            sessionIds: Array.isArray(sessionIds) ? sessionIds : [],
            usePurge: true,
          })
        : { ok: true, purged: false, deletedSessions: [] }

      res.json({
        ok: true,
        workspaceDeleted,
        ...data,
      })
    } catch (err) {
      res.status(500).json({ error: String(err.message || err) })
    }
  })

  app.get('/api/workspaces', async (_req, res) => {
    try {
      res.json({ workspaces: await listWorkspaces() })
    } catch (err) {
      res.status(500).json({ error: String(err.message || err) })
    }
  })

  app.post('/api/workspaces', async (req, res) => {
    try {
      const ws = await createWorkspace(req.body || {})
      res.status(201).json({ workspace: ws })
    } catch (err) {
      res.status(500).json({ error: String(err.message || err) })
    }
  })

  app.patch('/api/workspaces/:id', async (req, res) => {
    try {
      const ws = await updateWorkspace(req.params.id, req.body || {})
      if (!ws) return res.status(404).json({ error: 'Workspace not found' })
      res.json({ workspace: ws })
    } catch (err) {
      res.status(500).json({ error: String(err.message || err) })
    }
  })

  app.delete('/api/workspaces/:id', async (req, res) => {
    try {
      const ok = await deleteWorkspace(req.params.id)
      if (!ok) return res.status(404).json({ error: 'Workspace not found' })
      res.json({ ok: true })
    } catch (err) {
      res.status(500).json({ error: String(err.message || err) })
    }
  })

  app.post('/api/launch', async (req, res) => {
    let reserved
    try {
      const {
        sessionId = null,
        cwd = null,
        addDirs = [],
        files = [],
        name = null,
        workspaceId = null,
        model = null,
        permissionMode = null,
        effort = null,
      } = req.body || {}

      if (sessionId) {
        if (!reserveTerminal(sessionId)) {
          return res.status(409).json({ error: '该会话正在回复或正在打开终端，请稍后再试' })
        }
        reserved = sessionId
      }

      let resolvedCwd = cwd
      let resolvedDirs = [...addDirs]
      let resolvedName = name

      if (workspaceId) {
        const list = await listWorkspaces()
        const ws = list.find((w) => w.id === workspaceId)
        if (!ws) return res.status(404).json({ error: 'Workspace not found' })
        resolvedCwd = resolvedCwd || ws.cwd
        resolvedDirs = [...new Set([...resolvedDirs, ...(ws.addDirs || [])])]
        if (ws.files?.length) {
          resolvedDirs = [
            ...new Set([...resolvedDirs, ...dirsFromFiles(ws.files)]),
          ]
        }
        resolvedName = resolvedName || ws.name
      }

      if (files?.length) {
        resolvedDirs = [...new Set([...resolvedDirs, ...dirsFromFiles(files)])]
      }

      if (!resolvedCwd && resolvedDirs.length) {
        resolvedCwd = resolvedDirs[0]
      }
      if (!resolvedCwd) resolvedCwd = os.homedir()

      resolvedDirs = resolvedDirs.filter(
        (d) => path.resolve(d) !== path.resolve(resolvedCwd),
      )

      const claudeBin = (await resolveClaudeBin()) || 'claude'
      if (claudeBin === 'claude') {
        return res.status(500).json({
          error:
            '未找到 claude 命令。请先安装 Claude Code，或在设置 → About 检查 PATH。',
        })
      }

      // Reuse an already-running CLI for this session instead of spawning another.
      if (sessionId) {
        await releaseIdleWorker(sessionId)
        const live = await listActiveClaudeCli()
        const matches = (live.processes || []).filter((p) => {
          if (p.sessionId) return p.sessionId === sessionId
          const args = String(p.command || '').split(/\s+/)
          return args.some((arg, i) =>
            ['--resume', '-r', '--session-id'].includes(arg) && args[i + 1] === sessionId)
        })
        const interactive = matches.find(p => p.tty && p.kind !== 'print')
        const tty = interactive?.tty || startingTerminalTty(sessionId)
        if (tty && await focusExistingTerminal(tty, !interactive)) {
          return res.json({
            ok: true, reused: true, mode: 'focus', cwd: interactive?.cwd || resolvedCwd,
            message: '已切到当前会话所在的终端标签页',
          })
        }
        if (interactive) {
          return res.status(409).json({ error: '该会话已在其他终端运行，请切到对应的终端窗口' })
        }

        const background = matches.find(p => p.kind === 'background' || p.kind === 'agent')
        if (background) {
          const attachTarget = background.name || background.sessionId || sessionId
          const result = await launchInTerminal({
            cwd: background.cwd || resolvedCwd,
            commandParts: [claudeBin, 'attach', String(attachTarget)],
            sessionId,
            trustCwd: true,
            windowTitle: `Claude Code · ${String(sessionId).slice(0, 8)}`,
          })
          return res.json({
            ...result,
            reused: true,
            mode: 'attach',
            message: '已附着到后台 Claude 会话（未新开 agent 进程）',
            process: background,
          })
        }

        if (matches.some(p => p.kind === 'print')) {
          return res.status(409).json({ error: '另一个非交互 CLI 正在使用此会话，请在它结束后再试' })
        }
      }

      const commandParts = buildClaudeCommand({
        cwd: resolvedCwd,
        sessionId,
        addDirs: resolvedDirs,
        name: sessionId ? null : resolvedName,
        model,
        permissionMode,
        effort,
        claudeBin,
      })

      const result = await launchInTerminal({
        cwd: resolvedCwd,
        commandParts,
        sessionId,
        trustCwd: true,
        windowTitle: sessionId
          ? `Claude Code · ${String(sessionId).slice(0, 8)}`
          : resolvedName
            ? `Claude Code · ${resolvedName}`
            : 'Claude Code',
      })
      res.json({ ...result, reused: false, mode: 'launch' })
    } catch (err) {
      res.status(500).json({ error: String(err.message || err) })
    } finally {
      if (reserved) finishTerminalLaunch(reserved)
    }
  })

  app.post('/api/paths/stat', async (req, res) => {
    const paths = Array.isArray(req.body?.paths) ? req.body.paths : []
    const results = []
    for (const p of paths) {
      try {
        const st = await fsp.stat(p)
        results.push({
          path: p,
          exists: true,
          isDirectory: st.isDirectory(),
          isFile: st.isFile(),
        })
      } catch {
        results.push({
          path: p,
          exists: false,
          isDirectory: false,
          isFile: false,
        })
      }
    }
    res.json({ results })
  })

  app.get('/api/fs/list', async (req, res) => {
    try {
      let dir = String(req.query.path || os.homedir())
      if (dir === '~') dir = os.homedir()
      if (dir.startsWith('~/')) dir = path.join(os.homedir(), dir.slice(2))
      dir = path.resolve(dir)

      if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
        return res.status(400).json({ error: 'Not a directory' })
      }

      const entries = await fsp.readdir(dir, { withFileTypes: true })
      const items = entries
        .filter((e) => !e.name.startsWith('.'))
        .map((e) => ({
          name: e.name,
          path: path.join(dir, e.name),
          isDirectory: e.isDirectory(),
          isFile: e.isFile(),
        }))
        .sort((a, b) => {
          if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
          return a.name.localeCompare(b.name)
        })

      res.json({
        path: dir,
        parent: path.dirname(dir),
        items,
      })
    } catch (err) {
      res.status(500).json({ error: String(err.message || err) })
    }
  })

  if (staticDir && fs.existsSync(staticDir)) {
    app.use(express.static(staticDir))
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api')) return next()
      res.sendFile(path.join(staticDir, 'index.html'))
    })
  }

  return app
}

export async function startServer({
  port = 8787,
  host = '127.0.0.1',
  staticDir = null,
  dataFile = null,
} = {}) {
  if (dataFile) {
    setDataFile(dataFile)
    setProvidersFileFromWorkspaces(dataFile)
  }

  const app = createApp({ staticDir })
  const desired = Number(port)

  const listen = (p) =>
    new Promise((resolve, reject) => {
      const server = app.listen(p, host, () => {
        resolve({ server, port: server.address().port, host })
      })
      server.on('error', reject)
    })

  try {
    return await listen(desired)
  } catch (err) {
    if (err?.code === 'EADDRINUSE') {
      // Fall back to ephemeral port
      return listen(0)
    }
    throw err
  }
}
