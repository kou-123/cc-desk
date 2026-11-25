import fsp from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DEFAULT_DATA_FILE = path.join(__dirname, '..', 'data', 'workspaces.json')

let dataFile = process.env.CLAUDE_PANEL_DATA || DEFAULT_DATA_FILE

export function setDataFile(filePath) {
  dataFile = filePath
}

function storePath() {
  return dataFile
}

async function ensureStore() {
  const file = storePath()
  try {
    await fsp.access(file)
  } catch {
    await fsp.mkdir(path.dirname(file), { recursive: true })
    // Seed from project default if present
    try {
      const seed = await fsp.readFile(DEFAULT_DATA_FILE, 'utf8')
      await fsp.writeFile(file, seed, 'utf8')
    } catch {
      await fsp.writeFile(file, '[]\n', 'utf8')
    }
  }
}

export async function listWorkspaces() {
  await ensureStore()
  const raw = await fsp.readFile(storePath(), 'utf8')
  try {
    const data = JSON.parse(raw)
    return Array.isArray(data) ? data : []
  } catch {
    return []
  }
}

async function saveAll(list) {
  await ensureStore()
  await fsp.writeFile(storePath(), `${JSON.stringify(list, null, 2)}\n`, 'utf8')
}

export async function createWorkspace(input) {
  const list = await listWorkspaces()
  const now = Date.now()
  const ws = {
    id: randomUUID(),
    name: String(input.name || 'Untitled').trim() || 'Untitled',
    cwd: input.cwd ? path.resolve(input.cwd) : null,
    addDirs: Array.isArray(input.addDirs)
      ? [...new Set(input.addDirs.map((d) => path.resolve(d)))]
      : [],
    files: Array.isArray(input.files)
      ? [...new Set(input.files.map((f) => path.resolve(f)))]
      : [],
    note: input.note || '',
    createdAt: now,
    updatedAt: now,
  }
  list.unshift(ws)
  await saveAll(list)
  return ws
}

export async function updateWorkspace(id, patch) {
  const list = await listWorkspaces()
  const idx = list.findIndex((w) => w.id === id)
  if (idx < 0) return null
  const prev = list[idx]
  const next = {
    ...prev,
    ...patch,
    id: prev.id,
    createdAt: prev.createdAt,
    updatedAt: Date.now(),
  }
  if (patch.name != null) next.name = String(patch.name).trim() || prev.name
  if (patch.cwd != null) next.cwd = patch.cwd ? path.resolve(patch.cwd) : null
  if (patch.addDirs != null) {
    next.addDirs = [...new Set(patch.addDirs.map((d) => path.resolve(d)))]
  }
  if (patch.files != null) {
    next.files = [...new Set(patch.files.map((f) => path.resolve(f)))]
  }
  list[idx] = next
  await saveAll(list)
  return next
}

export async function deleteWorkspace(id) {
  const list = await listWorkspaces()
  const next = list.filter((w) => w.id !== id)
  if (next.length === list.length) return false
  await saveAll(next)
  return true
}
