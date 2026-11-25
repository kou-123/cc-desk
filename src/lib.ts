import type { Session, Workspace } from './api'

export function basename(p: string | null | undefined) {
  if (!p) return ''
  const parts = p.replace(/\\/g, '/').split('/').filter(Boolean)
  return parts[parts.length - 1] || p
}

export function sessionTitle(s: Session) {
  if (s.name?.trim()) return s.name.trim()
  const preview = (s.preview || '').trim()
  if (
    preview &&
    preview !== '(empty session)' &&
    !preview.startsWith('<local-command') &&
    !preview.startsWith('<command-')
  ) {
    return preview.length > 42 ? `${preview.slice(0, 41)}…` : preview
  }
  // Prefer project folder name over raw session id
  const folder = basename(s.cwd)
  if (folder) return folder
  return `会话 ${s.id.slice(0, 8)}`
}

export function pathUnder(root: string | null, target: string | null) {
  if (!root || !target) return false
  const a = root.replace(/\\/g, '/').replace(/\/+$/, '')
  const b = target.replace(/\\/g, '/').replace(/\/+$/, '')
  return b === a || b.startsWith(`${a}/`)
}

export type ProjectNode = {
  key: string
  name: string
  workspace: Workspace | null
  cwd: string | null
  addDirs: string[]
  sessions: Session[]
}

/** Merge saved workspaces with auto-discovered project roots from sessions. */
export function buildProjects(
  sessions: Session[],
  workspaces: Workspace[],
): ProjectNode[] {
  const used = new Set<string>()
  const nodes: ProjectNode[] = []

  for (const ws of workspaces) {
    const roots = [ws.cwd, ...(ws.addDirs || [])].filter(Boolean) as string[]
    const matched = sessions.filter((s) =>
      roots.some((r) => pathUnder(r, s.cwd)),
    )
    matched.forEach((s) => used.add(s.id))
    nodes.push({
      key: `ws:${ws.id}`,
      name: ws.name,
      workspace: ws,
      cwd: ws.cwd,
      addDirs: ws.addDirs || [],
      sessions: matched.sort((a, b) => b.lastActivity - a.lastActivity),
    })
  }

  const byCwd = new Map<string, Session[]>()
  for (const s of sessions) {
    if (used.has(s.id)) continue
    const cwd = s.cwd || `unknown:${s.projectKey}`
    if (!byCwd.has(cwd)) byCwd.set(cwd, [])
    byCwd.get(cwd)!.push(s)
  }

  const autoNodes: ProjectNode[] = []
  for (const [cwd, list] of byCwd) {
    list.sort((a, b) => b.lastActivity - a.lastActivity)
    autoNodes.push({
      key: `auto:${cwd}`,
      name: basename(cwd) || 'untitled',
      workspace: null,
      cwd: cwd.startsWith('unknown:') ? null : cwd,
      addDirs: [],
      sessions: list,
    })
  }
  // Saved workspaces keep add order (API list is newest-first).
  // Auto-discovered roots stay after them, A–Z — never bump by chat activity.
  autoNodes.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
  return [...nodes, ...autoNodes]
}

export function recentSessions(sessions: Session[], n = 8) {
  return [...sessions]
    .sort((a, b) => b.lastActivity - a.lastActivity)
    .slice(0, n)
}

/** Unique project roots from sessions + workspaces, for “Add to workspace”. */
export function collectKnownRoots(
  sessions: Session[],
  workspaces: Workspace[],
): { path: string; label: string }[] {
  const map = new Map<string, string>()
  for (const s of sessions) {
    if (!s.cwd) continue
    if (!map.has(s.cwd)) map.set(s.cwd, basename(s.cwd) || s.cwd)
  }
  for (const ws of workspaces) {
    if (ws.cwd && !map.has(ws.cwd)) {
      map.set(ws.cwd, ws.name || basename(ws.cwd))
    }
    for (const d of ws.addDirs || []) {
      if (d && !map.has(d)) map.set(d, basename(d) || d)
    }
  }
  return [...map.entries()]
    .map(([path, label]) => ({ path, label }))
    .sort((a, b) => a.label.localeCompare(b.label))
}
