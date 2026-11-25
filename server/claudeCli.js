import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { launchInTerminal } from './launch.js'

export const CLAUDE_UPDATE_CMD =
  'npm install -g @anthropic-ai/claude-code@latest'

/** GUI apps (Electron) often miss shell PATH — include common npm global bins. */
function enrichedEnv() {
  const home = os.homedir()
  const extras = [
    path.join(home, '.npm-global', 'bin'),
    path.join(home, '.local', 'bin'),
    path.join(home, 'bin'),
    '/opt/homebrew/bin',
    '/usr/local/bin',
  ]
  const current = process.env.PATH || ''
  const parts = [...extras, ...current.split(':').filter(Boolean)]
  const seen = new Set()
  const pathValue = parts
    .filter((p) => {
      if (!p || seen.has(p)) return false
      seen.add(p)
      return true
    })
    .join(':')
  return { ...process.env, PATH: pathValue, HOME: home }
}

function run(cmd, args, { timeoutMs = 8000, env = enrichedEnv() } = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let out = ''
    let err = ''
    const timer = setTimeout(() => {
      try {
        child.kill('SIGKILL')
      } catch {
        /* ignore */
      }
      resolve({ ok: false, out, err: err || 'timeout', code: -1 })
    }, timeoutMs)
    child.stdout?.on('data', (b) => {
      out += String(b)
    })
    child.stderr?.on('data', (b) => {
      err += String(b)
    })
    child.on('error', (e) => {
      clearTimeout(timer)
      resolve({ ok: false, out, err: String(e.message || e), code: -1 })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ ok: code === 0, out, err, code: code ?? -1 })
    })
  })
}

function parseVersion(text) {
  const s = String(text || '').trim()
  if (!s) return ''
  const m = s.match(/(\d+\.\d+\.\d+(?:-[^\s)]+)?)/)
  return m ? m[1] : s.split('\n')[0].trim()
}

function candidateBins() {
  const home = os.homedir()
  return [
    path.join(home, '.npm-global', 'bin', 'claude'),
    path.join(home, '.local', 'bin', 'claude'),
    path.join(home, 'bin', 'claude'),
    '/opt/homebrew/bin/claude',
    '/usr/local/bin/claude',
  ]
}

async function resolveClaudeBin() {
  // 1) which with enriched PATH
  const which = await run('which', ['claude'])
  const fromWhich = which.ok ? which.out.trim().split('\n')[0] : ''
  if (fromWhich && fs.existsSync(fromWhich)) return fromWhich

  // 2) well-known install locations
  for (const p of candidateBins()) {
    try {
      if (fs.existsSync(p)) return p
    } catch {
      /* ignore */
    }
  }

  // 3) login shell (picks up zshrc/bashrc PATH)
  const shell = process.env.SHELL || '/bin/zsh'
  const login = await run(shell, ['-ilc', 'command -v claude'], {
    timeoutMs: 12000,
  })
  const fromLogin = login.ok ? login.out.trim().split('\n')[0] : ''
  if (fromLogin && fs.existsSync(fromLogin)) return fromLogin

  return ''
}

/** Detect local Claude Code CLI install + version. */
export async function getClaudeCliInfo() {
  const bin = await resolveClaudeBin()

  let version = ''
  let raw = ''
  if (bin) {
    const ver = await run(bin, ['--version'])
    raw = (ver.out || ver.err || '').trim()
    version = parseVersion(raw)
  }

  return {
    installed: Boolean(bin),
    bin: bin || null,
    version: version || null,
    raw: raw || null,
    updateCommand: CLAUDE_UPDATE_CMD,
  }
}

/** Open Terminal.app and run the official global update command. */
export async function launchClaudeUpdate() {
  return launchInTerminal({
    cwd: process.env.HOME || os.homedir(),
    commandParts: ['npm', 'install', '-g', '@anthropic-ai/claude-code@latest'],
  })
}
