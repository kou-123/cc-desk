import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  MAPPING_ENV_KEYS,
  applyMappingPatch,
  readMappingFromEnv,
} from './modelMapping.js'

const SETTINGS_PATH = path.join(os.homedir(), '.claude', 'settings.json')

const ENV_KEYS = [
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_API_KEY',
  ...MAPPING_ENV_KEYS,
]

async function readRaw() {
  try {
    const raw = await fsp.readFile(SETTINGS_PATH, 'utf8')
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch (err) {
    if (err?.code === 'ENOENT') return {}
    throw err
  }
}

function pickAuth(env = {}) {
  if (env.ANTHROPIC_AUTH_TOKEN) {
    return { field: 'ANTHROPIC_AUTH_TOKEN', value: env.ANTHROPIC_AUTH_TOKEN }
  }
  if (env.ANTHROPIC_API_KEY) {
    return { field: 'ANTHROPIC_API_KEY', value: env.ANTHROPIC_API_KEY }
  }
  return { field: 'ANTHROPIC_AUTH_TOKEN', value: '' }
}

/** Public view of Claude Code connection settings. */
export async function getClaudeSettings() {
  const settings = await readRaw()
  const env = settings.env && typeof settings.env === 'object' ? settings.env : {}
  const auth = pickAuth(env)
  const mapping = readMappingFromEnv(env)
  return {
    path: SETTINGS_PATH,
    exists: fs.existsSync(SETTINGS_PATH),
    baseUrl: env.ANTHROPIC_BASE_URL || '',
    apiKey: auth.value || '',
    authField: auth.field,
    model: settings.model || '',
    ...mapping,
  }
}

/**
 * Merge connection fields into ~/.claude/settings.json.
 * Does not touch permissions / hooks / plugins / theme.
 */
export async function updateClaudeSettings(patch = {}) {
  const settings = await readRaw()
  if (!settings.env || typeof settings.env !== 'object') settings.env = {}

  const env = { ...settings.env }
  const authField =
    patch.authField === 'ANTHROPIC_API_KEY'
      ? 'ANTHROPIC_API_KEY'
      : 'ANTHROPIC_AUTH_TOKEN'

  if (typeof patch.baseUrl === 'string') {
    const v = patch.baseUrl.trim()
    if (v) env.ANTHROPIC_BASE_URL = v.replace(/\/+$/, '')
    else delete env.ANTHROPIC_BASE_URL
  }

  if (typeof patch.apiKey === 'string') {
    const v = patch.apiKey.trim()
    delete env.ANTHROPIC_AUTH_TOKEN
    delete env.ANTHROPIC_API_KEY
    if (v) env[authField] = v
  }

  if (typeof patch.model === 'string') {
    const v = patch.model.trim()
    if (v) settings.model = v
    else delete settings.model
  }

  applyMappingPatch(env, patch)

  for (const k of ENV_KEYS) {
    if (env[k] === '') delete env[k]
  }

  settings.env = env

  const dir = path.dirname(SETTINGS_PATH)
  await fsp.mkdir(dir, { recursive: true })
  const tmp = `${SETTINGS_PATH}.${process.pid}.tmp`
  await fsp.writeFile(tmp, `${JSON.stringify(settings, null, 2)}\n`, 'utf8')
  await fsp.rename(tmp, SETTINGS_PATH)

  return getClaudeSettings()
}
