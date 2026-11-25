import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { listCcSwitchProviders } from './ccSwitchProviders.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DEFAULT_FILE = path.join(__dirname, '..', 'data', 'providers.json')

let providersFile = process.env.CLAUDE_PANEL_PROVIDERS || DEFAULT_FILE

export function setProvidersFile(filePath) {
  if (filePath) providersFile = filePath
}

/** Derive providers.json next to workspaces.json. */
export function setProvidersFileFromWorkspaces(workspacesFile) {
  if (!workspacesFile) return
  setProvidersFile(path.join(path.dirname(workspacesFile), 'providers.json'))
}

function storePath() {
  return providersFile
}

const MAPPING_STRINGS = [
  'anthropicModel',
  'sonnetModel',
  'sonnetName',
  'opusModel',
  'opusName',
  'fableModel',
  'fableName',
  'haikuModel',
  'haikuName',
  'subagentModel',
]
const MAPPING_BOOLS = [
  'anthropicModel1m',
  'sonnet1m',
  'opus1m',
  'fable1m',
  'haiku1m',
  'subagent1m',
]

function emptyMapping() {
  const out = {}
  for (const k of MAPPING_STRINGS) out[k] = ''
  for (const k of MAPPING_BOOLS) out[k] = false
  return out
}

function pickMapping(raw = {}) {
  const out = emptyMapping()
  for (const k of MAPPING_STRINGS) {
    if (typeof raw[k] === 'string') out[k] = raw[k]
  }
  for (const k of MAPPING_BOOLS) {
    if (typeof raw[k] === 'boolean') out[k] = raw[k]
  }
  return out
}

function hostOf(url) {
  try {
    return new URL(url).host
  } catch {
    return ''
  }
}

function maskKey(key) {
  const s = String(key || '')
  if (!s) return ''
  if (s.length <= 8) return '••••'
  return `${s.slice(0, 4)}…${s.slice(-4)}`
}

/** Normalize any provider-like object into our stored shape. */
export function normalizeProvider(raw = {}, { keepId = true } = {}) {
  const baseUrl = String(raw.baseUrl || '').trim().replace(/\/+$/, '')
  const authField =
    raw.authField === 'ANTHROPIC_API_KEY'
      ? 'ANTHROPIC_API_KEY'
      : 'ANTHROPIC_AUTH_TOKEN'

  return {
    id: keepId && raw.id ? String(raw.id) : randomUUID(),
    name: String(raw.name || '未命名供应商').trim() || '未命名供应商',
    iconColor: String(raw.iconColor || '#C45F40'),
    baseUrl,
    baseHost: hostOf(baseUrl),
    apiKey: String(raw.apiKey || ''),
    apiKeyMasked: maskKey(raw.apiKey || ''),
    authField,
    model: String(raw.model || ''),
    isCurrent: Boolean(raw.isCurrent),
    source: raw.source === 'cc-switch' ? 'cc-switch' : 'local',
    updatedAt: Number(raw.updatedAt) || Date.now(),
    ...pickMapping(raw),
  }
}

function publicProvider(p) {
  return {
    ...p,
    apiKeyMasked: maskKey(p.apiKey),
    baseHost: hostOf(p.baseUrl),
  }
}

async function readStore() {
  const file = storePath()
  try {
    const raw = await fsp.readFile(file, 'utf8')
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') {
      return { bootstrapped: false, importedFromCcSwitchAt: null, providers: [] }
    }
    return {
      bootstrapped: Boolean(parsed.bootstrapped),
      importedFromCcSwitchAt: parsed.importedFromCcSwitchAt || null,
      providers: Array.isArray(parsed.providers)
        ? parsed.providers.map((p) => normalizeProvider(p))
        : [],
    }
  } catch (err) {
    if (err?.code === 'ENOENT') {
      return { bootstrapped: false, importedFromCcSwitchAt: null, providers: [] }
    }
    throw err
  }
}

async function writeStore(store) {
  const file = storePath()
  await fsp.mkdir(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  const payload = {
    bootstrapped: Boolean(store.bootstrapped),
    importedFromCcSwitchAt: store.importedFromCcSwitchAt || null,
    providers: (store.providers || []).map((p) => normalizeProvider(p)),
  }
  await fsp.writeFile(tmp, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
  await fsp.rename(tmp, file)
  return payload
}

/**
 * First run: if local empty & not bootstrapped, copy from CC Switch once.
 * Afterwards always use local file (even if empty).
 */
async function ensureBootstrapped() {
  const store = await readStore()
  if (store.bootstrapped) return store

  const cc = listCcSwitchProviders()
  let providers = store.providers
  let importedFromCcSwitchAt = null
  if (cc.available && cc.providers.length > 0) {
    providers = cc.providers.map((p) =>
      normalizeProvider(
        {
          ...p,
          source: 'cc-switch',
          updatedAt: Date.now(),
        },
        { keepId: true },
      ),
    )
    importedFromCcSwitchAt = Date.now()
  }

  return writeStore({
    bootstrapped: true,
    importedFromCcSwitchAt,
    providers,
  })
}

export async function listLocalProviders() {
  const store = await ensureBootstrapped()
  const cc = listCcSwitchProviders()
  return {
    available: true,
    path: storePath(),
    bootstrapped: true,
    importedFromCcSwitchAt: store.importedFromCcSwitchAt,
    ccSwitchAvailable: Boolean(cc.available),
    ccSwitchPath: cc.path || '',
    ccSwitchCount: cc.providers?.length || 0,
    source: 'local',
    providers: store.providers.map(publicProvider),
  }
}

/** Merge CC Switch providers that are not already in local (by id). Local wins. */
export async function importFromCcSwitch({ replace = false } = {}) {
  const cc = listCcSwitchProviders()
  if (!cc.available) {
    return {
      ok: false,
      error: '未检测到 CC Switch（~/.cc-switch/cc-switch.db）',
      ...((await listLocalProviders())),
    }
  }

  const store = await ensureBootstrapped()
  const incoming = (cc.providers || []).map((p) =>
    normalizeProvider(
      { ...p, source: 'cc-switch', updatedAt: Date.now() },
      { keepId: true },
    ),
  )

  let providers
  let added = 0
  let updated = 0
  if (replace) {
    providers = incoming
    added = incoming.length
  } else {
    const byId = new Map(store.providers.map((p) => [p.id, p]))
    for (const p of incoming) {
      if (byId.has(p.id)) {
        // Local priority: keep existing, do not overwrite
        continue
      }
      byId.set(p.id, p)
      added += 1
    }
    providers = [...byId.values()]
  }

  await writeStore({
    bootstrapped: true,
    importedFromCcSwitchAt: Date.now(),
    providers,
  })

  const listed = await listLocalProviders()
  return {
    ok: true,
    added,
    updated,
    replaced: Boolean(replace),
    ...listed,
  }
}

export async function createProvider(input = {}) {
  const store = await ensureBootstrapped()
  const provider = normalizeProvider(
    {
      ...input,
      id: randomUUID(),
      source: 'local',
      isCurrent: false,
      updatedAt: Date.now(),
    },
    { keepId: true },
  )
  store.providers.unshift(provider)
  await writeStore(store)
  return publicProvider(provider)
}

export async function updateProvider(id, patch = {}) {
  const store = await ensureBootstrapped()
  const idx = store.providers.findIndex((p) => p.id === id)
  if (idx < 0) return null
  const prev = store.providers[idx]
  const next = normalizeProvider(
    {
      ...prev,
      ...patch,
      id: prev.id,
      source: prev.source === 'cc-switch' ? 'cc-switch' : 'local',
      updatedAt: Date.now(),
    },
    { keepId: true },
  )
  store.providers[idx] = next
  await writeStore(store)
  return publicProvider(next)
}

export async function deleteProvider(id) {
  const store = await ensureBootstrapped()
  const next = store.providers.filter((p) => p.id !== id)
  if (next.length === store.providers.length) return false
  await writeStore({ ...store, providers: next })
  return true
}

/** Mark one provider current (by id); clear others. */
export async function markProviderCurrent(id) {
  const store = await ensureBootstrapped()
  let found = false
  store.providers = store.providers.map((p) => {
    const isCurrent = p.id === id
    if (isCurrent) found = true
    return { ...p, isCurrent }
  })
  if (!found) return null
  await writeStore(store)
  return listLocalProviders()
}

export function providersFileExists() {
  return fs.existsSync(storePath())
}

export function getProvidersFilePath() {
  return storePath()
}
