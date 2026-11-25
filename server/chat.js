import { spawn } from 'node:child_process'
import fs from 'node:fs'
import { mkdir, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createInterface } from 'node:readline'
import { enrichedEnv, resolveClaudeBin } from './claudeCli.js'
import { dirsFromFiles } from './launch.js'
import { findTranscriptPath } from './sessions.js'
import { listWorkspaces } from './workspaces.js'

const IMAGE_MIME = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
])
const MAX_ATTACH_BYTES = 20 * 1024 * 1024
const MAX_ATTACH_COUNT = 16

function safeFileName(name) {
  const base = path.basename(String(name || 'file')).replace(/[^\w.\-()+ ]+/g, '_')
  return base.slice(0, 180) || 'file'
}

function normalizeAttachment(raw) {
  if (!raw || typeof raw !== 'object') return null
  const name = safeFileName(raw.name)
  const data = String(raw.data || '').replace(/\s/g, '')
  if (!data) return null
  const bytes = Buffer.byteLength(data, 'base64')
  if (bytes <= 0 || bytes > MAX_ATTACH_BYTES) return null
  let mime = String(raw.mime || '').toLowerCase().split(';')[0].trim()
  if (mime === 'image/jpg') mime = 'image/jpeg'
  let kind = String(raw.kind || '').toLowerCase()
  if (kind !== 'image' && kind !== 'document' && kind !== 'file') {
    if (IMAGE_MIME.has(mime)) kind = 'image'
    else if (mime === 'application/pdf') kind = 'document'
    else kind = 'file'
  }
  if (kind === 'image' && !IMAGE_MIME.has(mime)) mime = 'image/png'
  if (kind === 'document') mime = 'application/pdf'
  if (kind === 'file' && !mime) mime = 'application/octet-stream'
  return { name, mime, kind, data, bytes }
}

async function buildUserContent(prompt, attachments, cwd, sessionId) {
  const text = String(prompt || '').trim()
  const files = []
  const content = []
  const notes = []

  for (const att of attachments) {
    if (att.kind === 'image') {
      content.push({
        type: 'image',
        source: { type: 'base64', media_type: att.mime, data: att.data },
      })
      continue
    }
    if (att.kind === 'document') {
      content.push({
        type: 'document',
        source: {
          type: 'base64',
          media_type: 'application/pdf',
          data: att.data,
        },
      })
      continue
    }
    // Other files: stage on disk so Claude Code can Read them (same as CLI drop).
    const dir = path.join(cwd, '.cc-desk-uploads', sessionId)
    await mkdir(dir, { recursive: true })
    let dest = path.join(dir, att.name)
    if (fs.existsSync(dest)) {
      const stem = path.parse(att.name).name
      const ext = path.parse(att.name).ext
      dest = path.join(dir, `${stem}-${Date.now()}${ext}`)
    }
    await writeFile(dest, Buffer.from(att.data, 'base64'))
    files.push(dest)
    notes.push(dest)
  }

  let body = text
  if (notes.length) {
    const listing = notes.map((p) => `- ${p}`).join('\n')
    const hint =
      '用户附带了以下本地文件（可用 Read 工具查看）：\n' + listing
    body = body ? `${body}\n\n${hint}` : hint
  }
  if (body) content.unshift({ type: 'text', text: body })
  if (!content.length) throw new Error('请提供消息或附件')
  return { content, files }
}

const active = new Map()
const uuid = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i

// Only publish user-visible events. The init message can contain local configuration.
function eventTranslator(send) {
  const streams = new Map()
  let sequence = 0
  let hasText = false
  let result
  return {
    read(msg) {
      const scope = msg.parent_tool_use_id || 'main'
      const event = msg.event
      if (msg.type === 'stream_event') {
        if (event?.type === 'message_start') {
          streams.set(scope, { id: event.message.id, blocks: new Map() })
        }
        const stream = streams.get(scope)
        if (!stream) return
        const block = event.content_block
        const delta = event.delta
        const kind = block?.type || delta?.type?.replace(/_delta$/, '')
        if (kind !== 'thinking' && kind !== 'text') return
        const piece = block?.[kind] ?? delta?.[kind]
        if (typeof piece !== 'string') return
        const key = scope + ':' + stream.id + ':' + event.index
        stream.blocks.set(event.index, { key, kind })
        if (piece) {
          if (kind === 'text' && scope === 'main') hasText = true
          send({ type: kind === 'thinking' ? 'thinkingDelta' : 'delta', key, text: piece })
        }
      }
      if (msg.type === 'assistant') {
        const stream = streams.get(scope)
        for (const block of (msg.message?.content || [])) {
          if (block.type === 'text' || block.type === 'thinking') {
            // CLI can send one finalized block at a time, without its stream index.
            const match = stream?.id === msg.message.id
              ? [...stream.blocks].find(([, item]) => item.kind === block.type)
              : undefined
            if (match) stream.blocks.delete(match[0])
            const text = block[block.type]
            if (text) {
              if (block.type === 'text' && scope === 'main') hasText = true
              send({ type: block.type, key: match?.[1].key || 'complete:' + sequence++, text })
            }
          }
          if (block.type === 'tool_use') {
            const input = block.input || {}
            const summary = String(input.description || input.command || input.file_path || input.pattern || '')
            send({ type: 'tool', key: block.id, name: block.name, summary })
          }
        }
      }
      if (msg.type === 'user' && Array.isArray(msg.message?.content)) {
        for (const block of msg.message.content) {
          if (block.type !== 'tool_result') continue
          const text = Array.isArray(block.content)
            ? block.content.map(part => part.text || '').join('\n')
            : String(block.content || '')
          send({ type: 'toolResult', key: block.tool_use_id, text })
        }
      }
      if (msg.type === 'result' && scope === 'main') {
        result = msg
        if (!hasText && !msg.is_error && msg.result) {
          send({ type: 'text', key: 'result', text: msg.result })
        }
      }
    },
    finish(code, stderr) {
      if (!result || result.is_error || result.subtype !== 'success' || code !== 0) {
        throw new Error(result?.result || result?.errors?.join('\n') || stderr.trim() || 'Claude Code 未完成本轮回复')
      }
    },
  }
}

function fromPanel(req) {
  // The Vite development proxy rewrites Host to the API port.
  const host = req.get('host') || ''
  const origin = req.get('origin')
  const local = /^(localhost|127\.0\.0\.1)(:\d+)?$/
  return local.test(host) && (!origin || origin === 'http://' + host ||
      /^http:\/\/(localhost|127\.0\.0\.1):5173$/.test(origin))
}

export function decidePermission(req, res) {
  if (!fromPanel(req) || !req.is('application/json')) return res.sendStatus(403)
  const { sessionId, requestId, allow } = req.body || {}
  if (typeof allow !== 'boolean') return res.sendStatus(400)
  const pending = active.get(sessionId)?.pending
  const answer = pending?.get(requestId)
  if (!answer) return res.status(409).json({ error: '该确认请求已结束' })
  pending.delete(requestId)
  answer(allow)
  res.json({ ok: true })
}

export async function streamChat(req, res) {
  const {
    sessionId,
    prompt = '',
    model,
    cwd,
    resume,
    addDirs = [],
    workspaceId,
    attachments = [],
    permissionMode = 'default',
    effort = null,
  } = req.body || {}
  if (!fromPanel(req)) return res.sendStatus(403)
  const promptText = typeof prompt === 'string' ? prompt : ''
  const rawAttachments = Array.isArray(attachments) ? attachments : []
  // Interactive Claude Code cycle: default → acceptEdits → auto → plan
  const ALLOWED_PERMISSION = new Set([
    'default',
    'acceptEdits',
    'auto',
    'plan',
    'manual', // CLI alias for default
  ])
  let perm = String(permissionMode || 'default').trim()
  if (perm === 'manual') perm = 'default'
  // Legacy CC Desk values → safest interactive mode
  if (perm === 'dontAsk' || perm === 'bypassPermissions') perm = 'default'
  if (!ALLOWED_PERMISSION.has(perm)) {
    return res.status(400).json({ error: '无效的权限模式' })
  }
  const ALLOWED_EFFORT = new Set(['low', 'medium', 'high', 'xhigh', 'max'])
  let effortLevel = effort == null || effort === '' ? null : String(effort).trim().toLowerCase()
  if (effortLevel === 'extra' || effortLevel === 'extra-high' || effortLevel === 'extra_high') {
    effortLevel = 'xhigh'
  }
  if (effortLevel && !ALLOWED_EFFORT.has(effortLevel)) {
    return res.status(400).json({ error: '无效的思考强度' })
  }
  if (rawAttachments.length > MAX_ATTACH_COUNT) {
    return res.status(400).json({ error: `一次最多附带 ${MAX_ATTACH_COUNT} 个文件` })
  }
  const normalized = rawAttachments.map(normalizeAttachment).filter(Boolean)
  if (normalized.length !== rawAttachments.length) {
    return res.status(400).json({ error: '附件无效或超过 20MB 限制' })
  }
  if (!req.is('application/json') || !uuid.test(sessionId) ||
      (!promptText.trim() && !normalized.length) ||
      typeof cwd !== 'string' || !path.isAbsolute(cwd) ||
      !Array.isArray(addDirs) || !addDirs.every(d => typeof d === 'string' && path.isAbsolute(d))) {
    return res.status(400).json({ error: '请提供消息或附件，以及有效的项目目录' })
  }
  if (model != null && (typeof model !== 'string' || model.startsWith('-') || /[\s\x00-\x1f]/.test(model))) {
    return res.status(400).json({ error: '无效的模型 ID' })
  }
  const previous = active.get(sessionId)
  if (previous?.response.destroyed) await previous.closed
  if (active.has(sessionId)) return res.status(409).json({ error: '当前会话正在生成回复' })
  let finish
  const closed = new Promise(resolve => { finish = resolve })
  const pending = new Map()
  active.set(sessionId, { response: res, closed, pending })
  let child
  let killTimer
  const stop = () => {
    if (!child || child.exitCode !== null || child.signalCode !== null) return
    child.kill('SIGTERM')
    killTimer = setTimeout(() => child.kill('SIGKILL'), 3000)
    killTimer.unref()
  }
  res.once('close', stop)
  try {
    if (!(await stat(cwd)).isDirectory()) throw new Error('项目目录不可用')
    const bin = await resolveClaudeBin()
    if (!bin) throw new Error('找不到 Claude Code CLI，请检查本地安装')
    const existing = await findTranscriptPath(sessionId)
    if (resume && !existing) throw new Error('找不到要继续的会话记录')
    const ws = workspaceId && (await listWorkspaces()).find(w => w.id === workspaceId)
    const dirs = new Set([...addDirs, ...(ws?.addDirs || []), ...dirsFromFiles(ws?.files)])
    const args = ['-p', '--verbose', '--output-format', 'stream-json', '--include-partial-messages',
      '--input-format', 'stream-json', '--permission-prompt-tool', 'stdio',
      '--permission-mode', perm]
    args.push(existing ? '--resume' : '--session-id', sessionId)
    if (model) args.push('--model', model)
    if (effortLevel) args.push('--effort', effortLevel)
    for (const dir of dirs) if (dir !== cwd) args.push('--add-dir', dir)
    if (res.destroyed) return
    child = spawn(bin, args, { cwd, env: enrichedEnv(), stdio: 'pipe' })
    const send = event => {
      if (!res.destroyed) res.write(JSON.stringify(event) + '\n')
    }
    res.set({ 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-store' })
    res.flushHeaders()
    const translator = eventTranslator(send)
    let stderr = ''
    let parseError
    child.stderr.setEncoding('utf8').on('data', part => { stderr = (stderr + part).slice(-2048) })
    const lines = createInterface({ input: child.stdout, crlfDelay: Infinity })
    lines.on('line', line => {
      if (!line.trim() || parseError) return
      try {
        const msg = JSON.parse(line)
        const id = msg.request_id
        if (msg.type === 'control_request') {
          const reply = response => child.stdin.write(JSON.stringify({
            type: 'control_response', response: { request_id: id, ...response },
          }) + '\n')
          if (msg.request.subtype !== 'can_use_tool') {
            reply({ subtype: 'error', error: 'Unsupported control request' })
            return
          }
          const { tool_name: name, input } = msg.request
          pending.set(id, allow => {
            const response = allow ? { behavior: 'allow', updatedInput: input }
              : { behavior: 'deny', message: '用户拒绝了本次工具调用' }
            reply({ subtype: 'success', response })
            send({ type: 'permissionClosed', id })
          })
          send({ type: 'permission', id, name, input })
        } else if (msg.type === 'control_cancel_request') {
          pending.delete(id)
          send({ type: 'permissionClosed', id })
        } else {
          translator.read(msg)
          // Only end the print-mode turn on the top-level result (not nested agent results).
          if (msg.type === 'result' && !msg.parent_tool_use_id) child.stdin.end()
        }
      } catch {
        parseError = new Error('Claude Code 返回了无法解析的消息')
        stop()
      }
    })
    child.stdin.on('error', () => {}) // Startup errors and early exits are handled via close.
    const { content } = await buildUserContent(
      promptText,
      normalized,
      cwd,
      sessionId,
    )
    const code = await new Promise((resolve, reject) => {
      child.once('error', reject)
      child.once('close', resolve)
      child.stdin.write(JSON.stringify({ type: 'user', session_id: sessionId,
        parent_tool_use_id: null, message: { role: 'user', content } }) + '\n')
    })
    if (res.destroyed) return
    if (parseError) throw parseError
    translator.finish(code, stderr)
    send({ type: 'done' })
    res.end()
  } catch (err) {
    if (res.destroyed) return
    const error = err.message || String(err)
    if (res.headersSent) res.end(JSON.stringify({ type: 'error', error }) + '\n')
    else res.status(400).json({ error })
  } finally {
    clearTimeout(killTimer)
    res.off('close', stop)
    active.delete(sessionId)
    finish()
  }
}
