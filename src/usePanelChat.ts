import { useEffect, useRef, useState } from 'react'
import type { ChatBlock } from './MessageList'

export type ChatRequestAttachment = {
  name: string
  mime: string
  kind: 'image' | 'document' | 'file'
  data: string
}

type ChatRequest = {
  sessionId: string
  model?: string
  prompt: string
  cwd: string
  resume: boolean
  workspaceId?: string
  addDirs?: string[]
  attachments?: ChatRequestAttachment[]
  permissionMode?: string
  /** Claude Code CLI `--effort` */
  effort?: string
  /** Optimistic preview URLs for images in the local turn */
  previewImages?: string[]
  previewFiles?: { name: string; kind: string }[]
}

export type RunMeta = { id: string; sessionId: string; cwd: string; prompt: string; started: number }
export type ApprovalPreview =
  | { kind: 'command'; cwd: string; explicitCwd: boolean; command: string }
  | { kind: 'file'; file: string; note: string; lines: string[] }
type Approval = { type: 'permission'; id: string; name: string; input: unknown; preview?: ApprovalPreview | null }
type Turn = { approvals: Approval[]; messages: ChatBlock[]; running: boolean; status: string }
type ChatEvent =
  | { type: 'text' | 'delta' | 'thinking' | 'thinkingDelta'; key: string; text: string }
  | { type: 'tool'; key: string; name: string; summary: string }
  | { type: 'toolResult'; key: string; text: string }
  | { type: 'status'; text: string }
  | { type: 'initial'; messages: ChatBlock[] }
  | Approval
  | { type: 'permissionClosed'; id: string }
  | { type: 'done' }
  | { type: 'error'; error: string }

const rememberedKey = 'cc-desk.live-turns'
function remembered(): RunMeta[] {
  try { return JSON.parse(sessionStorage.getItem(rememberedKey) || '[]') } catch { return [] }
}

export function usePanelChat(refresh: () => Promise<void>, restore: (meta: RunMeta) => void) {
  const [turns, setTurns] = useState<Record<string, Turn>>({})
  const controllers = useRef(new Map<string, { controller: AbortController; runId: string }>())
  useEffect(() => {
    const controller = new AbortController()
    const connections = controllers.current
    async function recover() {
      let live: RunMeta[] = []
      while (!controller.signal.aborted) {
        try {
          const res = await fetch('/api/chat/runs', { signal: controller.signal })
          if (!res.ok) throw new Error(res.statusText)
          live = await res.json()
          break
        } catch {
          if (!controller.signal.aborted) await new Promise(resolve => setTimeout(resolve, 1500))
        }
      }
      if (controller.signal.aborted) return
      const bySession = new Map([...remembered(), ...live].map(run => [run.sessionId, run]))
      for (const run of bySession.values()) {
        if (connections.has(run.sessionId)) continue
        restore(run)
        void follow(run, [])
      }
    }
    void recover()
    return () => {
      controller.abort()
      for (const conn of connections.values()) conn.controller.abort()
      connections.clear()
    }
  }, [refresh, restore])

  function clear(id: string) {
    setTurns(prev => {
      if (!prev[id] || prev[id].running) return prev
      const next = { ...prev }
      delete next[id]
      return next
    })
  }

  async function send(request: ChatRequest, history: ChatBlock[]) {
    const run = { id: crypto.randomUUID(), sessionId: request.sessionId, cwd: request.cwd,
      prompt: request.prompt.slice(0, 120), started: Date.now() }
    return follow(run, [...history, {
      kind: 'user', role: 'user', text: request.prompt, images: request.previewImages, files: request.previewFiles,
    }], request)
  }

  async function follow(run: RunMeta, blocks: ChatBlock[], request?: ChatRequest) {
    const id = run.sessionId
    if (controllers.current.has(id)) return
    const controller = new AbortController()
    controllers.current.set(id, { controller, runId: run.id })
    sessionStorage.setItem(rememberedKey, JSON.stringify([...remembered().filter(r => r.sessionId !== id), run]))
    const indices = new Map<string, number>()
    const approvals = new Map<string, Approval>()
    function publish(running: boolean, status: string) {
      const turn = { approvals: running ? [...approvals.values()] : [], messages: [...blocks], running, status: running && approvals.size ? '等待工具确认' : status }
      setTurns(prev => ({ ...prev, [id]: turn }))
    }
    let phase = request ? '正在准备请求…' : '正在恢复对话…'
    publish(true, phase)
    let status = ''
    let expired = false
    try {
      let offset = 0
      let complete = false
      let start = request
      let missing = 0
      while (!complete && !controller.signal.aborted) {
        const body = start
        start = undefined // Reconnect by run ID, never resubmit the prompt.
        try {
          const response = body ? await fetch('/api/chat', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...body, previewImages: undefined, previewFiles: undefined, runId: run.id }),
            signal: controller.signal,
          }) : await fetch(`/api/chat/runs/${run.id}?offset=${offset}`, { signal: controller.signal })
          if (!response.ok) {
            if (response.status === 404 && ++missing < 3) throw new TypeError('等待轮次连接')
            expired = response.status === 404 && !body
            const detail = await response.json().catch(() => ({}))
            throw new Error(detail.error || '轮次已结束，可从会话历史查看记录')
          }
          if (!response.body) throw new Error('无法读取回复流')
          publish(true, phase)
          const reader = response.body.pipeThrough(new TextDecoderStream()).getReader()
          let buffer = ''
          while (!complete) {
            const { done, value } = await reader.read()
            if (done) throw new TypeError('连接已断开')
            buffer += value
            const lines = buffer.split('\n')
            buffer = lines.pop() || ''
            for (const line of lines) {
              if (!line.trim()) continue
              const event: ChatEvent = JSON.parse(line)
              offset++
              if (event.type === 'error') throw new Error(event.error)
              if (event.type === 'done') { complete = true; break }
              if (event.type === 'status') { phase = event.text; continue }
              if (event.type === 'initial') { blocks = event.messages; continue }
              if (event.type === 'permission') { approvals.set(event.id, event); continue }
              if (event.type === 'permissionClosed') { approvals.delete(event.id); continue }
              const index = indices.get(event.key) ?? blocks.length
              indices.set(event.key, index)
              if (event.type === 'thinking' || event.type === 'thinkingDelta') {
                phase = '正在思考…'
                const previous = blocks[index]?.thinking?.[0] || ''
                const text = event.type === 'thinkingDelta' ? previous + event.text : event.text
                blocks[index] = { kind: 'work', role: 'assistant', label: '思考过程', thinking: [text] }
              } else if (event.type === 'tool') {
                phase = `正在调用 ${event.name}…`
                blocks[index] = { kind: 'work', role: 'assistant', tools: [{ name: event.name, summary: event.summary }] }
              } else if (event.type === 'toolResult') {
                phase = '正在等待模型回复…'
                const tool = blocks[index]?.tools?.[0] || { name: 'result', summary: '' }
                blocks[index] = { kind: 'work', role: 'assistant', tools: [{ ...tool, result: event.text }] }
              } else {
                phase = '正在回复…'
                const text = event.type === 'delta' ? (blocks[index]?.text || '') + event.text : event.text
                blocks[index] = { kind: 'assistant', role: 'assistant', text }
              }
            }
            if (lines.length) publish(true, phase)
          }
        } catch (err) {
          if (controller.signal.aborted || !(err instanceof TypeError)) throw err
          publish(true, '正在重新连接…')
          await new Promise(resolve => setTimeout(resolve, 1000))
        }
      }
    } catch (err) {
      status = controller.signal.aborted ? '已停止生成' : (err instanceof Error ? err.message : String(err))
    } finally {
      if (!controller.signal.aborted && controllers.current.get(id)?.runId === run.id) {
        sessionStorage.setItem(rememberedKey, JSON.stringify(remembered().filter(r => r.id !== run.id)))
        if (expired) {
          // A completed run's replay buffer expires; let App read the durable transcript.
          setTurns(prev => {
            const next = { ...prev }
            delete next[id]
            return next
          })
        } else publish(false, status)
        controllers.current.delete(id)
        await refresh().catch(() => {})
      }
    }
  }

  async function stop(id: string) {
    const conn = controllers.current.get(id)
    if (!conn) return
    const url = `/api/chat/runs/${conn.runId}/stop`
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
    if (!res.ok) throw new Error('停止请求未成功，请重试')
  }

  return { turns, send, clear, stop }
}
