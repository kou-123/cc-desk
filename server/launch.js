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
  extraArgs = [],
}) {
  const parts = ['claude']
  if (sessionId) {
    parts.push('--resume', sessionId)
  }
  if (name && !sessionId) {
    parts.push('--name', name)
  }
  for (const dir of addDirs) {
    if (dir) {
      parts.push('--add-dir', dir)
    }
  }
  parts.push(...extraArgs)
  return parts
}

export function commandToShell(parts) {
  return parts.map(shellQuote).join(' ')
}

/** Open Terminal.app via a temporary .command launcher (reliable escaping). */
export async function launchInTerminal({ cwd, commandParts }) {
  const workDir = cwd && fs.existsSync(cwd) ? cwd : os.homedir()
  const cmd = commandToShell(commandParts)
  const scriptBody = `#!/bin/zsh
cd ${shellQuote(workDir)} || exit 1
echo "→ ${cmd}"
echo ""
exec ${cmd}
`

  const tmp = path.join(
    os.tmpdir(),
    `claude-panel-${Date.now()}-${Math.random().toString(36).slice(2)}.command`,
  )
  await fsp.writeFile(tmp, scriptBody, { mode: 0o755 })

  await new Promise((resolve, reject) => {
    const child = spawn('open', [tmp], {
      stdio: 'ignore',
      detached: true,
    })
    child.on('error', reject)
    child.on('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`open exited ${code}`))
    })
  })

  // Best-effort cleanup later
  setTimeout(() => {
    fsp.unlink(tmp).catch(() => {})
  }, 30_000)

  return {
    ok: true,
    cwd: workDir,
    command: commandParts.join(' '),
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
