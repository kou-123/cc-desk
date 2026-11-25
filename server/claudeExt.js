/**
 * Claude Code Skills + MCP — read/write the same files the CLI uses.
 * Skills: ~/.claude/skills/<name>/SKILL.md
 * MCP (user scope): ~/.claude.json → mcpServers
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const HOME = os.homedir()
const CLAUDE_DIR = path.join(HOME, '.claude')
const SKILLS_DIR = path.join(CLAUDE_DIR, 'skills')
const CLAUDE_JSON = path.join(HOME, '.claude.json')

const NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/

function assertName(name, label = 'name') {
  const n = String(name || '').trim()
  if (!NAME_RE.test(n)) {
    throw new Error(
      `Invalid ${label}: use letters, numbers, . _ - (max 64 chars)`,
    )
  }
  return n
}

function parseFrontmatter(raw) {
  const text = String(raw || '')
  if (!text.startsWith('---')) {
    return { meta: {}, body: text.trim() }
  }
  const end = text.indexOf('\n---', 3)
  if (end < 0) return { meta: {}, body: text.trim() }
  const fm = text.slice(3, end).trim()
  const body = text.slice(end + 4).replace(/^\s*\n/, '')
  const meta = {}
  for (const line of fm.split('\n')) {
    const m = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/)
    if (!m) continue
    let v = m[2].trim()
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1)
    }
    meta[m[1]] = v
  }
  return { meta, body: body.trim() }
}

function skillTemplate({ name, description, body }) {
  const desc =
    String(description || '').trim() ||
    `Custom skill ${name}. Describe when Claude should use it.`
  const content =
    String(body || '').trim() ||
    `# ${name}\n\nDescribe the workflow this skill should follow.\n`
  return `---\nname: ${name}\ndescription: ${desc.replace(/\n/g, ' ')}\n---\n\n${content}\n`
}

async function readJsonFile(file, fallback) {
  try {
    const raw = await fsp.readFile(file, 'utf8')
    return JSON.parse(raw)
  } catch (err) {
    if (err && (err.code === 'ENOENT' || err instanceof SyntaxError)) {
      return fallback
    }
    throw err
  }
}

async function writeJsonAtomic(file, data) {
  await fsp.mkdir(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  await fsp.writeFile(tmp, JSON.stringify(data, null, 2) + '\n', 'utf8')
  await fsp.rename(tmp, file)
}

async function listSkillDir(dir, scope) {
  const out = []
  let ents
  try {
    ents = await fsp.readdir(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const ent of ents) {
    if (!ent.isDirectory()) continue
    const skillPath = path.join(dir, ent.name, 'SKILL.md')
    try {
      const raw = await fsp.readFile(skillPath, 'utf8')
      const { meta, body } = parseFrontmatter(raw)
      const st = await fsp.stat(skillPath)
      out.push({
        id: ent.name,
        name: meta.name || ent.name,
        description: meta.description || '',
        scope,
        path: skillPath,
        editable: scope === 'user',
        updatedAt: st.mtimeMs,
        preview: body.slice(0, 240),
      })
    } catch {
      /* skip broken skill folders */
    }
  }
  return out
}

/** List personal + a light sample of plugin skills (read-only). */
export async function listSkills() {
  const user = await listSkillDir(SKILLS_DIR, 'user')
  const pluginRoot = path.join(CLAUDE_DIR, 'plugins', 'cache')
  const plugin = []
  try {
    // Keep plugin scan shallow: cache/<marketplace>/<plugin>/<ver>/skills
    const markets = await fsp.readdir(pluginRoot, { withFileTypes: true })
    for (const market of markets) {
      if (!market.isDirectory()) continue
      const marketDir = path.join(pluginRoot, market.name)
      const plugins = await fsp.readdir(marketDir, { withFileTypes: true })
      for (const plug of plugins) {
        if (!plug.isDirectory()) continue
        const versions = await fsp.readdir(path.join(marketDir, plug.name), {
          withFileTypes: true,
        })
        for (const ver of versions) {
          if (!ver.isDirectory()) continue
          const skillsDir = path.join(
            marketDir,
            plug.name,
            ver.name,
            'skills',
          )
          const items = await listSkillDir(skillsDir, 'plugin')
          for (const item of items) {
            plugin.push({
              ...item,
              id: `${plug.name}:${item.id}`,
              plugin: `${market.name}/${plug.name}@${ver.name}`,
            })
          }
        }
      }
    }
  } catch {
    /* no plugins cache */
  }

  user.sort((a, b) => a.name.localeCompare(b.name))
  plugin.sort((a, b) => a.name.localeCompare(b.name))
  return {
    skillsDir: SKILLS_DIR,
    skills: [...user, ...plugin],
    userCount: user.length,
    pluginCount: plugin.length,
  }
}

export async function createSkill(input = {}) {
  const name = assertName(input.name, 'skill name')
  const dir = path.join(SKILLS_DIR, name)
  const file = path.join(dir, 'SKILL.md')
  if (fs.existsSync(file)) {
    throw new Error(`Skill already exists: ${name}`)
  }
  await fsp.mkdir(dir, { recursive: true })
  await fsp.writeFile(
    file,
    skillTemplate({
      name,
      description: input.description,
      body: input.body,
    }),
    'utf8',
  )
  const listed = await listSkills()
  return {
    ok: true,
    skill: listed.skills.find((s) => s.scope === 'user' && s.id === name),
    ...listed,
  }
}

export async function deleteSkill(name) {
  const id = assertName(name, 'skill name')
  const dir = path.join(SKILLS_DIR, id)
  const file = path.join(dir, 'SKILL.md')
  if (!fs.existsSync(file)) {
    throw new Error(`Skill not found: ${id}`)
  }
  await fsp.rm(dir, { recursive: true, force: true })
  return { ok: true, ...(await listSkills()) }
}

function summarizeMcp(name, cfg, scope, projectPath = null) {
  const c = cfg && typeof cfg === 'object' ? cfg : {}
  const type = String(c.type || (c.command ? 'stdio' : c.url ? 'http' : 'unknown'))
  const headers = c.headers && typeof c.headers === 'object' ? c.headers : {}
  const auth = String(headers.Authorization || headers.authorization || '')
  return {
    id: projectPath ? `${scope}:${projectPath}:${name}` : `${scope}:${name}`,
    name,
    scope,
    projectPath,
    type,
    url: c.url || '',
    command: c.command || '',
    args: Array.isArray(c.args) ? c.args : [],
    hasHeaders: Boolean(Object.keys(headers).length),
    hasAuthorization: Boolean(auth),
    hasEnv: Boolean(c.env && Object.keys(c.env).length),
    editable: scope === 'user',
  }
}

function findMcpConfig(claudeJson, name, { scope, projectPath } = {}) {
  const id = String(name || '').trim()
  if (!id) return null

  if (!scope || scope === 'user') {
    const cfg = claudeJson.mcpServers?.[id]
    if (cfg) return { name: id, scope: 'user', projectPath: null, cfg }
  }

  if (!scope || scope === 'local') {
    const projects = claudeJson.projects || {}
    if (projectPath && projects[projectPath]?.mcpServers?.[id]) {
      return {
        name: id,
        scope: 'local',
        projectPath,
        cfg: projects[projectPath].mcpServers[id],
      }
    }
    for (const [p, proj] of Object.entries(projects)) {
      if (proj?.mcpServers?.[id]) {
        return { name: id, scope: 'local', projectPath: p, cfg: proj.mcpServers[id] }
      }
    }
  }

  if (!scope || scope === 'project') {
    const projects = Object.keys(claudeJson.projects || {})
    for (const p of projects.slice(0, 40)) {
      if (projectPath && p !== projectPath) continue
      try {
        const file = path.join(p, '.mcp.json')
        if (!fs.existsSync(file)) continue
        const j = JSON.parse(fs.readFileSync(file, 'utf8'))
        if (j.mcpServers?.[id]) {
          return { name: id, scope: 'project', projectPath: p, cfg: j.mcpServers[id] }
        }
      } catch {
        /* ignore */
      }
    }
  }
  return null
}

function parseMcpRpcBody(text) {
  const t = String(text || '').trim()
  if (!t) return null
  if (t.startsWith('{') || t.startsWith('[')) {
    try {
      return JSON.parse(t)
    } catch {
      /* fall through to SSE */
    }
  }
  let last = null
  for (const line of t.split(/\r?\n/)) {
    if (!line.startsWith('data:')) continue
    const d = line.slice(5).trim()
    if (!d || d === '[DONE]') continue
    try {
      last = JSON.parse(d)
    } catch {
      /* skip */
    }
  }
  return last
}

function buildMcpEntry(input = {}) {
  const transport = String(input.transport || input.type || 'http').toLowerCase()
  if (!['http', 'sse', 'stdio'].includes(transport)) {
    throw new Error('transport must be http, sse, or stdio')
  }

  if (transport === 'stdio') {
    const command = String(input.command || '').trim()
    if (!command) throw new Error('stdio MCP requires a command')
    const args = Array.isArray(input.args)
      ? input.args.map(String)
      : String(input.argsText || '')
          .split(/\s+/)
          .filter(Boolean)
    const entry = { command, args }
    if (input.env && typeof input.env === 'object') entry.env = input.env
    return entry
  }

  const url = String(input.url || '').trim()
  if (!/^https?:\/\//i.test(url)) {
    throw new Error('http/sse MCP requires a valid http(s) URL')
  }
  const entry = { type: transport, url }
  if (input.headers && typeof input.headers === 'object') {
    entry.headers = input.headers
  }
  return entry
}

async function listToolsHttp(cfg, { timeoutMs = 12000 } = {}) {
  const url = String(cfg.url || '').trim()
  if (!url) throw new Error('MCP URL missing')
  const headers = {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
    ...(cfg.headers && typeof cfg.headers === 'object' ? cfg.headers : {}),
  }
  const signal = AbortSignal.timeout(timeoutMs)

  const initRes = await fetch(url, {
    method: 'POST',
    headers,
    signal,
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'cc-desk', version: '0.1.0' },
      },
    }),
  })
  const initText = await initRes.text()
  const initJson = parseMcpRpcBody(initText)
  if (!initRes.ok && initJson?.error) {
    throw new Error(initJson.error.message || 'MCP initialize failed')
  }
  const session =
    initRes.headers.get('mcp-session-id') ||
    initRes.headers.get('Mcp-Session-Id') ||
    ''
  const h = {
    ...headers,
    ...(session ? { 'mcp-session-id': session } : {}),
  }

  try {
    await fetch(url, {
      method: 'POST',
      headers: h,
      signal,
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'notifications/initialized',
      }),
    })
  } catch {
    /* optional */
  }

  const toolsRes = await fetch(url, {
    method: 'POST',
    headers: h,
    signal,
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
      params: {},
    }),
  })
  const toolsJson = parseMcpRpcBody(await toolsRes.text())
  if (toolsJson?.error) {
    throw new Error(toolsJson.error.message || 'tools/list failed')
  }
  const tools = Array.isArray(toolsJson?.result?.tools)
    ? toolsJson.result.tools
    : []
  return {
    tools: tools.map((t) => ({
      name: String(t?.name || ''),
      description: String(t?.description || '').slice(0, 400),
    })).filter((t) => t.name),
    serverInfo: initJson?.result?.serverInfo || null,
    protocolVersion: initJson?.result?.protocolVersion || null,
  }
}

function readStdioJsonLine(buf) {
  const text = buf.toString('utf8')
  const lines = text.split(/\r?\n/)
  const msgs = []
  let rest = ''
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (i === lines.length - 1 && !text.endsWith('\n')) {
      rest = line
      break
    }
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      msgs.push(JSON.parse(trimmed))
    } catch {
      /* ignore non-json noise */
    }
  }
  return { msgs, rest }
}

async function listToolsStdio(cfg, { timeoutMs = 12000 } = {}) {
  const command = String(cfg.command || '').trim()
  if (!command) throw new Error('stdio MCP requires a command')
  const args = Array.isArray(cfg.args) ? cfg.args.map(String) : []
  const env = {
    ...process.env,
    ...(cfg.env && typeof cfg.env === 'object' ? cfg.env : {}),
  }

  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let settled = false
    let stdout = Buffer.alloc(0)
    const tools = []
    let serverInfo = null
    let protocolVersion = null
    let nextId = 1

    const finish = (err, value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try {
        child.kill('SIGTERM')
      } catch {
        /* ignore */
      }
      if (err) reject(err)
      else resolve(value)
    }

    const timer = setTimeout(() => {
      finish(new Error('stdio MCP tools/list timed out'))
    }, timeoutMs)

    const send = (msg) => {
      child.stdin.write(JSON.stringify(msg) + '\n')
    }

    child.on('error', (err) => finish(err))
    child.stderr.on('data', () => {})
    child.stdout.on('data', (chunk) => {
      stdout = Buffer.concat([stdout, chunk])
      const parsed = readStdioJsonLine(stdout)
      stdout = Buffer.from(parsed.rest)
      for (const msg of parsed.msgs) {
        if (msg.id === 1 && msg.result) {
          serverInfo = msg.result.serverInfo || null
          protocolVersion = msg.result.protocolVersion || null
          send({ jsonrpc: '2.0', method: 'notifications/initialized' })
          send({
            jsonrpc: '2.0',
            id: 2,
            method: 'tools/list',
            params: {},
          })
        } else if (msg.id === 2) {
          if (msg.error) {
            finish(new Error(msg.error.message || 'tools/list failed'))
            return
          }
          const list = Array.isArray(msg.result?.tools) ? msg.result.tools : []
          for (const t of list) {
            if (!t?.name) continue
            tools.push({
              name: String(t.name),
              description: String(t.description || '').slice(0, 400),
            })
          }
          finish(null, { tools, serverInfo, protocolVersion })
        }
      }
    })

    send({
      jsonrpc: '2.0',
      id: nextId++,
      method: 'initialize',
      params: {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'cc-desk', version: '0.1.0' },
      },
    })
  })
}

/** Probe an MCP server and return its tool list (no secrets in response). */
export async function getMcpServerTools(name, opts = {}) {
  const claudeJson = await readJsonFile(CLAUDE_JSON, {})
  const found = findMcpConfig(claudeJson, name, opts)
  if (!found) throw new Error(`MCP server not found: ${name}`)
  const type = String(
    found.cfg.type ||
      (found.cfg.command ? 'stdio' : found.cfg.url ? 'http' : 'unknown'),
  )
  let probed
  if (type === 'stdio') {
    probed = await listToolsStdio(found.cfg)
  } else if (type === 'http' || type === 'sse') {
    probed = await listToolsHttp(found.cfg)
  } else {
    throw new Error(`Unsupported MCP transport: ${type}`)
  }
  return {
    ok: true,
    name: found.name,
    scope: found.scope,
    projectPath: found.projectPath,
    type,
    toolCount: probed.tools.length,
    tools: probed.tools,
    serverInfo: probed.serverInfo,
    protocolVersion: probed.protocolVersion,
  }
}

/** Editable detail for a user-scoped MCP (secrets masked). */
export async function getMcpServerDetail(name) {
  const id = assertName(name, 'MCP name')
  const claudeJson = await readJsonFile(CLAUDE_JSON, {})
  const found = findMcpConfig(claudeJson, id, { scope: 'user' })
  if (!found || found.scope !== 'user') {
    // Still allow read-only detail for local/project by name
    const any = findMcpConfig(claudeJson, id)
    if (!any) throw new Error(`MCP server not found: ${id}`)
    return {
      ok: true,
      server: summarizeMcp(any.name, any.cfg, any.scope, any.projectPath),
      editable: false,
      headerAuth: '',
    }
  }
  const headers =
    found.cfg.headers && typeof found.cfg.headers === 'object'
      ? found.cfg.headers
      : {}
  const auth = String(headers.Authorization || headers.authorization || '')
  return {
    ok: true,
    server: summarizeMcp(found.name, found.cfg, found.scope, found.projectPath),
    editable: true,
    // Never return the raw token — only whether one exists + a placeholder for forms.
    headerAuth: auth ? 'Bearer ••••••••' : '',
    hasAuthorization: Boolean(auth),
  }
}

export async function listMcpServers() {
  const claudeJson = await readJsonFile(CLAUDE_JSON, {})
  const user = []
  const servers = claudeJson.mcpServers || {}
  for (const [name, cfg] of Object.entries(servers)) {
    user.push(summarizeMcp(name, cfg, 'user'))
  }

  const project = []
  const projects = claudeJson.projects || {}
  for (const [projectPath, proj] of Object.entries(projects)) {
    const local = proj?.mcpServers || {}
    for (const [name, cfg] of Object.entries(local)) {
      project.push(summarizeMcp(name, cfg, 'local', projectPath))
    }
  }

  // Project-shared .mcp.json near known project roots (best-effort, capped)
  const shared = []
  const seen = new Set()
  for (const projectPath of Object.keys(projects).slice(0, 40)) {
    const file = path.join(projectPath, '.mcp.json')
    if (seen.has(file) || !fs.existsSync(file)) continue
    seen.add(file)
    try {
      const j = JSON.parse(await fsp.readFile(file, 'utf8'))
      const block = j.mcpServers || {}
      for (const [name, cfg] of Object.entries(block)) {
        shared.push(summarizeMcp(name, cfg, 'project', projectPath))
      }
    } catch {
      /* ignore */
    }
  }

  user.sort((a, b) => a.name.localeCompare(b.name))
  project.sort((a, b) => a.name.localeCompare(b.name))
  shared.sort((a, b) => a.name.localeCompare(b.name))
  return {
    claudeJsonPath: CLAUDE_JSON,
    servers: [...user, ...project, ...shared],
    userCount: user.length,
    localCount: project.length,
    projectCount: shared.length,
  }
}

export async function addMcpServer(input = {}) {
  const name = assertName(input.name, 'MCP name')
  const entry = buildMcpEntry(input)

  const claudeJson = await readJsonFile(CLAUDE_JSON, {})
  if (!claudeJson.mcpServers || typeof claudeJson.mcpServers !== 'object') {
    claudeJson.mcpServers = {}
  }
  if (claudeJson.mcpServers[name]) {
    throw new Error(`MCP server already exists: ${name}`)
  }
  claudeJson.mcpServers[name] = entry
  await writeJsonAtomic(CLAUDE_JSON, claudeJson)
  return { ok: true, ...(await listMcpServers()) }
}

export async function updateMcpServer(name, input = {}) {
  const id = assertName(name, 'MCP name')
  const claudeJson = await readJsonFile(CLAUDE_JSON, {})
  const existing = claudeJson.mcpServers?.[id]
  if (!existing) {
    throw new Error(`User-scoped MCP not found: ${id}`)
  }

  const nextNameRaw = String(input.name || id).trim()
  const nextName = assertName(nextNameRaw, 'MCP name')
  if (nextName !== id && claudeJson.mcpServers[nextName]) {
    throw new Error(`MCP server already exists: ${nextName}`)
  }

  // Preserve Authorization unless the client sent a real new token
  // (placeholders like "••••" must not overwrite the saved secret).
  const prevHeaders =
    existing.headers && typeof existing.headers === 'object'
      ? { ...existing.headers }
      : {}
  const incoming =
    input.headers && typeof input.headers === 'object' ? { ...input.headers } : {}
  const authIn = String(incoming.Authorization || incoming.authorization || '').trim()
  const looksMasked =
    !authIn ||
    /•|…|\.{3,}|x{4,}|placeholder/i.test(authIn) ||
    authIn === 'Bearer' ||
    /^Bearer\s*•/i.test(authIn)

  const mergedHeaders = { ...prevHeaders }
  for (const [k, v] of Object.entries(incoming)) {
    if (/^authorization$/i.test(k)) continue
    mergedHeaders[k] = v
  }
  if (!looksMasked) {
    mergedHeaders.Authorization = authIn.startsWith('Bearer ')
      ? authIn
      : `Bearer ${authIn}`
  } else if (!Object.keys(prevHeaders).length && !authIn) {
    // no auth kept
  }

  const transport = String(
    input.transport ||
      input.type ||
      existing.type ||
      (existing.command ? 'stdio' : 'http'),
  ).toLowerCase()

  const entry = buildMcpEntry({
    ...input,
    transport,
    url: input.url ?? existing.url,
    command: input.command ?? existing.command,
    args: input.args ?? existing.args,
    argsText:
      input.argsText ??
      (Array.isArray(existing.args) ? existing.args.join(' ') : ''),
    headers:
      transport === 'stdio'
        ? undefined
        : Object.keys(mergedHeaders).length
          ? mergedHeaders
          : undefined,
    env: input.env ?? existing.env,
  })

  delete claudeJson.mcpServers[id]
  claudeJson.mcpServers[nextName] = entry
  await writeJsonAtomic(CLAUDE_JSON, claudeJson)
  return { ok: true, ...(await listMcpServers()) }
}

export async function removeMcpServer(name) {
  const id = assertName(name, 'MCP name')
  const claudeJson = await readJsonFile(CLAUDE_JSON, {})
  if (!claudeJson.mcpServers?.[id]) {
    throw new Error(`User-scoped MCP not found: ${id}`)
  }
  delete claudeJson.mcpServers[id]
  await writeJsonAtomic(CLAUDE_JSON, claudeJson)
  return { ok: true, ...(await listMcpServers()) }
}
