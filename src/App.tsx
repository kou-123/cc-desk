import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react'
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
  IconPlus,
  IconRefresh,
  IconSearch,
  IconSettings,
  IconSidebar,
  IconSun,
  IconUser,
  IconX,
} from './icons'
import { ConfirmDialog } from './ConfirmDialog'
import { ChatMinimap } from './ChatMinimap'
import { ErrorBoundary } from './ErrorBoundary'
import { MessageList, type ChatBlock } from './MessageList'
import { useOlderMessages } from './useOlderMessages'
import { ApprovalDetails } from './ApprovalDetails'
import { ChatComposer } from './ChatComposer'
import { usePanelChat, type RunMeta } from './usePanelChat'
import { SettingsPage } from './SettingsPage'
import { Tip } from './Tip'
import { applyFontScale, readFontScale } from './fontScale'
import { readLaunchPrefs, permissionModeToCli } from './launchPrefs'
import { setAppBusy } from './native'
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
  const [savedSessions, setSessions] = useState<Session[]>([])
  const draftContext = useRef(new Map<string, { workspaceId?: string; addDirs: string[] }>())
  const [drafts, setDrafts] = useState<Session[]>([])
  const sessions = useMemo(() => {
    const saved = new Set(savedSessions.map(s => s.id))
    return [...drafts.filter(s => !saved.has(s.id)), ...savedSessions]
  }, [drafts, savedSessions])
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [cliActiveCount, setCliActiveCount] = useState<number | null>(null)
  const [cliActiveTip, setCliActiveTip] = useState('')
  const [query, setQuery] = useState('')
  const [showSearch, setShowSearch] = useState(false)
  const [rail, setRail] = useState<RailTab>('chats')
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [showAll, setShowAll] = useState<Record<string, boolean>>({})
  const [selection, setSelection] = useState<Selection>(() => {
    const id = sessionStorage.getItem('cc-desk.selected-chat')
    return id ? { kind: 'session', id } : null
  })
  useEffect(() => {
    if (selection?.kind === 'session') sessionStorage.setItem('cc-desk.selected-chat', selection.id)
    else sessionStorage.removeItem('cc-desk.selected-chat')
  }, [selection])
  const [messages, setMessages] = useState<ChatBlock[]>([])
  const [historyId, setHistoryId] = useState('')
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
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try {
      return localStorage.getItem('cc-desk.sidebar-collapsed') === '1'
    } catch {
      return false
    }
  })
  const SIDE_MIN = 200
  const SIDE_MAX = 520
  const [sideWidth, setSideWidth] = useState(() => {
    try {
      const n = Number(localStorage.getItem('cc-desk.side-w'))
      if (Number.isFinite(n) && n >= SIDE_MIN && n <= SIDE_MAX) return Math.round(n)
    } catch {
      /* ignore */
    }
    return 280
  })
  const [sidebarResizing, setSidebarResizing] = useState(false)
  const toggleSidebar = () => {
    setSidebarCollapsed((v) => {
      const next = !v
      try {
        localStorage.setItem('cc-desk.sidebar-collapsed', next ? '1' : '0')
      } catch {
        /* ignore */
      }
      return next
    })
  }
  const onSidebarResizeStart = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (sidebarCollapsed || e.button !== 0) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    const startX = e.clientX
    const startW = sideWidth
    setSidebarResizing(true)
    const onMove = (ev: PointerEvent) => {
      const next = Math.min(
        SIDE_MAX,
        Math.max(SIDE_MIN, Math.round(startW + (ev.clientX - startX))),
      )
      setSideWidth(next)
    }
    const onUp = (ev: PointerEvent) => {
      setSidebarResizing(false)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      const next = Math.min(
        SIDE_MAX,
        Math.max(SIDE_MIN, Math.round(startW + (ev.clientX - startX))),
      )
      setSideWidth(next)
      try {
        localStorage.setItem('cc-desk.side-w', String(next))
      } catch {
        /* ignore */
      }
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
  }
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
    const saved = new Set(s.sessions.map(session => session.id))
    setDrafts(prev => prev.filter(draft => !saved.has(draft.id)))
  }, [])

  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  useEffect(() => {
    applyFontScale(readFontScale())
  }, [])

  useEffect(() => {
    refresh().catch((e) =>
      showToast(e instanceof Error ? e.message : String(e), true),
    )
  }, [refresh, showToast])

  // Poll how many Claude Code CLI processes are running on this Mac.
  useEffect(() => {
    let cancelled = false
    const load = () => {
      api
        .claudeCliActive()
        .then((data) => {
          if (cancelled) return
          setCliActiveCount(data.count)
          const lines = (data.processes || []).map((p) => {
            const label =
              p.name ||
              p.cwd ||
              (p.sessionId ? p.sessionId.slice(0, 8) : null) ||
              `pid ${p.pid}`
            const kind = p.kind || 'cli'
            const status = p.status ? ` · ${p.status}` : ''
            return `${kind}: ${label}${status}`
          })
          setCliActiveTip(
            lines.length
              ? `本机正在运行的 Claude CLI（约每 10 秒刷新）\n${lines.join('\n')}`
              : '本机当前没有运行中的 Claude CLI（约每 10 秒刷新）',
          )
        })
        .catch(() => {
          if (!cancelled) {
            setCliActiveCount(null)
            setCliActiveTip('无法读取本机 Claude CLI 进程')
          }
        })
    }
    load()
    const timer = window.setInterval(load, 10_000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [])

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

  const restoreRun = useCallback((run: RunMeta) => {
    setDrafts(prev => prev.some(s => s.id === run.sessionId) ? prev : [...prev, {
      id: run.sessionId, cwd: run.cwd, name: null, projectKey: run.cwd, preview: run.prompt || '新对话',
      messageCount: 0, mtime: run.started, lastActivity: run.started, transcriptPath: '',
    }])
  }, [])
  const chat = usePanelChat(refresh, restoreRun)
  const selectedTurn = selectedSession && chat.turns[selectedSession.id]
  const isDraft = !!selectedSession && !selectedSession.transcriptPath
  const latestMessages = selectedTurn?.messages ||
    (historyId === selectedSession?.id ? messages : [])
  const { messages: visibleMessages, cursor, loadOlder } = useOlderMessages(
    selectedSession?.id, latestMessages, detailScrollRef, showToast,
  )
  const isLive =
    !!selectedSession && liveSessionId === selectedSession.id
  const chatBusy = useMemo(
    () => Object.values(chat.turns).some((t) => t.running),
    [chat.turns],
  )

  // Sidebar attention dots: pending tool confirm, or turn finished while elsewhere.
  const viewingSessionId =
    selection?.kind === 'session' ? selection.id : null
  const prevRunningRef = useRef<Record<string, boolean>>({})
  const [unreadDone, setUnreadDone] = useState<Record<string, true>>({})

  useEffect(() => {
    const prev = prevRunningRef.current
    const next: Record<string, boolean> = {}
    const finished: string[] = []
    for (const [id, turn] of Object.entries(chat.turns)) {
      next[id] = !!turn.running
      if (prev[id] && !turn.running && id !== viewingSessionId) {
        finished.push(id)
      }
    }
    prevRunningRef.current = next
    if (!finished.length) return
    setUnreadDone((m) => {
      const copy = { ...m }
      for (const id of finished) copy[id] = true
      return copy
    })
  }, [chat.turns, viewingSessionId])

  useEffect(() => {
    if (!viewingSessionId) return
    setUnreadDone((m) => {
      if (!m[viewingSessionId]) return m
      const copy = { ...m }
      delete copy[viewingSessionId]
      return copy
    })
  }, [viewingSessionId])

  const sessionAttention = useCallback(
    (id: string) => {
      if (viewingSessionId === id) return false
      const turn = chat.turns[id]
      if (turn?.approvals?.length) return true
      if (unreadDone[id]) return true
      return false
    },
    [viewingSessionId, chat.turns, unreadDone],
  )

  // Warn on window close / Cmd+Q while Claude is still working.
  useEffect(() => {
    setAppBusy(chatBusy)
    return () => setAppBusy(false)
  }, [chatBusy])

  // Auto-expire live sync window
  useEffect(() => {
    if (!liveSessionId) return
    const t = window.setTimeout(() => setLiveSessionId(null), LIVE_SYNC_MS)
    return () => window.clearTimeout(t)
  }, [liveSessionId])

  useLayoutEffect(() => {
    stickBottomRef.current = true
  }, [selectedSession?.id])

  // Poll transcript meta; refetch messages when file changes
  useEffect(() => {
    if (!selectedSession || isDraft || selectedTurn?.running) {
      setHistoryId('')
      setMessages([])
      lastMetaRef.current = null
      return
    }

    const sessionId = selectedSession.id
    let cancelled = false
    let timer = 0
    lastMetaRef.current = null
    let previousTail: ChatBlock[] = []

    const loadDetail = async () => {
      const detail = await api.sessionDetail(sessionId)
      if (cancelled) return
      let next = detail.messages
      const last = previousTail.at(-1)?.historyIndex
      if (last !== undefined && next.length) {
        // An external CLI may append several pages between two polls.
        while (next[0].historyIndex! > last + 1) {
          const older = await api.sessionDetail(sessionId, next[0].historyIndex)
          if (cancelled) return
          if (older.messages.at(-1)?.historyIndex !== next[0].historyIndex! - 1) break
          next = [...older.messages, ...next]
        }
        if (next[0].historyIndex! <= last + 1) {
          next = [...previousTail.filter(b => b.historyIndex! < next[0].historyIndex!), ...next]
        }
      }
      previousTail = next
      setMessages(next)
      setHistoryId(sessionId)
      if (detail.messages.length && !selectedTurn?.status) chat.clear(sessionId)
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
  }, [selectedSession?.id, liveSessionId, refresh, isDraft, selectedTurn?.running])

  // Keep view pinned to bottom when new content arrives (if user was at bottom)
  useEffect(() => {
    const el = detailScrollRef.current
    if (!el || !stickBottomRef.current) return
    el.scrollTop = el.scrollHeight
  }, [messages, selectedTurn?.messages])

  // Tool permission prompts must surface immediately — pin to bottom + focus the card.
  const approvalCount = selectedTurn?.approvals?.length || 0
  useEffect(() => {
    if (!approvalCount) return
    stickBottomRef.current = true
    const scroll = detailScrollRef.current
    if (scroll) scroll.scrollTop = scroll.scrollHeight
    const card = document.querySelector('.tool-approval-dock')
    if (card instanceof HTMLElement) {
      card.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }
  }, [approvalCount, selectedTurn?.approvals])

  useEffect(() => {
    if (projects[0] && Object.keys(expanded).length === 0) {
      setExpanded({ [projects[0].key]: true })
      setSelection(current => current || { kind: 'project', key: projects[0].key })
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

  function isEmptySession(session: Session) {
    if (!session.transcriptPath) return true
    if ((session.messageCount || 0) <= 0) return true
    const preview = (session.preview || '').trim()
    return (
      !preview ||
      preview === '(empty session)' ||
      preview === '新对话'
    )
  }

  const performDeleteSession = async (session: Session) => {
    if (chat.turns[session.id]?.running) {
      showToast('请先停止当前回复', true)
      return
    }
    setBusy(true)
    try {
      if (session.transcriptPath) await api.deleteSession(session.id)
      setDrafts((prev) => prev.filter((draft) => draft.id !== session.id))
      chat.clear(session.id)
      draftContext.current.delete(session.id)
      setUnreadDone((m) => {
        if (!m[session.id]) return m
        const copy = { ...m }
        delete copy[session.id]
        return copy
      })
      if (selection?.kind === 'session' && selection.id === session.id) {
        setSelection(null)
        setMessages([])
      }
      if (liveSessionId === session.id) setLiveSessionId(null)
      await refresh()
      showToast('已删除会话')
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e), true)
    } finally {
      setBusy(false)
    }
  }

  const askDeleteSession = (session: Session) => {
    if (chat.turns[session.id]?.running) return showToast('请先停止当前回复', true)
    setCtx(null)
    if (isEmptySession(session)) {
      void performDeleteSession(session)
      return
    }
    const title = sessionTitle(session)
    setConfirmDlg({
      kind: 'session',
      session,
      title: '删除这条会话？',
      body: `「${title}」\n\n将删除本地 transcript（等价于删掉 ~/.claude/projects 下对应 .jsonl）。\n不可恢复。`,
    })
  }

  const askRemoveProjectNode = (project: ProjectNode) => {
    if (project.sessions.some(s => chat.turns[s.id]?.running)) return showToast('请先停止项目中的回复', true)
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
        setConfirmDlg(null)
        await performDeleteSession(pending.session)
        return
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
        const removedIds = new Set(project.sessions.map(s => s.id))
        for (const id of removedIds) draftContext.current.delete(id)
        setDrafts(prev => prev.filter(draft => !removedIds.has(draft.id)))
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

  function newDraft(cwd: string, addDirs: string[], workspaceId?: string) {
    const now = Date.now()
    const draft: Session = {
      id: crypto.randomUUID(), cwd, name: null, projectKey: cwd, preview: '新对话',
      messageCount: 0, mtime: now, lastActivity: now, transcriptPath: '',
    }
    draftContext.current.set(draft.id, { addDirs, workspaceId })
    setDrafts(prev => [draft, ...prev])
    setSelection({ kind: 'session', id: draft.id })
    return draft
  }

  function launchNew(project?: ProjectNode | null) {
    if (project?.cwd) {
      setExpanded((e) => ({ ...e, [project.key]: true }))
      newDraft(project.cwd, project.addDirs, project.workspace?.id)
      return
    }
    setNewChatOpen(true)
  }

  function sendMessage(payload: {
    prompt: string
    model: string
    permissionMode: string
    effort: string
    attachments: {
      name: string
      mime: string
      kind: 'image' | 'document' | 'file'
      data: string
      previewUrl?: string
    }[]
  }) {
    const cwd = selectedSession?.cwd || selectedProject?.cwd
    if (!cwd) return
    const session = selectedSession || newDraft(cwd, selectedProject?.addDirs || [], selectedProject?.workspace?.id)
    const context = draftContext.current.get(session.id)
    stickBottomRef.current = true
    const attachments = payload.attachments.map(({ name, mime, kind, data }) => ({
      name,
      mime,
      kind,
      data,
    }))
    void chat.send({
      sessionId: session.id,
      prompt: payload.prompt,
      model: payload.model,
      permissionMode: payload.permissionMode,
      effort: payload.effort,
      cwd,
      resume: !!session.transcriptPath,
      workspaceId: context?.workspaceId ?? selectedProject?.workspace?.id,
      addDirs: context?.addDirs ?? selectedProject?.addDirs,
      attachments,
      // Prefer durable data: URLs so previews survive after composer clears
      // blob: object URLs (click-to-zoom / copy keep working in the bubble).
      previewImages: payload.attachments
        .filter((a) => a.kind === 'image')
        .map((a) =>
          a.data
            ? `data:${a.mime || 'image/png'};base64,${a.data}`
            : a.previewUrl || '',
        )
        .filter(Boolean),
      previewFiles: payload.attachments
        .filter((a) => a.kind !== 'image')
        .map((a) => ({ name: a.name, kind: a.kind })),
    }, selectedSession ? latestMessages : [])
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
        newDraft(result.cwd, result.addDirs, workspaceId)
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
    if (!session.transcriptPath || chat.turns[session.id]?.running) return
    setBusy(true)
    try {
      const p = project || selectedProject
      const prefs = readLaunchPrefs()
      const launched = await api.launch({
        sessionId: session.id,
        cwd: session.cwd,
        workspaceId: p?.workspace?.id || null,
        addDirs: p?.addDirs || [],
        model: prefs.model,
        permissionMode: permissionModeToCli(prefs.permissionMode),
        effort: prefs.effort,
      })
      setLiveSessionId(session.id)
      setSelection({ kind: 'session', id: session.id })
      stickBottomRef.current = true
      lastMetaRef.current = null
      if (launched.mode === 'focus') {
        showToast(launched.message || '已切到已有终端中的 Claude CLI')
      } else if (launched.mode === 'attach') {
        showToast(launched.message || '已附着到后台 Claude 会话')
      } else if (launched.mode === 'panel') {
        showToast(launched.message || '该会话 CLI 已在面板运行，未新开终端')
      } else {
        showToast(
          '已在 macOS Terminal 打开 Claude Code（完整交互界面）。右侧「终端预览同步」只是把命令行对话同步回本页。',
        )
      }
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
    <div
      className={`app-shell${sidebarCollapsed ? ' sidebar-collapsed' : ''}${
        sidebarResizing ? ' is-sidebar-resizing' : ''
      }`}
      style={{ ['--side-w' as string]: `${sideWidth}px` }}
      onClick={() => setCtx(null)}
    >
      <nav className="rail" aria-label="Primary">
        <Tip
          label={sidebarCollapsed ? '展开侧边栏' : '折叠侧边栏'}
          delayMs={500}
        >
          <button
            type="button"
            className={`rail-btn${sidebarCollapsed ? ' active' : ''}`}
            aria-label={sidebarCollapsed ? '展开侧边栏' : '折叠侧边栏'}
            aria-pressed={sidebarCollapsed}
            onClick={toggleSidebar}
          >
            <IconSidebar />
          </button>
        </Tip>
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
        <div
          className={`sidebar-resizer${sidebarResizing ? ' is-dragging' : ''}`}
          role="separator"
          aria-orientation="vertical"
          aria-label="调整侧边栏宽度"
          aria-valuemin={SIDE_MIN}
          aria-valuemax={SIDE_MAX}
          aria-valuenow={sideWidth}
          onPointerDown={onSidebarResizeStart}
          onDoubleClick={() => {
            setSideWidth(280)
            try {
              localStorage.setItem('cc-desk.side-w', '280')
            } catch {
              /* ignore */
            }
          }}
        />
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
              <span
                className={`side-attn${sessionAttention(pinnedRecent.id) ? ' on' : ''}`}
                aria-hidden
              />
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
                  const attn = sessionAttention(s.id)
                  return (
                    <div key={s.id} className="session-row">
                      <button
                        type="button"
                        className={`side-item ${selection?.kind === 'session' && selection.id === s.id ? 'active' : ''}`}
                        title={
                          attn
                            ? `${sessionTitle(s)}（需要关注）`
                            : s.cwd || sessionTitle(s)
                        }
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
                        <span
                          className={`side-attn${attn ? ' on' : ''}`}
                          aria-hidden
                        />
                        <span className="label">{sessionTitle(s)}</span>
                      </button>
                      <button
                        type="button"
                        className="session-del"
                        title="删除会话"
                        aria-label={`删除 ${sessionTitle(s)}`}
                        onClick={(e) => {
                          e.preventDefault()
                          e.stopPropagation()
                          askDeleteSession(s)
                        }}
                      >
                        <IconX size={12} />
                      </button>
                    </div>
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
                    <div className="project-row">
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
                      <button
                        type="button"
                        className="project-add"
                        title={`在 ${p.name} 新建会话`}
                        aria-label={`在 ${p.name} 新建会话`}
                        onClick={(e) => {
                          e.preventDefault()
                          e.stopPropagation()
                          launchNew(p)
                        }}
                      >
                        <IconPlus size={14} />
                      </button>
                    </div>
                    {open &&
                      visible.map((s) => {
                        const attn = sessionAttention(s.id)
                        return (
                        <div key={s.id} className="session-row child">
                          <button
                            type="button"
                            className={`side-item child ${selection?.kind === 'session' && selection.id === s.id ? 'active' : ''}`}
                            title={
                              attn
                                ? `${sessionTitle(s)}（需要关注）`
                                : sessionTitle(s)
                            }
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
                            <span
                              className={`side-attn${attn ? ' on' : ''}`}
                              aria-hidden
                            />
                            <span className="label">{sessionTitle(s)}</span>
                          </button>
                          <button
                            type="button"
                            className="session-del"
                            title="删除会话"
                            aria-label={`删除 ${sessionTitle(s)}`}
                            onClick={(e) => {
                              e.preventDefault()
                              e.stopPropagation()
                              askDeleteSession(s)
                            }}
                          >
                            <IconX size={12} />
                          </button>
                        </div>
                        )
                      })}
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
              {selectedProject?.cwd && (
                <ChatComposer
                  key={selectedProject.key}
                  sessionId={null}
                  onSend={sendMessage}
                  onToast={showToast}
                />
              )}
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
                    disabled={busy || isDraft || selectedTurn?.running}
                    title="用 macOS 自带 Terminal.app 打开 Claude Code（交互 TUI，带颜色），并用 --resume 接上当前会话"
                    onClick={() =>
                      void resumeSession(selectedSession, selectedProject)
                    }
                  >
                    Open Claude Code CLI
                  </button>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => {
                      const prefs = readLaunchPrefs()
                      const bits = [
                        `cd ${selectedSession.cwd || '~'}`,
                        '&&',
                        'claude',
                        '--resume',
                        selectedSession.id,
                      ]
                      if (prefs.model) {
                        bits.push('--model', prefs.model)
                      }
                      const perm = permissionModeToCli(prefs.permissionMode)
                      if (perm) bits.push('--permission-mode', perm)
                      if (prefs.effort) bits.push('--effort', prefs.effort)
                      void navigator.clipboard.writeText(bits.join(' '))
                      showToast('已复制命令')
                    }}
                  >
                    Copy command
                  </button>
                  {isLive ? (
                    <span
                      className="live-pill"
                      title="这不是另一个模式：只是把 Terminal 里 Claude Code 的对话同步回本页预览"
                    >
                      <span className="live-dot" />
                      终端预览同步中
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
                        停止预览
                      </button>
                    </span>
                  ) : null}
                </div>
              </div>
              <div className="detail-body">
                <ChatMinimap
                  scrollRef={detailScrollRef}
                  messages={visibleMessages}
                />
                <div
                  className="detail-scroll"
                  ref={detailScrollRef}
                  onScroll={(e) => {
                    const el = e.currentTarget
                    if (el.scrollTop <= 1 && cursor) void loadOlder()
                    stickBottomRef.current =
                      el.scrollHeight - el.scrollTop - el.clientHeight < 96
                  }}
                >
                  {cursor > 0 && <button className="history-earlier" type="button" onClick={() => void loadOlder()}>
                    加载更早的消息
                  </button>}
                  {(visibleMessages.length > 0 || !isDraft) && (
                    <ErrorBoundary fallbackTitle="会话预览出错">
                      <MessageList
                        messages={visibleMessages}
                        onToast={showToast}
                      />
                    </ErrorBoundary>
                  )}
                </div>
              </div>
              <div className="detail-composer-dock">
                {approvalCount > 0 ? (
                  <div className="tool-approval-dock" role="region" aria-label="工具权限确认">
                    {selectedTurn?.approvals.map((approval) => (
                      <section key={approval.id} className="tool-approval">
                        <div className="tool-approval-actions">
                          <strong>允许 Claude 使用 {approval.name}？</strong>
                          <div className="tool-approval-btns">
                            {[true, false].map((allow) => (
                              <button
                                key={String(allow)}
                                type="button"
                                className={allow ? 'btn primary' : 'btn'}
                                onClick={async () => {
                                  try {
                                    const res = await fetch('/api/chat/permission', {
                                      method: 'POST',
                                      headers: {
                                        'Content-Type': 'application/json',
                                      },
                                      body: JSON.stringify({
                                        sessionId: selectedSession.id,
                                        requestId: approval.id,
                                        allow,
                                      }),
                                    })
                                    if (!res.ok) {
                                      throw new Error(
                                        '无法提交决定，请检查请求是否仍在等待确认',
                                      )
                                    }
                                  } catch (err) {
                                    showToast(String(err), true)
                                  }
                                }}
                              >
                                {allow ? '允许这一次' : '拒绝'}
                              </button>
                            ))}
                          </div>
                        </div>
                        <ApprovalDetails preview={approval.preview} input={approval.input} />
                      </section>
                    ))}
                  </div>
                ) : null}
                <ChatComposer
                  key={selectedSession.id}
                  sessionId={selectedSession.id}
                  running={!!selectedTurn?.running}
                  status={selectedTurn?.status}
                  disabled={
                    !(selectedSession.cwd || selectedProject?.cwd) ||
                    (!isDraft &&
                      !selectedTurn &&
                      historyId !== selectedSession.id)
                  }
                  onSend={sendMessage}
                  onStop={() => void chat.stop(selectedSession.id).catch(err => showToast(String(err), true))}
                  onToast={showToast}
                />
              </div>
            </div>
          )}
        </div>

        <footer className="main-foot">
          <div className="crumbs">
            This computer › <strong>{crumb}</strong>
          </div>
          <div
            className="foot-stats"
            title={cliActiveTip || undefined}
          >
            {cliActiveCount != null ? (
              <span
                className={`foot-cli${cliActiveCount > 0 ? ' is-on' : ''}`}
              >
                {cliActiveCount} CLI
              </span>
            ) : (
              <span className="foot-cli">— CLI</span>
            )}
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
