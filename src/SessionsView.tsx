import { useEffect, useMemo, useState } from 'react'
import { api, type Session, type Workspace } from './api'
import { MessageList, type ChatBlock } from './MessageList'

type Props = {
  workspaces: Workspace[]
  onToast: (msg: string, error?: boolean) => void
}

function formatTime(ts: number) {
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function shortPath(p: string | null) {
  if (!p) return '(unknown cwd)'
  const parts = p.split('/')
  if (parts.length <= 4) return p
  return `…/${parts.slice(-3).join('/')}`
}

export function SessionsView({ workspaces, onToast }: Props) {
  const [sessions, setSessions] = useState<Session[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [messages, setMessages] = useState<ChatBlock[]>([])
  const [workspaceId, setWorkspaceId] = useState('')
  const [busy, setBusy] = useState(false)

  const load = async () => {
    setLoading(true)
    try {
      const data = await api.sessions()
      setSessions(data.sessions)
      if (!selectedId && data.sessions[0]) setSelectedId(data.sessions[0].id)
    } catch (e) {
      onToast(e instanceof Error ? e.message : String(e), true)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  useEffect(() => {
    if (!selectedId) {
      setMessages([])
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        const detail = await api.sessionDetail(selectedId)
        if (!cancelled) setMessages(detail.messages)
      } catch {
        if (!cancelled) setMessages([])
      }
    })()
    return () => {
      cancelled = true
    }
  }, [selectedId])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return sessions
    return sessions.filter(
      (s) =>
        s.id.toLowerCase().includes(q) ||
        (s.name || '').toLowerCase().includes(q) ||
        (s.cwd || '').toLowerCase().includes(q) ||
        s.preview.toLowerCase().includes(q),
    )
  }, [sessions, query])

  const selected = sessions.find((s) => s.id === selectedId) || null

  const resume = async () => {
    if (!selected) return
    setBusy(true)
    try {
      const result = await api.launch({
        sessionId: selected.id,
        cwd: selected.cwd,
        workspaceId: workspaceId || null,
      })
      onToast(`已在 Terminal 打开：${result.command}`)
    } catch (e) {
      onToast(e instanceof Error ? e.message : String(e), true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="layout">
      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>历史会话</h2>
            <div className="meta">
              {loading ? '扫描中…' : `${filtered.length} / ${sessions.length}`}
            </div>
          </div>
          <div className="toolbar">
            <input
              className="search"
              placeholder="搜索路径 / 内容 / id"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <button type="button" className="btn" onClick={() => void load()}>
              刷新
            </button>
          </div>
        </div>
        <div className="list">
          {filtered.map((s, i) => (
            <button
              key={s.id}
              type="button"
              className={`row ${selectedId === s.id ? 'active' : ''}`}
              style={{ animationDelay: `${Math.min(i, 12) * 0.03}s` }}
              onClick={() => setSelectedId(s.id)}
            >
              <div className="row-title">
                <strong>{s.name || s.preview.slice(0, 48) || s.id.slice(0, 8)}</strong>
                <time>{formatTime(s.lastActivity)}</time>
              </div>
              <div className="row-path">{shortPath(s.cwd)}</div>
              <div className="row-preview">{s.preview}</div>
            </button>
          ))}
          {!loading && filtered.length === 0 && (
            <div className="empty">
              <strong>没有匹配会话</strong>
              确认本机存在 ~/.claude/projects
            </div>
          )}
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>会话详情</h2>
          {selected && <div className="meta">{selected.id.slice(0, 8)}…</div>}
        </div>
        {!selected ? (
          <div className="empty">
            <strong>选择左侧会话</strong>
            可预览 transcript，并一键 resume
          </div>
        ) : (
          <div className="detail">
            <dl className="kv">
              <div className="kv-item">
                <dt>名称</dt>
                <dd>{selected.name || '—'}</dd>
              </div>
              <div className="kv-item">
                <dt>目录</dt>
                <dd>{selected.cwd || '—'}</dd>
              </div>
              <div className="kv-item">
                <dt>活动</dt>
                <dd>{formatTime(selected.lastActivity)}</dd>
              </div>
            </dl>

            <div className="field">
              <label>附加 Workspace（可选，会再带 --add-dir）</label>
              <select
                className="search"
                value={workspaceId}
                onChange={(e) => setWorkspaceId(e.target.value)}
                style={{ width: '100%' }}
              >
                <option value="">不附加</option>
                {workspaces.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="actions">
              <button
                type="button"
                className="btn primary"
                disabled={busy}
                onClick={() => void resume()}
              >
                Resume 到 Terminal
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  void navigator.clipboard.writeText(
                    `cd ${selected.cwd || '~'} && claude --resume ${selected.id}`,
                  )
                  onToast('已复制 resume 命令')
                }}
              >
                复制命令
              </button>
            </div>

            <div className="messages">
              <div className="meta">最近消息（只读预览）</div>
              <MessageList messages={messages} />
            </div>
          </div>
        )}
      </section>
    </div>
  )
}
