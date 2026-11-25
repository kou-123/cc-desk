import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { launchInTerminal } from './launch.js'

export const CLAUDE_UPDATE_CMD =
  'npm install -g @anthropic-ai/claude-code@latest'

/** GUI apps (Electron) often miss shell PATH — include common npm global bins. */
export function enrichedEnv() {
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

function platformNativeName() {
  const { platform, arch } = process
  if (platform === 'darwin' && arch === 'arm64') return 'claude-code-darwin-arm64'
  if (platform === 'darwin' && arch === 'x64') return 'claude-code-darwin-x64'
  if (platform === 'linux' && arch === 'arm64') return 'claude-code-linux-arm64'
  if (platform === 'linux' && arch === 'x64') return 'claude-code-linux-x64'
  if (platform === 'win32' && arch === 'arm64') return 'claude-code-win32-arm64'
  if (platform === 'win32') return 'claude-code-win32-x64'
  return ''
}

/** Prefer the real native binary over the npm stub (bin/claude.exe). */
function nativeBinInPackage(pkgDir) {
  const name = platformNativeName()
  if (!name) return ''
  return path.join(
    pkgDir,
    'node_modules',
    '@anthropic-ai',
    name,
    process.platform === 'win32' ? 'claude.exe' : 'claude',
  )
}

function isUsableBin(bin) {
  try {
    if (!bin || !fs.existsSync(bin)) return false
    const st = fs.statSync(bin)
    if (!st.isFile() && !st.isSymbolicLink()) return false
    // Reject the tiny npm stub that only prints install errors.
    if (st.size > 0 && st.size < 2048) {
      const head = fs.readFileSync(bin, 'utf8')
      if (head.includes('claude native binary not installed')) return false
    }
    return true
  } catch {
    return false
  }
}

/** Prefer binaries that Node can actually spawn (some installs leave a broken native). */
async function canSpawnBin(bin) {
  if (!isUsableBin(bin)) return false
  const probe = await run(bin, ['--version'], { timeoutMs: 6000 })
  return probe.ok || /claude|anthropic|\d+\.\d+/i.test(probe.out + probe.err)
}

/** Reject bins Node cannot spawn (e.g. truncated native installs → errno -88). */
async function isSpawnableBin(bin) {
  if (!isUsableBin(bin)) return false
  const probe = await run(bin, ['--version'], { timeoutMs: 6000 })
  if (probe.ok) return true
  // Some builds print version on stderr; treat that as success if we parsed digits.
  if (parseVersion(probe.out || probe.err)) return true
  // Spawn syscall failure surfaces as err message from child 'error' event.
  const msg = String(probe.err || '')
  if (/spawn|Unknown system error|ENOENT|EACCES/i.test(msg) && !probe.out) {
    return false
  }
  // Timed out / non-zero without version — still may work for chat; keep candidate.
  return probe.code !== -1 || Boolean(probe.out || probe.err)
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

export async function resolveClaudeBin() {
  const tried = new Set()
  async function pick(bin) {
    const key = bin || ''
    if (!key || tried.has(key)) return ''
    tried.add(key)
    return (await canSpawnBin(key)) ? key : ''
  }

  // 1) which with enriched PATH
  const which = await run('which', ['claude'])
  const fromWhich = which.ok ? which.out.trim().split('\n')[0] : ''
  {
    const hit = await pick(fromWhich)
    if (hit) return hit
  }

  // 2) well-known install locations
  for (const p of candidateBins()) {
    const hit = await pick(p)
    if (hit) return hit
  }

  // 3) login shell (picks up zshrc/bashrc PATH)
  const shell = process.env.SHELL || '/bin/zsh'
  const login = await run(shell, ['-ilc', 'command -v claude'], {
    timeoutMs: 12000,
  })
  const fromLogin = login.ok ? login.out.trim().split('\n')[0] : ''
  {
    const hit = await pick(fromLogin)
    if (hit) return hit
  }

  // 4) npm global package — prefer packaged bin/claude.exe, then platform-native
  const root = await run('npm', ['root', '-g'])
  if (root.ok) {
    const scope = path.join(root.out.trim(), '@anthropic-ai')
    const entries = await fs.promises.readdir(scope).catch(() => [])
    const backups = entries.filter((name) => name.startsWith('.claude-code-'))
    for (const name of ['claude-code', ...backups]) {
      const dir = path.join(scope, name)
      try {
        const pkg = JSON.parse(
          await fs.promises.readFile(path.join(dir, 'package.json'), 'utf8'),
        )
        if (pkg.name !== '@anthropic-ai/claude-code' || !pkg.bin?.claude) continue
        const packaged = path.resolve(dir, pkg.bin.claude)
        const hit = await pick(packaged)
        if (hit) return hit
      } catch {
        // Try the next npm installation.
      }
      {
        const hit = await pick(nativeBinInPackage(dir))
        if (hit) return hit
      }
    }
  }
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
