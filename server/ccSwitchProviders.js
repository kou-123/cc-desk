import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { readMappingFromEnv } from './modelMapping.js'

const DB_PATH = path.join(os.homedir(), '.cc-switch', 'cc-switch.db')

function pickAuth(env = {}) {
  if (env.ANTHROPIC_AUTH_TOKEN) {
    return { field: 'ANTHROPIC_AUTH_TOKEN', value: String(env.ANTHROPIC_AUTH_TOKEN) }
  }
  if (env.ANTHROPIC_API_KEY) {
    return { field: 'ANTHROPIC_API_KEY', value: String(env.ANTHROPIC_API_KEY) }
  }
  return { field: 'ANTHROPIC_AUTH_TOKEN', value: '' }
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

function parseConfig(raw) {
  try {
    const cfg = typeof raw === 'string' ? JSON.parse(raw) : raw
    return cfg && typeof cfg === 'object' ? cfg : {}
  } catch {
    return {}
  }
}

function toProvider(row) {
  const cfg = parseConfig(row.settings_config)
  const env = cfg.env && typeof cfg.env === 'object' ? cfg.env : {}
  const auth = pickAuth(env)
  const baseUrl = env.ANTHROPIC_BASE_URL || ''
  return {
    id: row.id,
    name: row.name || row.id,
    isCurrent: Boolean(row.is_current),
    icon: row.icon || '',
    iconColor: row.icon_color || '#888888',
    category: row.category || '',
    websiteUrl: row.website_url || '',
    baseUrl,
    baseHost: hostOf(baseUrl),
    apiKey: auth.value,
    apiKeyMasked: maskKey(auth.value),
    authField: auth.field,
    model: cfg.model || '',
    ...readMappingFromEnv(env),
  }
}

/** Read Claude providers configured in CC Switch (read-only). */
export function listCcSwitchProviders() {
  if (!fs.existsSync(DB_PATH)) {
    return {
      available: false,
      path: DB_PATH,
      providers: [],
    }
  }

  let db
  try {
    db = new DatabaseSync(DB_PATH, { readOnly: true })
    const rows = db
      .prepare(
        `SELECT id, name, is_current, icon, icon_color, category, website_url, settings_config, sort_index
         FROM providers
         WHERE app_type = 'claude'
         ORDER BY is_current DESC, COALESCE(sort_index, 9999) ASC, name COLLATE NOCASE ASC`,
      )
      .all()
    return {
      available: true,
      path: DB_PATH,
      providers: rows.map(toProvider),
    }
  } catch (err) {
    return {
      available: false,
      path: DB_PATH,
      providers: [],
      error: String(err?.message || err),
    }
  } finally {
    try {
      db?.close()
    } catch {
      /* ignore */
    }
  }
}
