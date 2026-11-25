import { spawn } from 'node:child_process'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

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
  // Prefer the bare `claude` name so a login shell resolves the same binary
  // the user gets when they type `claude` themselves (PATH + wrappers).
  const bin =
    claudeBin && path.isAbsolute(claudeBin) ? 'claude' : claudeBin || 'claude'
  const parts = [bin]
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
function buildInteractiveScript({ workDir, commandParts }) {
  const home = os.homedir()
  const cmd = commandToShell(commandParts)
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
printf '\\033]0;Claude Code\\007'
exec ${cmd}
`
}

function runDetached(bin, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      stdio: 'ignore',
      detached: true,
    })
    child.unref()
    child.on('error', reject)
    child.on('spawn', () => resolve())
    setTimeout(() => resolve(), 800)
  })
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
export async function launchInTerminal({ cwd, commandParts, trustCwd = true }) {
  const workDir = cwd && fs.existsSync(cwd) ? cwd : os.homedir()
  const parts = Array.isArray(commandParts) ? [...commandParts] : ['claude']
  const normalized = [...parts]
  if (normalized[0] && path.isAbsolute(normalized[0])) {
    normalized[0] = 'claude'
  }

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
  })
  const tmp = await writeTempCommand(scriptBody)
  const term = detectTerminalApp()

  if (term.id === 'terminal') {
    // Explicitly open with Terminal.app so we never pick Ghostty as the
    // default handler for .command files.
    await runDetached('open', ['-a', 'Terminal', tmp])
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
      await runDetached('osascript', ['-e', script])
    } catch {
      await runDetached('open', ['-a', term.name, tmp])
    }
  } else {
    await runDetached('open', ['-a', term.name, tmp])
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
