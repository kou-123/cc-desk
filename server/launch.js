import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const execute = promisify(execFile)

function shellQuote(s) {
  return `'${String(s).replace(/'/g, `'\\''`)}'`
}

export function buildClaudeCommand({
  cwd,
  sessionId,
  addDirs = [],
  name,
  model = null,
  permissionMode = null,
  effort = null,
  extraArgs = [],
  claudeBin = 'claude',
}) {
  const parts = [claudeBin || 'claude']
  if (sessionId) {
    parts.push('--resume', sessionId)
  }
  if (name && !sessionId) {
    parts.push('--name', name)
  }
  const modelId = String(model || '').trim()
  if (modelId && !modelId.startsWith('-') && !/[\s\x00-\x1f]/.test(modelId)) {
    parts.push('--model', modelId)
  }
  // Interactive CLI modes (Shift+Tab). Skip when Ask/default.
  const perm = String(permissionMode || '').trim()
  if (
    perm &&
    perm !== 'default' &&
    perm !== 'manual' &&
    ['acceptEdits', 'auto', 'plan', 'bypassPermissions', 'dontAsk'].includes(
      perm,
    )
  ) {
    parts.push('--permission-mode', perm)
  }
  let effortLevel = String(effort || '')
    .trim()
    .toLowerCase()
  if (
    effortLevel === 'extra' ||
    effortLevel === 'extra-high' ||
    effortLevel === 'extra_high'
  ) {
    effortLevel = 'xhigh'
  }
  if (['low', 'medium', 'high', 'xhigh', 'max'].includes(effortLevel)) {
    parts.push('--effort', effortLevel)
  }
  for (const dir of addDirs) {
    if (dir) {
      parts.push('--add-dir', dir)
    }
  }
  parts.push(...extraArgs)
  return parts
}

const CLAUDE_JSON = path.join(os.homedir(), '.claude.json')

/**
 * Mark a project directory as trusted so Claude Code skips the
 * "Do you trust this folder?" dialog on interactive launch.
 * Same flag the CLI writes after you click Trust.
 */
export async function ensureProjectTrusted(cwd) {
  const dir = cwd && fs.existsSync(cwd) ? path.resolve(cwd) : ''
  if (!dir) return { ok: false, reason: 'missing' }

  let data = {}
  try {
    data = JSON.parse(await fsp.readFile(CLAUDE_JSON, 'utf8'))
  } catch (err) {
    if (err && err.code !== 'ENOENT') throw err
    data = {}
  }
  if (!data.projects || typeof data.projects !== 'object') {
    data.projects = {}
  }
  const prev =
    data.projects[dir] && typeof data.projects[dir] === 'object'
      ? data.projects[dir]
      : {}
  if (prev.hasTrustDialogAccepted === true) {
    return { ok: true, path: dir, already: true }
  }
  data.projects[dir] = {
    ...prev,
    hasTrustDialogAccepted: true,
  }
  const tmp = `${CLAUDE_JSON}.${process.pid}.tmp`
  await fsp.writeFile(tmp, JSON.stringify(data, null, 2) + '\n', 'utf8')
  await fsp.rename(tmp, CLAUDE_JSON)
  return { ok: true, path: dir, already: false }
}

export function commandToShell(parts) {
  return parts.map(shellQuote).join(' ')
}

function appPath(name) {
  const home = os.homedir()
  const candidates = [
    `/Applications/${name}.app`,
    path.join(home, 'Applications', `${name}.app`),
    `/System/Applications/Utilities/${name}.app`,
    `/Applications/Utilities/${name}.app`,
  ]
  return candidates.find((p) => fs.existsSync(p)) || ''
}

/**
 * Default: macOS Terminal.app (what most users already have colors set for).
 * Override with CC_DESK_TERMINAL=ghostty|iterm|warp|kitty|alacritty if needed.
 */
export function detectTerminalApp() {
  const preferred = String(process.env.CC_DESK_TERMINAL || '')
    .trim()
    .toLowerCase()
  const catalog = [
    { id: 'terminal', name: 'Terminal' },
    { id: 'ghostty', name: 'Ghostty' },
    { id: 'iterm', name: 'iTerm' },
    { id: 'iterm2', name: 'iTerm2' },
    { id: 'warp', name: 'Warp' },
    { id: 'kitty', name: 'kitty' },
    { id: 'alacritty', name: 'Alacritty' },
  ]
  if (preferred) {
    const hit = catalog.find(
      (t) => t.id === preferred || t.name.toLowerCase() === preferred,
    )
    if (hit) {
      const p = appPath(hit.name)
      if (p) return { ...hit, path: p }
    }
  }

  // Always prefer the stock Terminal.app unless explicitly overridden.
  for (const name of ['Terminal']) {
    const p = appPath(name)
    if (p) return { id: 'terminal', name: 'Terminal', path: p }
  }
  return {
    id: 'terminal',
    name: 'Terminal',
    path: '/System/Applications/Utilities/Terminal.app',
  }
}

/**
 * Login-interactive shell that matches typing `claude` in Terminal.app:
 * source profiles, then exec Claude Code (full TUI + colors).
 */
function buildInteractiveScript({ workDir, commandParts, windowTitle = 'Claude Code' }) {
  const home = os.homedir()
  const cmd = commandToShell(commandParts)
  const title = String(windowTitle || 'Claude Code').slice(0, 80)
  return `#!/bin/zsh -l
# CC Desk → macOS Terminal.app → interactive Claude Code
export HOME=${shellQuote(home)}
# Terminal.app usually sets a real TERM; keep a sensible fallback for colors.
export TERM="\${TERM:-xterm-256color}"
export COLORTERM="\${COLORTERM:-truecolor}"
export FORCE_COLOR=1
export CLICOLOR=1

# Ensure common install locations are on PATH (npm global / Homebrew).
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.npm-global/bin:$HOME/.local/bin:$HOME/bin:$PATH"

cd ${shellQuote(workDir)} || exit 1
printf '\\033]0;%s\\007' ${shellQuote(title)}
exec ${cmd}
`
}

// Terminal returns the new tab's TTY before Claude registers with 'claude agents'.
const startingTabs = new Map()

export function terminalRegistered(sessionId) {
  startingTabs.delete(sessionId)
}

async function findTerminalTab(tty, requireBusy, focus) {
  const script = `
on run argv
  if application "Terminal" is not running then return "missing"
  tell application "Terminal"
    repeat with w in windows
      repeat with t in tabs of w
        if tty of t is (item 1 of argv) and ((item 2 of argv) is "any" or busy of t) then
          if (item 3 of argv) is "inspect" then return "found"
          set selected of t to true
          set miniaturized of w to false
          set index of w to 1
          activate
          return "found"
        end if
      end repeat
    end repeat
  end tell
  return "missing"
end run`
  const { stdout } = await execute('osascript', ['-e', script, '--', tty, requireBusy ? 'busy' : 'any', focus ? 'focus' : 'inspect'])
  return stdout.trim() === 'found'
}

export function focusExistingTerminal(tty, requireBusy = false) {
  return findTerminalTab(tty, requireBusy, true)
}

export async function pendingTerminalTty(sessionId) {
  const tty = startingTabs.get(sessionId)
  if (tty && await findTerminalTab(tty, true, false)) return tty
  return null
}

async function writeTempCommand(scriptBody) {
  const tmp = path.join(
    os.tmpdir(),
    `cc-desk-${Date.now()}-${Math.random().toString(36).slice(2)}.command`,
  )
  await fsp.writeFile(tmp, scriptBody, { mode: 0o755 })
  setTimeout(() => {
    fsp.unlink(tmp).catch(() => {})
  }, 60_000)
  return tmp
}

/**
 * Open an interactive Claude Code TUI in macOS Terminal.app by default.
 */
export async function launchInTerminal({
  cwd,
  commandParts,
  trustCwd = true,
  windowTitle = null,
  sessionId = null,
}) {
  const workDir = cwd && fs.existsSync(cwd) ? cwd : os.homedir()
  const normalized = Array.isArray(commandParts) ? commandParts : ['claude']

  let trust = null
  if (trustCwd) {
    try {
      trust = await ensureProjectTrusted(workDir)
    } catch (err) {
      trust = { ok: false, error: String(err?.message || err) }
    }
  }

  const scriptBody = buildInteractiveScript({
    workDir,
    commandParts: normalized,
    windowTitle: windowTitle || 'Claude Code',
  })
  const tmp = await writeTempCommand(scriptBody)
  const term = detectTerminalApp()

  if (term.id === 'terminal' && sessionId) {
    const script = `
on run argv
  tell application "Terminal"
    set newTab to do script (quoted form of (item 1 of argv))
    activate
    return tty of newTab
  end tell
end run`
    const { stdout } = await execute('osascript', ['-e', script, '--', tmp])
    const tty = stdout.trim()
    startingTabs.set(sessionId, tty)
    setTimeout(() => {
      if (startingTabs.get(sessionId) === tty) startingTabs.delete(sessionId)
    }, 10000).unref()
  } else if (term.id === 'iterm' || term.id === 'iterm2') {
    const cmd = commandToShell(normalized)
    const shellLine = `cd ${shellQuote(workDir)} && exec ${cmd}`
    const script = `
tell application ${JSON.stringify(term.name)}
  activate
  create window with default profile
  tell current session of current window
    write text ${JSON.stringify(shellLine)}
  end tell
end tell`
    try {
      await execute('osascript', ['-e', script])
    } catch {
      await execute('open', ['-a', term.name, tmp])
    }
  } else {
    await execute('open', ['-a', term.name, tmp])
  }

  return {
    ok: true,
    cwd: workDir,
    command: normalized.join(' '),
    claudeBin: normalized[0],
    terminal: term.name,
    trust,
  }
}

/** Derive add-dirs from selected files (unique parent dirs). */
export function dirsFromFiles(files = []) {
  const dirs = new Set()
  for (const f of files) {
    try {
      const st = fs.statSync(f)
      if (st.isDirectory()) dirs.add(path.resolve(f))
      else dirs.add(path.dirname(path.resolve(f)))
    } catch {
      /* skip missing */
    }
  }
  return [...dirs]
}
