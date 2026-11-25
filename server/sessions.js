import { spawn } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const CLAUDE_HOME = path.join(os.homedir(), '.claude')
const PROJECTS_DIR = path.join(CLAUDE_HOME, 'projects')
const HISTORY_FILE = path.join(CLAUDE_HOME, 'history.jsonl')
/** Cached decoded transcript images for the UI. */
export const MEDIA_ROOT = path.join(os.tmpdir(), 'claude-panel-media')

/** Decode Claude's project folder name back to a filesystem path. */
export function decodeProjectDir(encoded) {
  if (!encoded.startsWith('-')) return encoded
  // Folders look like: -Users-name-code-workspace-foo
  // We cannot uniquely reverse '-' vs '/', so prefer matching real paths
  // via history / cwd fields when available.
  return encoded.replace(/^-/, '/').replace(/-/g, '/')
}

/** One-line preview (sidebar etc.) — collapses whitespace. */
function truncate(text, n = 120) {
  const s = String(text || '').replace(/\s+/g, ' ').trim()
  if (s.length <= n) return s
  return `${s.slice(0, n - 1)}…`
}

/** Keep newlines / markdown structure for chat body. */
function clip(text, n = 4000) {
  const s = String(text || '')
  if (s.length <= n) return s
  return `${s.slice(0, n - 1)}…`
}

async function readAliases(projectDir) {
  const aliasPath = path.join(projectDir, '.session-aliases')
  try {
    const raw = await fsp.readFile(aliasPath, 'utf8')
    // Can be JSON object or JSONL; try JSON first
    try {
      const parsed = JSON.parse(raw)
      if (parsed && typeof parsed === 'object') return parsed
    } catch {
      /* fall through */
    }
    const map = {}
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue
      try {
        const row = JSON.parse(line)
        if (row.sessionId && row.name) map[row.sessionId] = row.name
        else if (row.id && row.alias) map[row.id] = row.alias
      } catch {
        /* ignore */
      }
    }
    return map
  } catch {
    return {}
  }
}

async function peekSession(jsonlPath) {
  const preview = {
    firstUser: '',
    lastTs: null,
    cwd: null,
    messageCount: 0,
  }

  let handle
  try {
    handle = await fsp.open(jsonlPath, 'r')
    const { size } = await handle.stat()
    const readSize = Math.min(size, 256 * 1024)
    const buf = Buffer.alloc(readSize)
    await handle.read(buf, 0, readSize, 0)
    const head = buf.toString('utf8')

    for (const line of head.split('\n')) {
      if (!line.trim()) continue
      let row
      try {
        row = JSON.parse(line)
      } catch {
        continue
      }

      if (row.cwd && !preview.cwd) preview.cwd = row.cwd
      if (row.timestamp) preview.lastTs = row.timestamp

      const role =
        row.type === 'user' ||
        row.message?.role === 'user' ||
        row.type === 'human'
      if (role && !preview.firstUser) {
        const content = row.message?.content ?? row.content ?? row.text
        let text = ''
        if (typeof content === 'string') text = content
        else if (Array.isArray(content)) {
          text = content
            .map((c) => (typeof c === 'string' ? c : c?.text || ''))
            .join(' ')
        }
        const cleaned = text.trim()
        if (
          cleaned &&
          !cleaned.startsWith('<local-command') &&
          !cleaned.startsWith('<command-name>') &&
          !cleaned.startsWith('/ ')
        ) {
          preview.firstUser = truncate(cleaned, 160)
        }
      }
      if (row.type === 'user' || row.type === 'assistant' || row.message) {
        preview.messageCount += 1
      }
    }

    // Read tail for freshest timestamp
    if (size > readSize) {
      const tailSize = Math.min(64 * 1024, size)
      const tbuf = Buffer.alloc(tailSize)
      await handle.read(tbuf, 0, tailSize, size - tailSize)
      const tail = tbuf.toString('utf8')
      for (const line of tail.split('\n')) {
        if (!line.trim()) continue
        try {
          const row = JSON.parse(line)
          if (row.timestamp) preview.lastTs = row.timestamp
          if (row.cwd) preview.cwd = row.cwd
        } catch {
          /* ignore partial first line */
        }
      }
    }
  } catch {
    /* ignore unreadable */
  } finally {
    await handle?.close()
  }

  return preview
}

async function loadHistoryIndex() {
  const bySession = new Map()
  try {
    const raw = await fsp.readFile(HISTORY_FILE, 'utf8')
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue
      try {
        const row = JSON.parse(line)
        if (!row.sessionId) continue
        const prev = bySession.get(row.sessionId)
        if (!prev) {
          bySession.set(row.sessionId, {
            display: row.display || '',
            project: row.project || null,
            timestamp: row.timestamp || null,
          })
        } else if (row.timestamp && (!prev.timestamp || row.timestamp > prev.timestamp)) {
          bySession.set(row.sessionId, {
            display: row.display || prev.display,
            project: row.project || prev.project,
            timestamp: row.timestamp,
          })
        }
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* no history */
  }
  return bySession
}

export async function listSessions() {
  let entries = []
  try {
    entries = await fsp.readdir(PROJECTS_DIR, { withFileTypes: true })
  } catch {
    return []
  }

  const history = await loadHistoryIndex()
  const sessions = []

  for (const ent of entries) {
    if (!ent.isDirectory()) continue
    const projectDir = path.join(PROJECTS_DIR, ent.name)
    const aliases = await readAliases(projectDir)
    let files = []
    try {
      files = await fsp.readdir(projectDir)
    } catch {
      continue
    }

    const decodedGuess = decodeProjectDir(ent.name)

    for (const file of files) {
      if (!file.endsWith('.jsonl')) continue
      const sessionId = file.replace(/\.jsonl$/, '')
      const full = path.join(projectDir, file)
      let stat
      try {
        stat = await fsp.stat(full)
      } catch {
        continue
      }

      const peek = await peekSession(full)
      const hist = history.get(sessionId)
      const cwd =
        peek.cwd ||
        hist?.project ||
        (fs.existsSync(decodedGuess) ? decodedGuess : null)

      const mtime = stat.mtimeMs
      let lastActivity = mtime
      if (peek.lastTs) {
        const t =
          typeof peek.lastTs === 'number'
            ? peek.lastTs > 1e12
              ? peek.lastTs
              : peek.lastTs * 1000
            : Date.parse(peek.lastTs)
        if (!Number.isNaN(t)) lastActivity = t
      } else if (hist?.timestamp) {
        const t =
          hist.timestamp > 1e12 ? hist.timestamp : hist.timestamp * 1000
        if (!Number.isNaN(t)) lastActivity = t
      }

      const name = aliases[sessionId] || null
      const preview =
        peek.firstUser ||
        (hist?.display && !String(hist.display).startsWith('/')
          ? truncate(hist.display)
          : '') ||
        '(empty session)'

      sessions.push({
        id: sessionId,
        name,
        projectKey: ent.name,
        cwd,
        preview,
        messageCount: peek.messageCount,
        mtime,
        lastActivity,
        transcriptPath: full,
      })
    }
  }

  sessions.sort((a, b) => b.lastActivity - a.lastActivity)
  return sessions
}

function cacheBase64Image(sessionId, mediaType, data) {
  if (!data || !sessionId) return null
  const ext =
    (mediaType || 'image/png').split('/')[1]?.replace('jpeg', 'jpg') || 'png'
  const hash = crypto
    .createHash('sha1')
    .update(data.slice(0, 4096))
    .update(String(data.length))
    .digest('hex')
    .slice(0, 20)
  const dir = path.join(MEDIA_ROOT, sessionId)
  fs.mkdirSync(dir, { recursive: true })
  const name = `${hash}.${ext}`
  const file = path.join(dir, name)
  if (!fs.existsSync(file)) {
    try {
      fs.writeFileSync(file, Buffer.from(data, 'base64'))
    } catch {
      return null
    }
  }
  return `/api/media/${encodeURIComponent(sessionId)}/${name}`
}

function imageSrcFromPart(c, sessionId) {
  const src = c?.source
  if (!src) return null
  if (src.type === 'base64' && src.data) {
    return cacheBase64Image(sessionId, src.media_type || c.media_type, src.data)
  }
  if (src.type === 'url' && src.url) return src.url
  if (typeof src === 'string' && src.startsWith('data:')) return src
  return null
}

const IMAGE_SOURCE_RE = /^\[Image:\s*source:\s*(.+?)\]\s*$/i

function contentParts(content, sessionId = '') {
  if (typeof content === 'string') {
    return content.trim() ? [{ type: 'text', text: content }] : []
  }
  if (!Array.isArray(content)) return []
  const parts = []
  for (const c of content) {
    if (typeof c === 'string') {
      if (c.trim()) parts.push({ type: 'text', text: c })
      continue
    }
    if (!c || typeof c !== 'object') continue
    if (c.type === 'text' && c.text?.trim()) {
      const t = c.text
      const m = t.trim().match(IMAGE_SOURCE_RE)
      if (m) {
        const filePath = m[1].trim()
        if (filePath && fs.existsSync(filePath)) {
          // Rare: tmp file still around — copy into media cache
          try {
            const ext = path.extname(filePath).slice(1) || 'png'
            const buf = fs.readFileSync(filePath)
            const b64 = buf.toString('base64')
            const url = cacheBase64Image(
              sessionId,
              `image/${ext === 'jpg' ? 'jpeg' : ext}`,
              b64,
            )
            if (url) parts.push({ type: 'image', src: url })
          } catch {
            /* ignore */
          }
        }
        // Drop the raw path placeholder either way
        continue
      }
      parts.push({ type: 'text', text: t })
    } else if (c.type === 'image') {
      const src = imageSrcFromPart(c, sessionId)
      if (src) parts.push({ type: 'image', src })
    } else if (c.type === 'document') {
      const media = c.source?.media_type || c.media_type || 'application/pdf'
      parts.push({
        type: 'file',
        name: media === 'application/pdf' ? 'document.pdf' : 'attachment',
        kind: 'document',
      })
    } else if (c.type === 'thinking' && (c.thinking || c.text)) {
      parts.push({ type: 'thinking', text: String(c.thinking || c.text) })
    } else if (c.type === 'tool_use') {
      const input = c.input && typeof c.input === 'object' ? c.input : {}
      const summary =
        input.description ||
        input.command ||
        input.file_path ||
        input.path ||
        input.pattern ||
        ''
      parts.push({
        type: 'tool_use',
        id: c.id || null,
        name: c.name || 'tool',
        summary: String(summary).slice(0, 240),
      })
    } else if (c.type === 'tool_result') {
      let result = ''
      if (typeof c.content === 'string') result = c.content
      else if (Array.isArray(c.content)) {
        result = c.content
          .map((x) => (typeof x === 'string' ? x : x?.text || ''))
          .join('\n')
      } else if (c.content != null) {
        try {
          result = JSON.stringify(c.content)
        } catch {
          result = String(c.content)
        }
      }
      parts.push({
        type: 'tool_result',
        toolUseId: c.tool_use_id || null,
        text: result.slice(0, 1200),
      })
    }
  }
  return parts
}

function summarizeTools(tools) {
  const names = [
    ...new Set(
      tools
        .map((t) => t.name)
        .filter((n) => n && n !== 'result'),
    ),
  ]
  if (!names.length) return tools.length ? `${tools.length} 次工具` : ''
  if (names.length <= 3) return names.join(' · ')
  return `${names.slice(0, 3).join(' · ')} 等 ${names.length} 个`
}

function isNoiseText(text) {
  const t = String(text || '').trim()
  if (!t) return true
  if (t.startsWith('<local-command') || t.startsWith('<command-')) return true
  if (t.startsWith('<system-reminder')) return true
  if (t.startsWith('Caveat: The messages below were generated')) return true
  // Pure tool-result markers that slipped through as text
  if (/^\[tool result\]$/i.test(t)) return true
  if (/^\[tool:/i.test(t) && t.length < 80) return true
  if (IMAGE_SOURCE_RE.test(t)) return true
  return false
}

/** CC Desk injects this hint for staged files — show as chips, not raw path dump. */
const UPLOAD_HINT_RE =
  /\n*\s*用户附带了以下本地文件（可用 Read 工具查看）：\s*\n((?:[ \t]*- .+\n?)*)/g

function stripUploadHint(text) {
  const files = []
  const clean = String(text || '')
    .replace(UPLOAD_HINT_RE, (_m, block) => {
      for (const line of String(block || '').split('\n')) {
        const hit = line.trim().match(/^- (.+)$/)
        if (!hit) continue
        const full = hit[1].trim()
        if (!full) continue
        files.push({
          name: path.basename(full) || full,
          kind: 'file',
        })
      }
      return '\n'
    })
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return { text: clean, files }
}

function workLabel(thinking, tools) {
  const toolSum = summarizeTools(tools)
  if (thinking.length && toolSum) return `思考与工具 · ${toolSum}`
  if (thinking.length) return `思考过程 · ${thinking.length} 段`
  if (toolSum) return `使用了 ${toolSum}`
  return '工作过程'
}

/** Locate `{sessionId}.jsonl` under ~/.claude/projects without full peek. */
export async function findTranscriptPath(sessionId) {
  if (!sessionId || !fs.existsSync(PROJECTS_DIR)) return null
  let ents
  try {
    ents = await fsp.readdir(PROJECTS_DIR, { withFileTypes: true })
  } catch {
    return null
  }
  for (const ent of ents) {
    if (!ent.isDirectory()) continue
    const full = path.join(PROJECTS_DIR, ent.name, `${sessionId}.jsonl`)
    try {
      await fsp.access(full)
      return full
    } catch {
      /* continue */
    }
  }
  return null
}

/** Cheap poll target: mtime + size of transcript file. */
export async function getSessionMeta(sessionId) {
  const transcriptPath = await findTranscriptPath(sessionId)
  if (!transcriptPath) return null
  const st = await fsp.stat(transcriptPath)
  return {
    id: sessionId,
    transcriptPath,
    mtimeMs: st.mtimeMs,
    size: st.size,
  }
}

/**
 * Approximate Claude Code status-line context % from the latest transcript usage.
 * used = input + cache_creation + cache_read (same as CLI used_percentage).
 */
export async function getSessionContextUsage(sessionId) {
  const empty = {
    id: sessionId,
    usedTokens: 0,
    windowSize: 200_000,
    percent: null,
    model: null,
  }
  const transcriptPath = await findTranscriptPath(sessionId)
  if (!transcriptPath) return empty

  const st = await fsp.stat(transcriptPath)
  if (!st.size) return empty

  const readSize = Math.min(st.size, 512 * 1024)
  const start = st.size - readSize
  const fh = await fsp.open(transcriptPath, 'r')
  try {
    const buf = Buffer.alloc(readSize)
    await fh.read(buf, 0, readSize, start)
    const text = buf.toString('utf8')
    const lines = text.split('\n')
    let usage = null
    let model = null
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i].trim()
      if (!line) continue
      try {
        const row = JSON.parse(line)
        if (row?.isSidechain) continue
        const u = row?.message?.usage || row?.usage
        if (!u || typeof u !== 'object') continue
        if (typeof u.input_tokens !== 'number') continue
        usage = u
        model = row?.message?.model || row?.model || null
        break
      } catch {
        /* skip bad line */
      }
    }
    if (!usage) return empty

    const usedTokens =
      Number(usage.input_tokens || 0) +
      Number(usage.cache_creation_input_tokens || 0) +
      Number(usage.cache_read_input_tokens || 0)
    const modelStr = String(model || '')
    const windowSize =
      /\[1m\]/i.test(modelStr) ||
      /1m/i.test(modelStr) ||
      /1000000|1_?000_?000/.test(modelStr)
        ? 1_000_000
        : 200_000
    const percent =
      windowSize > 0
        ? Math.min(100, Math.round((usedTokens / windowSize) * 1000) / 10)
        : null
    return {
      id: sessionId,
      usedTokens,
      windowSize,
      percent,
      model: modelStr || null,
    }
  } finally {
    await fh.close()
  }
}

function parseTs(ts) {
  if (ts == null) return null
  if (typeof ts === 'number') return ts > 1e12 ? ts : ts * 1000
  const n = Date.parse(ts)
  return Number.isNaN(n) ? null : n
}

function shortModel(model) {
  if (!model || typeof model !== 'string') return null
  const m = model.trim()
  if (!m || m === '<synthetic>') return null
  // claude-opus-4-5-20251101 → Opus 4.5 style-ish short id
  return m.replace(/^claude-/, '').replace(/-\d{8}$/, '')
}

/** Build chat blocks: user/assistant text + collapsible work (thinking/tools). */
export async function getSessionMessages(sessionId, limit = 120) {
  const transcriptPath = await findTranscriptPath(sessionId)
  if (!transcriptPath) return null

  const st = await fsp.stat(transcriptPath)
  const peek = await peekSession(transcriptPath)
  const aliases = await readAliases(path.dirname(transcriptPath))
  const hit = {
    id: sessionId,
    name: aliases[sessionId] || null,
    projectKey: path.basename(path.dirname(transcriptPath)),
    cwd: peek.cwd,
    preview: peek.firstUser || '',
    messageCount: peek.messageCount,
    mtime: st.mtimeMs,
    lastActivity: st.mtimeMs,
    transcriptPath,
  }

  const raw = await fsp.readFile(transcriptPath, 'utf8')
  const blocks = []
  let work = null
  /** Wall-clock start of current user turn (for duration estimate). */
  let turnStartMs = null
  /** Sum of thinkingDurationMs seen since last user visible message. */
  let thinkingMsAccum = 0
  let lastModel = null

  const ensureWork = () => {
    if (!work) {
      work = {
        thinking: [],
        tools: [],
        thinkingMs: 0,
        model: null,
        timestamp: null,
      }
    }
  }
  const flushWork = () => {
    if (!work) return
    const thinking = work.thinking.map((t) => clip(t, 2500)).filter(Boolean)
    const tools = work.tools.filter((t) => t.name !== 'result' || t.result)
    if (thinking.length || tools.length) {
      blocks.push({
        kind: 'work',
        role: 'assistant',
        label: workLabel(thinking, tools),
        thinking,
        tools,
        timestamp: work.timestamp || null,
        model: work.model || lastModel || null,
        thinkingMs: work.thinkingMs || null,
        durationMs: work.thinkingMs || null,
      })
    }
    work = null
  }

  const pushVisible = ({
    role,
    text,
    images,
    files,
    ts,
    model,
    durationMs,
    thinkingMs,
  }) => {
    blocks.push({
      kind: role,
      role,
      text: text || '',
      images: images || [],
      files: files || [],
      timestamp: ts || null,
      model: model || null,
      durationMs: durationMs ?? null,
      thinkingMs: thinkingMs ?? null,
    })
  }

  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    let row
    try {
      row = JSON.parse(line)
    } catch {
      continue
    }

    // Official turn duration marker (not always present)
    if (row.type === 'system' && row.subtype === 'turn_duration') {
      const ms = Number(row.durationMs)
      if (Number.isFinite(ms) && ms > 0) {
        for (let i = blocks.length - 1; i >= 0; i--) {
          const b = blocks[i]
          if (b.kind === 'assistant' || b.kind === 'work') {
            b.durationMs = ms
            break
          }
        }
      }
      continue
    }

    // Only real transcript turns — ignore api-request-blob / progress echoes
    // that also carry message.role === 'user' and would duplicate the bubble.
    const role =
      row.type === 'user'
        ? 'user'
        : row.type === 'assistant'
          ? 'assistant'
          : null
    if (!role) continue

    const parts = contentParts(
      row.message?.content ?? row.content ?? row.text,
      sessionId,
    )
    if (!parts.length) continue
    const ts = row.timestamp || null
    const tsMs = parseTs(ts)
    const model = shortModel(row.message?.model || row.model)
    if (model) lastModel = model
    const thinkMs = Number(row.thinkingDurationMs)
    if (Number.isFinite(thinkMs) && thinkMs > 0) {
      thinkingMsAccum += thinkMs
    }

    const hasUserVisibleText = parts.some((p) => p.type === 'text')
    const hasImages = parts.some((p) => p.type === 'image')
    const hasFiles = parts.some((p) => p.type === 'file')

    if (role === 'user' && parts.every((p) => p.type === 'tool_result')) {
      ensureWork()
      work.timestamp = work.timestamp || ts
      if (model) work.model = model
      if (Number.isFinite(thinkMs) && thinkMs > 0) work.thinkingMs += thinkMs
      for (const p of parts) {
        const last = work.tools[work.tools.length - 1]
        if (last && !last.result) last.result = clip(p.text, 800)
        else {
          work.tools.push({
            name: 'result',
            summary: '',
            result: clip(p.text, 800),
          })
        }
      }
      continue
    }

    if (role === 'assistant' && !hasUserVisibleText && !hasImages && !hasFiles) {
      ensureWork()
      work.timestamp = work.timestamp || ts
      if (model) work.model = model
      if (Number.isFinite(thinkMs) && thinkMs > 0) work.thinkingMs += thinkMs
      for (const p of parts) {
        if (p.type === 'thinking') work.thinking.push(p.text)
        if (p.type === 'tool_use') {
          work.tools.push({
            name: p.name,
            summary: p.summary || '',
            result: '',
          })
        }
      }
      continue
    }

    // Same turn may mix thinking/tools + visible text
    const thinkingParts = parts.filter((p) => p.type === 'thinking')
    const toolParts = parts.filter((p) => p.type === 'tool_use')
    if (thinkingParts.length || toolParts.length) {
      ensureWork()
      work.timestamp = work.timestamp || ts
      if (model) work.model = model
      if (Number.isFinite(thinkMs) && thinkMs > 0) work.thinkingMs += thinkMs
      for (const p of thinkingParts) work.thinking.push(p.text)
      for (const p of toolParts) {
        work.tools.push({
          name: p.name,
          summary: p.summary || '',
          result: '',
        })
      }
    }

    // Visible user / assistant text / images — flush work first
    flushWork()
    const images = [
      ...new Set(
        parts.filter((p) => p.type === 'image' && p.src).map((p) => p.src),
      ),
    ]
    let files = parts
      .filter((p) => p.type === 'file')
      .map((p) => ({ name: p.name || 'attachment', kind: p.kind || 'file' }))
    const text = parts
      .filter((p) => p.type === 'text')
      .map((p) => p.text)
      .join('\n')
      .trim()
    let cleanText = text && !isNoiseText(text) ? clip(text, 12000) : ''
    if (cleanText) {
      const stripped = stripUploadHint(cleanText)
      cleanText = stripped.text
      if (stripped.files.length) {
        const seen = new Set(files.map((f) => f.name))
        for (const f of stripped.files) {
          if (seen.has(f.name)) continue
          seen.add(f.name)
          files.push(f)
        }
      }
    }
    if (!cleanText && !images.length && !files.length) continue

    if (role === 'user') {
      // Claude Code often re-emits the same turn as `[Image: source: …]`
      // placeholders after the real base64 user message — skip that echo.
      const prev = [...blocks].reverse().find((b) => b.kind === 'user')
      const imageOnlyEcho = !cleanText && !files.length && images.length > 0
      if (
        imageOnlyEcho &&
        prev &&
        (prev.images?.length || 0) >= images.length
      ) {
        continue
      }
      turnStartMs = tsMs
      thinkingMsAccum = 0
      pushVisible({ role, text: cleanText, images, files, ts })
      continue
    }

    // assistant visible reply
    let durationMs = null
    if (turnStartMs != null && tsMs != null && tsMs >= turnStartMs) {
      durationMs = tsMs - turnStartMs
    }
    const thinkingMs = thinkingMsAccum || null
    // Prefer wall-clock since user message; fall back to thinking time
    if (durationMs == null && thinkingMs) durationMs = thinkingMs

    pushVisible({
      role,
      text: cleanText,
      images,
      files,
      ts,
      model: model || lastModel,
      durationMs,
      thinkingMs,
    })
    // Keep turnStart so follow-up assistant chunks in same turn still estimate;
    // reset thinking accumulator after a visible assistant text block
    thinkingMsAccum = 0
  }
  flushWork()

  return {
    session: hit,
    messages: blocks.slice(-limit),
  }
}

async function rmSafe(target) {
  try {
    await fsp.rm(target, { recursive: true, force: true })
    return true
  } catch {
    return false
  }
}

/**
 * Delete one interactive session from disk.
 * Claude Code has no CLI for this — removing the transcript is the supported workaround.
 * Also cleans sibling session dir + file-history/tasks when present.
 */
export async function deleteSession(sessionId) {
  const transcriptPath = await findTranscriptPath(sessionId)
  if (!transcriptPath) return null

  const projectDir = path.dirname(transcriptPath)
  const removed = []

  if (await rmSafe(transcriptPath)) removed.push(transcriptPath)

  const siblingDir = path.join(projectDir, sessionId)
  if (fs.existsSync(siblingDir) && (await rmSafe(siblingDir))) {
    removed.push(siblingDir)
  }

  for (const sub of ['file-history', 'tasks']) {
    const d = path.join(CLAUDE_HOME, sub, sessionId)
    if (fs.existsSync(d) && (await rmSafe(d))) removed.push(d)
  }

  return { ok: true, id: sessionId, removed }
}

/**
 * Delete all Claude Code local data for a project path via `claude purge -y`.
 * Falls back to deleting listed session ids if purge is unavailable / no cwd.
 */
export async function removeProjectData({
  cwd = null,
  sessionIds = [],
  usePurge = true,
} = {}) {
  const result = {
    ok: true,
    purged: false,
    purgeOutput: '',
    deletedSessions: [],
  }

  if (usePurge && cwd && fs.existsSync(cwd)) {
    try {
      const output = await new Promise((resolve, reject) => {
        const child = spawn('claude', ['purge', '-y', cwd], {
          env: process.env,
        })
        let out = ''
        let err = ''
        child.stdout.on('data', (d) => {
          out += d.toString()
        })
        child.stderr.on('data', (d) => {
          err += d.toString()
        })
        child.on('error', reject)
        child.on('close', (code) => {
          if (code === 0) resolve(out || err)
          else reject(new Error(err || out || `claude purge exited ${code}`))
        })
      })
      result.purged = true
      result.purgeOutput = String(output).slice(0, 2000)
      return result
    } catch (err) {
      result.purgeOutput = String(err.message || err)
      // fall through to per-session delete
    }
  }

  for (const id of sessionIds) {
    const del = await deleteSession(id)
    if (del?.ok) result.deletedSessions.push(id)
  }
  return result
}
