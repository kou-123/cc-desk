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

type Approval = { type: 'permission'; id: string; name: string; input: unknown }
type Turn = { approvals: Approval[]; messages: ChatBlock[]; running: boolean; status: string }
type ChatEvent =
  | { type: 'text' | 'delta'; key: string; text: string }
  | { type: 'tool'; key: string; name: string; summary: string }
  | { type: 'toolResult'; key: string; text: string }
  | Approval
  | { type: 'permissionClosed'; id: string }
  | { type: 'done' }
  | { type: 'error'; error: string }

export function usePanelChat(refresh: () => Promise<void>) {
  const [turns, setTurns] = useState<Record<string, Turn>>({})
  const controllers = useRef(new Map<string, AbortController>())
  useEffect(() => {
    const active = controllers.current
    return () => { for (const controller of active.values()) controller.abort() }
  }, [])

  function clear(id: string) {
    setTurns(prev => {
      if (!prev[id] || prev[id].running) return prev
      const next = { ...prev }
      delete next[id]
      return next
    })
  }

  async function send(request: ChatRequest, history: ChatBlock[]) {
    const id = request.sessionId
    if (controllers.current.has(id)) return
    const controller = new AbortController()
    controllers.current.set(id, controller)
    const blocks: ChatBlock[] = [
      ...history,
      {
        kind: 'user',
        role: 'user',
        text: request.prompt,
        images: request.previewImages?.length ? request.previewImages : undefined,
        files: request.previewFiles?.length ? request.previewFiles : undefined,
      },
    ]
    const indices = new Map<string, number>()
    const approvals = new Map<string, Approval>()
    function publish(running: boolean, status: string) {
      const turn = { approvals: running ? [...approvals.values()] : [], messages: [...blocks], running, status: running && approvals.size ? '等待工具确认' : status }
      setTurns(prev => ({ ...prev, [id]: turn }))
    }
    publish(true, '正在回复…')
    let status = ''
    try {
      const response = await fetch('/api/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request), signal: controller.signal,
      })
      if (!response.ok) throw new Error((await response.json()).error || response.statusText)
      if (!response.body) throw new Error('无法读取回复流')
      const reader = response.body.pipeThrough(new TextDecoderStream()).getReader()
      let buffer = ''
      let complete = false
      for (;;) {
        const { done, value } = await reader.read()
        buffer += value || ''
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''
        for (const line of lines) {
          if (!line.trim()) continue
          const event: ChatEvent = JSON.parse(line)
          if (event.type === 'error') throw new Error(event.error)
          if (event.type === 'done') { complete = true; continue }
          if (event.type === 'permission') {
            approvals.set(event.id, event)
            publish(true, '等待工具确认')
            continue
          }
          if (event.type === 'permissionClosed') {
            approvals.delete(event.id)
            publish(true, approvals.size ? '等待工具确认' : '正在回复…')
            continue
          }
          const index = indices.get(event.key) ?? blocks.length
          indices.set(event.key, index)
          if (event.type === 'tool') {
            blocks[index] = { kind: 'work', role: 'assistant', tools: [{ name: event.name, summary: event.summary }] }
          } else if (event.type === 'toolResult') {
            const tool = blocks[index]?.tools?.[0] || { name: 'result', summary: '' }
            blocks[index] = { kind: 'work', role: 'assistant', tools: [{ ...tool, result: event.text }] }
          } else {
            const text = event.type === 'delta' ? (blocks[index]?.text || '') + event.text : event.text
            blocks[index] = { kind: 'assistant', role: 'assistant', text }
          }
        }
        if (lines.length) publish(true, '正在回复…')
        if (done) break
      }
      if (!complete) throw new Error('连接中断，未收到完整回复')
    } catch (err) {
      status = controller.signal.aborted ? '已停止生成' : (err instanceof Error ? err.message : String(err))
      controller.abort()
    } finally {
      publish(false, status)
      controllers.current.delete(id)
      await refresh().catch(() => {})
    }
  }

  return { turns, send, clear, stop: (id: string) => controllers.current.get(id)?.abort() }
}
