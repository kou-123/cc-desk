import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, type Session, type Workspace } from './api'
import {
  EditProjectModal,
  workspaceToDraft,
  type ProjectDraft,
} from './EditProjectModal'
import { NewChatModal, type NewChatResult } from './NewChatModal'
import {
  basename,
  buildProjects,
  collectKnownRoots,
  recentSessions,
  sessionTitle,
  type ProjectNode,
} from './lib'
import {
  IconChevron,
  IconCompose,
  IconFolder,
  IconFolderOpen,
  IconHome,
  IconMoon,
  IconRefresh,
  IconSearch,
  IconSettings,
  IconSun,
  IconUser,
} from './icons'
import { ConfirmDialog } from './ConfirmDialog'
import { MessageList, type ChatBlock } from './MessageList'
import { SettingsPage } from './SettingsPage'
import { Tip } from './Tip'
import { applyTheme, readTheme, toggleTheme, type ThemeMode } from './theme'

type Selection =
  | { kind: 'session'; id: string }
  | { kind: 'project'; key: string }
  | null

type Ctx =
  | {
      kind: 'project'
      x: number
      y: number
      project: ProjectNode
    }
  | {
      kind: 'session'
      x: number
      y: number
      project: ProjectNode
      session: Session
    }
  | null

type RailTab = 'home' | 'chats' | 'recents'

type PendingConfirm =
  | {
      kind: 'session'
      session: Session
      title: string
      body: string
    }
  | {
      kind: 'project'
      project: ProjectNode
      title: string
      body: string
    }
  | {
      kind: 'workspace'
      title: string
      body: string
    }

const SESSION_PREVIEW = 5
/** After Resume, poll transcript aggressively for this long. */
const LIVE_SYNC_MS = 30 * 60 * 1000
const LIVE_POLL_MS = 1500
const IDLE_POLL_MS = 5000

export default function App() {
  const [sessions, setSessions] = useState<Session[]>([])
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [query, setQuery] = useState('')
  const [showSearch, setShowSearch] = useState(false)
  const [rail, setRail] = useState<RailTab>('chats')
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [showAll, setShowAll] = useState<Record<string, boolean>>({})
  const [selection, setSelection] = useState<Selection>(null)
  const [messages, setMessages] = useState<ChatBlock[]>([])
  const [ctx, setCtx] = useState<Ctx>(null)
  const [editing, setEditing] = useState<ProjectDraft | null>(null)
  const [editStartPick, setEditStartPick] = useState(false)
  const [newChatOpen, setNewChatOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [theme, setTheme] = useState<ThemeMode>(() => readTheme())
  const [toast, setToast] = useState<{ msg: string; error?: boolean } | null>(
    null,
  )
  /** Session id currently being live-synced after Resume. */
  const [liveSessionId, setLiveSessionId] = useState<string | null>(null)
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null)
  const [confirmDlg, setConfirmDlg] = useState<PendingConfirm | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const detailScrollRef = useRef<HTMLDivElement>(null)
  const stickBottomRef = useRef(true)
  const lastMetaRef = useRef<{ mtimeMs: number; size: number } | null>(null)

  const showToast = useCallback((msg: string, error = false) => {
    setToast({ msg, error })
    window.setTimeout(() => setToast(null), 3200)
  }, [])

  const refresh = useCallback(async () => {
    const [s, w] = await Promise.all([api.sessions(), api.workspaces()])
    setSessions(s.sessions)
    setWorkspaces(w.workspaces)
  }, [])

  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  useEffect(() => {
    refresh().catch((e) =>
      showToast(e instanceof Error ? e.message : String(e), true),
    )
  }, [refresh, showToast])

  const projects = useMemo(
    () => buildProjects(sessions, workspaces),
    [sessions, workspaces],
  )

  const knownRoots = useMemo(
    () => collectKnownRoots(sessions, workspaces),
    [sessions, workspaces],
  )

  const q = query.trim().toLowerCase()
  const filteredProjects = useMemo(() => {
    if (!q) return projects
    return projects
      .map((p) => ({
        ...p,
        sessions: p.sessions.filter(
          (s) =>
            sessionTitle(s).toLowerCase().includes(q) ||
            (s.cwd || '').toLowerCase().includes(q) ||
            s.id.toLowerCase().includes(q),
        ),
      }))
      .filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          (p.cwd || '').toLowerCase().includes(q) ||
          p.sessions.length > 0,
      )
  }, [projects, q])

  const recents = useMemo(() => recentSessions(sessions, 8), [sessions])

  const selectedSession = useMemo(() => {
    if (selection?.kind !== 'session') return null
    return sessions.find((s) => s.id === selection.id) || null
  }, [selection, sessions])

  const selectedProject = useMemo(() => {
    if (selection?.kind === 'project') {
      return projects.find((p) => p.key === selection.key) || null
    }
    if (selectedSession) {
      return (
        projects.find((p) =>
          p.sessions.some((s) => s.id === selectedSession.id),
        ) || null
      )
    }
    return null
  }, [selection, projects, selectedSession])

  const isLive =
    !!selectedSession && liveSessionId === selectedSession.id

  // Auto-expire live sync window
  useEffect(() => {
    if (!liveSessionId) return
    const t = window.setTimeout(() => setLiveSessionId(null), LIVE_SYNC_MS)
    return () => window.clearTimeout(t)
  }, [liveSessionId])

  // Poll transcript meta; refetch messages when file changes
  useEffect(() => {
    if (!selectedSession) {
      setMessages([])
      lastMetaRef.current = null
      return
    }

    const sessionId = selectedSession.id
    let cancelled = false
    let timer = 0
    lastMetaRef.current = null
    stickBottomRef.current = true

    const loadDetail = async () => {
      const detail = await api.sessionDetail(sessionId)
      if (cancelled) return
      setMessages(detail.messages)
      setLastSyncedAt(Date.now())
    }

    const tick = async () => {
      if (cancelled) return
      if (document.hidden) {
        timer = window.setTimeout(tick, IDLE_POLL_MS)
        return
      }
      try {
        const meta = await api.sessionMeta(sessionId)
        if (cancelled) return
        const prev = lastMetaRef.current
        const changed =
          !prev ||
          prev.mtimeMs !== meta.mtimeMs ||
          prev.size !== meta.size
        if (changed) {
          lastMetaRef.current = {
            mtimeMs: meta.mtimeMs,
            size: meta.size,
          }
          await loadDetail()
          // Keep sidebar previews fresh while live-syncing
          if (liveSessionId === sessionId) {
            await refresh().catch(() => {})
          }
        }
      } catch {
        // First open may race; still try full detail once
        if (!lastMetaRef.current) {
          try {
            await loadDetail()
          } catch {
            if (!cancelled) setMessages([])
          }
        }
      }
      if (cancelled) return
      const live = liveSessionId === sessionId
      timer = window.setTimeout(tick, live ? LIVE_POLL_MS : IDLE_POLL_MS)
    }

    void tick()
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [selectedSession?.id, liveSessionId, refresh])

  // Keep view pinned to bottom when new content arrives (if user was at bottom)
  useEffect(() => {
    const el = detailScrollRef.current
    if (!el || !stickBottomRef.current) return
    el.scrollTop = el.scrollHeight
  }, [messages])

  useEffect(() => {
    if (projects[0] && Object.keys(expanded).length === 0) {
      setExpanded({ [projects[0].key]: true })
      setSelection({ kind: 'project', key: projects[0].key })
    }
  }, [projects, expanded])

  const openEdit = (project: ProjectNode, startPick = false) => {
    setCtx(null)
    setEditStartPick(startPick)
    if (project.workspace) {
      setEditing(workspaceToDraft(project.workspace))
    } else {
      setEditing({
        name: project.name,
        cwd: project.cwd,
        addDirs: [],
      })
    }
  }

  const saveProject = async (draft: ProjectDraft) => {
    setBusy(true)
    try {
      if (draft.id) {
        await api.updateWorkspace(draft.id, {
          name: draft.name,
          cwd: draft.cwd,
          addDirs: draft.addDirs,
        })
      } else {
        const { workspace } = await api.createWorkspace({
          name: draft.name,
          cwd: draft.cwd,
          addDirs: draft.addDirs,
        })
        setSelection({ kind: 'project', key: `ws:${workspace.id}` })
        setExpanded((e) => ({ ...e, [`ws:${workspace.id}`]: true }))
      }
      await refresh()
      setEditing(null)
      setEditStartPick(false)
      showToast('已保存 project')
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e), true)
    } finally {
      setBusy(false)
    }
  }

  const askDeleteSession = (session: Session) => {
    const title = sessionTitle(session)
    setCtx(null)
    setConfirmDlg({
      kind: 'session',
      session,
      title: '删除这条会话？',
      body: `「${title}」\n\n将删除本地 transcript（等价于删掉 ~/.claude/projects 下对应 .jsonl）。\n不可恢复。`,
    })
  }

  const askRemoveProjectNode = (project: ProjectNode) => {
    const n = project.sessions.length
    setCtx(null)
    setConfirmDlg({
      kind: 'project',
      project,
      title: `移除项目「${project.name}」？`,
      body: project.workspace
        ? `• 删除 CC Desk 里的 workspace\n• 并用 claude purge 清除该目录下 Claude Code 本地数据（约 ${n} 条会话）\n\n不可恢复。`
        : `将清除约 ${n} 条会话的 Claude Code 本地数据（claude purge / 删除 transcript）。\n不可恢复。`,
    })
  }

  const removeProject = async () => {
    if (!editing?.id) return
    setConfirmDlg({
      kind: 'workspace',
      title: '删除这个 local project？',
      body: '仅移除 CC Desk 中的 workspace 分组，不会自动 purge Claude Code 数据。',
    })
  }

  const runConfirm = async () => {
    if (!confirmDlg) return
    const pending = confirmDlg
    setBusy(true)
    try {
      if (pending.kind === 'session') {
        const session = pending.session
        await api.deleteSession(session.id)
        if (selection?.kind === 'session' && selection.id === session.id) {
          setSelection(null)
          setMessages([])
        }
        if (liveSessionId === session.id) setLiveSessionId(null)
        await refresh()
        showToast('已删除会话')
      } else if (pending.kind === 'project') {
        const project = pending.project
        await api.removeProject({
          workspaceId: project.workspace?.id || null,
          cwd: project.cwd,
          sessionIds: project.sessions.map((s) => s.id),
          purgeClaude: true,
        })
        if (
          selection?.kind === 'project' &&
          selection.key === project.key
        ) {
          setSelection(null)
        }
        if (
          selection?.kind === 'session' &&
          project.sessions.some((s) => s.id === selection.id)
        ) {
          setSelection(null)
          setMessages([])
        }
        await refresh()
        showToast('已移除项目')
      } else if (pending.kind === 'workspace') {
        if (!editing?.id) return
        await api.deleteWorkspace(editing.id)
        await refresh()
        setEditing(null)
        showToast('已删除')
      }
      setConfirmDlg(null)
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e), true)
    } finally {
      setBusy(false)
    }
  }

  const launchNew = async (project?: ProjectNode | null) => {
    setBusy(true)
    try {
      const p = project || selectedProject
      if (!p?.cwd) {
        setNewChatOpen(true)
        return
      }
      const result = await api.launch({
        workspaceId: p.workspace?.id || null,
        cwd: p.cwd,
        addDirs: p.addDirs || [],
        name: p.name || 'CC Desk',
      })
      showToast(`已启动：${result.command}`)
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e), true)
    } finally {
      setBusy(false)
    }
  }

  const confirmNewChat = async (result: NewChatResult) => {
    setBusy(true)
    try {
      let workspaceId = result.workspaceId || null
      if (!workspaceId) {
        const { workspace } = await api.createWorkspace({
          name: result.name || basename(result.cwd),
          cwd: result.cwd,
          addDirs: result.addDirs,
        })
        workspaceId = workspace.id
        setSelection({ kind: 'project', key: `ws:${workspace.id}` })
        setExpanded((e) => ({ ...e, [`ws:${workspace.id}`]: true }))
      } else {
        const key =
          projects.find((p) => p.workspace?.id === workspaceId)?.key ||
          `ws:${workspaceId}`
        setSelection({ kind: 'project', key })
        setExpanded((e) => ({ ...e, [key]: true }))
      }
      await refresh()
      setNewChatOpen(false)

      if (result.startNow) {
        const launched = await api.launch({
          workspaceId,
          cwd: result.cwd,
          addDirs: result.addDirs,
          name: result.name,
        })
        showToast(`已启动：${launched.command}`)
      } else {
        showToast(`已保存工作空间「${result.name}」`)
      }
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e), true)
    } finally {
      setBusy(false)
    }
  }

  const resumeSession = async (
    session: Session,
    project?: ProjectNode | null,
  ) => {
    setBusy(true)
    try {
      const p = project || selectedProject
      const result = await api.launch({
        sessionId: session.id,
        cwd: session.cwd,
        workspaceId: p?.workspace?.id || null,
        addDirs: p?.addDirs || [],
      })
      setLiveSessionId(session.id)
      setSelection({ kind: 'session', id: session.id })
      stickBottomRef.current = true
      lastMetaRef.current = null
      showToast(`已 Resume，CC Desk 将自动同步：${result.command}`)
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e), true)
    } finally {
      setBusy(false)
    }
  }

  const crumb =
    selectedProject?.name ||
    (selectedSession ? sessionTitle(selectedSession) : 'CC Desk')

  // Only pin a recent chat when it has a human-readable title (not raw uuid)
  const pinnedRecent = useMemo(() => {
    const s = recents[0]
    if (!s) return null
    const title = sessionTitle(s)
    if (!title || title === s.id.slice(0, 8)) return null
    return s
  }, [recents])

  return (
    <div className="app-shell" onClick={() => setCtx(null)}>
      <nav className="rail" aria-label="Primary">
        <Tip label="回到首页" delayMs={800}>
          <button
            type="button"
            className={`rail-btn ${rail === 'home' && !selection ? 'active' : ''}`}
            aria-label="回到首页"
            onClick={() => {
              setSettingsOpen(false)
              setRail('chats')
              setSelection(null)
            }}
          >
            <IconHome />
          </button>
        </Tip>
        <div className="rail-spacer" />
        <Tip
          label={theme === 'dark' ? '切换明亮风格' : '切换暗色风格'}
          delayMs={800}
        >
          <button
            type="button"
            className="rail-btn"
            aria-label={theme === 'dark' ? '切换明亮风格' : '切换暗色风格'}
            onClick={() => setTheme((t) => toggleTheme(t))}
          >
            {theme === 'dark' ? <IconSun /> : <IconMoon />}
          </button>
        </Tip>
        <Tip label="刷新会话列表" delayMs={800}>
          <button
            type="button"
            className="rail-btn"
            aria-label="刷新会话列表"
            onClick={() => {
              void refresh().then(() => showToast('已刷新会话列表'))
            }}
          >
            <IconRefresh size={18} />
          </button>
        </Tip>
        <Tip label="设置" delayMs={800}>
          <button
            type="button"
            className={`rail-btn ${settingsOpen ? 'active' : ''}`}
            aria-label="设置"
            onClick={() => setSettingsOpen((v) => !v)}
          >
            <IconSettings size={18} />
          </button>
        </Tip>
      </nav>

      {settingsOpen ? (
        <SettingsPage
          busy={busy}
          onClose={() => setSettingsOpen(false)}
          onToast={showToast}
        />
      ) : null}

      {!settingsOpen ? (
      <>
      <aside className="sidebar">
        <div className="sidebar-head">
          <button type="button" className="sidebar-brand">
            <span className="brand-prefix">CC</span>{' '}
            <span className="brand-mark">Desk</span>
            <IconChevron className="chev-ico" />
          </button>
          <div className="sidebar-tools">
            <button
              type="button"
              className="icon-btn"
              title="搜索"
              onClick={() => setShowSearch((v) => !v)}
            >
              <IconSearch />
            </button>
            <button
              type="button"
              className="icon-btn"
              title="刷新"
              onClick={() => void refresh().then(() => showToast('已刷新'))}
            >
              <IconRefresh />
            </button>
          </div>
        </div>

        {showSearch && (
          <input
            className="search-inline"
            placeholder="搜索会话 / 项目"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
          />
        )}

        <div className="sidebar-scroll">
          <button
            type="button"
            className="side-item action"
            onClick={() => setNewChatOpen(true)}
          >
            <span className="ico">
              <IconCompose />
            </span>
            <span className="label">New chat</span>
          </button>

          {pinnedRecent && (
            <button
              type="button"
              className={`side-item ${selection?.kind === 'session' && selection.id === pinnedRecent.id ? 'active' : ''}`}
              title="最近会话"
              onClick={() =>
                setSelection({ kind: 'session', id: pinnedRecent.id })
              }
            >
              <span className="ico avatar">
                <IconUser />
              </span>
              <span className="label">{sessionTitle(pinnedRecent)}</span>
            </button>
          )}

          {rail === 'recents' ? (
            <div className="side-section">
              <div className="side-label">Recents</div>
              {recents.length === 0 ? (
                <div className="side-empty">暂无最近会话</div>
              ) : (
                recents.map((s) => {
                  const project =
                    projects.find((p) =>
                      p.sessions.some((x) => x.id === s.id),
                    ) || null
                  return (
                    <button
                      key={s.id}
                      type="button"
                      className={`side-item ${selection?.kind === 'session' && selection.id === s.id ? 'active' : ''}`}
                      title={s.cwd || sessionTitle(s)}
                      onClick={() =>
                        setSelection({ kind: 'session', id: s.id })
                      }
                      onDoubleClick={() => {
                        if (project) void resumeSession(s, project)
                      }}
                      onContextMenu={(e) => {
                        if (!project) return
                        e.preventDefault()
                        e.stopPropagation()
                        setCtx({
                          kind: 'session',
                          x: e.clientX,
                          y: e.clientY,
                          project,
                          session: s,
                        })
                      }}
                    >
                      <span className="label">{sessionTitle(s)}</span>
                    </button>
                  )
                })
              )}
            </div>
          ) : (
            <div className="side-section">
              <div className="side-label">Projects</div>
              {filteredProjects.map((p) => {
                const open = !!expanded[p.key]
                const limit = showAll[p.key]
                  ? p.sessions.length
                  : SESSION_PREVIEW
                const visible = p.sessions.slice(0, limit)
                const more = p.sessions.length - visible.length
                return (
                  <div
                    key={p.key}
                    className={`project-block ${open ? 'open' : ''}`}
                  >
                    <button
                      type="button"
                      className={`side-item project ${selection?.kind === 'project' && selection.key === p.key ? 'active' : ''}`}
                      onClick={() => {
                        setExpanded((e) => ({
                          ...e,
                          [p.key]: !expanded[p.key],
                        }))
                        setSelection({ kind: 'project', key: p.key })
                      }}
                      onContextMenu={(e) => {
                        e.preventDefault()
                        e.stopPropagation()
                        setCtx({
                          kind: 'project',
                          x: e.clientX,
                          y: e.clientY,
                          project: p,
                        })
                      }}
                    >
                      <span className="ico">
                        {open ? <IconFolderOpen /> : <IconFolder />}
                      </span>
                      <span className="label">{p.name}</span>
                    </button>
                    {open &&
                      visible.map((s) => (
                        <button
                          key={s.id}
                          type="button"
                          className={`side-item child ${selection?.kind === 'session' && selection.id === s.id ? 'active' : ''}`}
                          onClick={() =>
                            setSelection({ kind: 'session', id: s.id })
                          }
                          onDoubleClick={() => void resumeSession(s, p)}
                          onContextMenu={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                            setCtx({
                              kind: 'session',
                              x: e.clientX,
                              y: e.clientY,
                              project: p,
                              session: s,
                            })
                          }}
                        >
                          <span className="label">{sessionTitle(s)}</span>
                        </button>
                      ))}
                    {open && more > 0 && (
                      <button
                        type="button"
                        className="show-more"
                        onClick={() =>
                          setShowAll((m) => ({ ...m, [p.key]: true }))
                        }
                      >
                        Show more
                      </button>
                    )}
                  </div>
                )
              })}
              {filteredProjects.length === 0 && (
                <div className="side-empty">暂无项目 / 会话</div>
              )}
            </div>
          )}
        </div>

        <div className="sidebar-foot">
          <button
            type="button"
            className={`side-item foot${rail === 'recents' ? ' active' : ''}`}
            onClick={() =>
              setRail((r) => (r === 'recents' ? 'chats' : 'recents'))
            }
          >
            <span className="label">
              {rail === 'recents' ? 'Projects' : 'Recents'}
            </span>
            <span className="foot-chev">›</span>
          </button>
        </div>
      </aside>

      <main className="main">
        <div className="main-body">
          {!selectedSession ? (
            <div className="hero">
              <h1>
                What should we build
                {selectedProject ? (
                  <>
                    {' '}
                    in <span className="accent">{selectedProject.name}</span>
                  </>
                ) : (
                  ''
                )}
                ?
              </h1>
              <p>
                工作空间 = 一组本地文件夹（Primary + 可选附加目录）。New chat
                会先选项目或新建工作空间，再启动 Claude Code。
              </p>
              <div className="hero-actions">
                <button
                  type="button"
                  className="btn primary"
                  disabled={busy}
                  onClick={() => setNewChatOpen(true)}
                >
                  New chat
                </button>
                {selectedProject && (
                  <button
                    type="button"
                    className="btn"
                    onClick={() => openEdit(selectedProject)}
                  >
                    Edit project
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="detail-wrap">
              <div className="detail-head">
                <h2 className="detail-title">{sessionTitle(selectedSession)}</h2>
                <div className="detail-meta">{selectedSession.cwd || '—'}</div>
                <div className="hero-actions detail-actions">
                  <button
                    type="button"
                    className="btn primary"
                    disabled={busy}
                    onClick={() =>
                      void resumeSession(selectedSession, selectedProject)
                    }
                  >
                    Resume in Terminal
                  </button>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => {
                      void navigator.clipboard.writeText(
                        `cd ${selectedSession.cwd || '~'} && claude --resume ${selectedSession.id}`,
                      )
                      showToast('已复制命令')
                    }}
                  >
                    Copy command
                  </button>
                  {isLive ? (
                    <span className="live-pill" title="Terminal 中的更新会自动同步到此预览">
                      <span className="live-dot" />
                      同步中
                      {lastSyncedAt ? (
                        <span className="live-time">
                          {new Date(lastSyncedAt).toLocaleTimeString()}
                        </span>
                      ) : null}
                      <button
                        type="button"
                        className="live-stop"
                        onClick={() => setLiveSessionId(null)}
                      >
                        停止
                      </button>
                    </span>
                  ) : null}
                </div>
              </div>
              <div
                className="detail-scroll"
                ref={detailScrollRef}
                onScroll={(e) => {
                  const el = e.currentTarget
                  stickBottomRef.current =
                    el.scrollHeight - el.scrollTop - el.clientHeight < 96
                }}
              >
                <MessageList messages={messages} onToast={showToast} />
              </div>
            </div>
          )}
        </div>

        <footer className="main-foot">
          <div className="crumbs">
            This computer › <strong>{crumb}</strong>
          </div>
          <div>
            {sessions.length} sessions · {workspaces.length} workspaces
          </div>
        </footer>
      </main>
      </>
      ) : null}

      {ctx?.kind === 'project' && (
        <>
          <div className="ctx-backdrop" />
          <div
            className="ctx-menu"
            style={{
              top: Math.min(ctx.y, window.innerHeight - 260),
              left: Math.min(ctx.x, window.innerWidth - 240),
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              className="ctx-item"
              onClick={() => openEdit(ctx.project)}
            >
              Edit project…
            </button>
            <button
              type="button"
              className="ctx-item"
              onClick={() => {
                setCtx(null)
                void launchNew(ctx.project)
              }}
            >
              New chat here
            </button>
            <div className="ctx-sep" />
            <button
              type="button"
              className="ctx-item"
              onClick={() => {
                setExpanded((e) => ({ ...e, [ctx.project.key]: true }))
                setSelection({ kind: 'project', key: ctx.project.key })
                setCtx(null)
              }}
            >
              Reveal sessions
            </button>
            <div className="ctx-sep" />
            <button
              type="button"
              className="ctx-item danger"
              onClick={() => askRemoveProjectNode(ctx.project)}
            >
              Remove project…
            </button>
          </div>
        </>
      )}

      {ctx?.kind === 'session' && (
        <>
          <div className="ctx-backdrop" />
          <div
            className="ctx-menu"
            style={{
              top: Math.min(ctx.y, window.innerHeight - 180),
              left: Math.min(ctx.x, window.innerWidth - 240),
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              className="ctx-item"
              onClick={() => {
                setSelection({ kind: 'session', id: ctx.session.id })
                setCtx(null)
              }}
            >
              Open
            </button>
            <button
              type="button"
              className="ctx-item"
              onClick={() => {
                setCtx(null)
                void resumeSession(ctx.session, ctx.project)
              }}
            >
              Resume in Terminal
            </button>
            <div className="ctx-sep" />
            <button
              type="button"
              className="ctx-item danger"
              onClick={() => askDeleteSession(ctx.session)}
            >
              Delete session…
            </button>
          </div>
        </>
      )}

      {newChatOpen && (
        <NewChatModal
          projects={projects}
          preferredKey={selectedProject?.key}
          busy={busy}
          onClose={() => setNewChatOpen(false)}
          onConfirm={confirmNewChat}
        />
      )}

      {editing && (
        <EditProjectModal
          initial={editing}
          knownRoots={knownRoots}
          startPicking={editStartPick}
          busy={busy}
          onClose={() => {
            setEditing(null)
            setEditStartPick(false)
          }}
          onSave={saveProject}
          onRemove={editing.id ? removeProject : undefined}
        />
      )}

      {confirmDlg && (
        <ConfirmDialog
          title={confirmDlg.title}
          body={confirmDlg.body}
          confirmLabel="删除"
          busy={busy}
          onCancel={() => {
            if (!busy) setConfirmDlg(null)
          }}
          onConfirm={() => void runConfirm()}
        />
      )}

      {toast && (
        <div className={`toast ${toast.error ? 'error' : ''}`}>{toast.msg}</div>
      )}
    </div>
  )
}
