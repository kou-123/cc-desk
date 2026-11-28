import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ImageLightbox,
  copyImageToClipboard,
} from './ImageLightbox'

import {
  api,
  type ClaudeModelMapping,
  type ClaudeProvider,
  type ClaudeSettingsInput,
} from './api'
import {
  ATTACH_ACCEPT,
  fileToAttachment,
  formatBytes,
  revokeAttachment,
  type ChatAttachment,
} from './attachments'
import {
  EFFORT_LEVELS,
  EFFORT_PREF,
  effortFromIndex,
  effortIndex,
  effortLabel,
  readStoredEffort,
  type EffortLevel,
} from './effortLevels'
import {
  PERMISSION_MODES,
  PERMISSION_PREF,
  permissionModeLabel,
  readStoredPermissionMode,
  type PermissionMode,
} from './permissionModes'
import { filterSlashCommands, slashQuery } from './slashCommands'

import type { SendResult } from './usePanelChat'

const preference = 'cc-desk.chat-model'

type ModelOption = { value: string; label: string }

type ContextUsage = {
  usedTokens: number
  windowSize: number
  percent: number | null
}

export type ComposerPayload = {
  prompt: string
  model: string
  permissionMode: PermissionMode
  effort: EffortLevel
  attachments: ChatAttachment[]
}

type Props = {
  sessionId?: string | null
  running?: boolean
  disabled?: boolean
  status?: string
  onSend: (payload: ComposerPayload) => Promise<SendResult>
  onStop?: () => void
  onToast?: (msg: string, error?: boolean) => void
}

function pickMapping(src: Partial<ClaudeModelMapping>): ClaudeModelMapping {
  return {
    anthropicModel: src.anthropicModel || '',
    anthropicModel1m: Boolean(src.anthropicModel1m),
    sonnetModel: src.sonnetModel || '',
    sonnetName: src.sonnetName || '',
    sonnet1m: Boolean(src.sonnet1m),
    opusModel: src.opusModel || '',
    opusName: src.opusName || '',
    opus1m: Boolean(src.opus1m),
    fableModel: src.fableModel || '',
    fableName: src.fableName || '',
    fable1m: Boolean(src.fable1m),
    haikuModel: src.haikuModel || '',
    haikuName: src.haikuName || '',
    haiku1m: Boolean(src.haiku1m),
    subagentModel: src.subagentModel || '',
    subagent1m: Boolean(src.subagent1m),
  }
}

function optionsFromMapping(
  mapping: Partial<ClaudeModelMapping> & { model?: string },
): ModelOption[] {
  const out: ModelOption[] = []
  const push = (value: string, label: string) => {
    const v = String(value || '').trim()
    const l = String(label || value || '').trim()
    if (!v || !l || out.some((o) => o.value === v || o.label === l)) return
    out.push({ value: v, label: l })
  }

  if (mapping.sonnetModel) push('sonnet', mapping.sonnetModel)
  if (mapping.opusModel) push('opus', mapping.opusModel)
  if (mapping.haikuModel) push('haiku', mapping.haikuModel)
  if (mapping.fableModel) push('fable', mapping.fableModel)

  const def = String(mapping.anthropicModel || mapping.model || '').trim()
  if (def) push(def, def)

  return out
}

function pickCurrent(
  providers: ClaudeProvider[],
  settings: Partial<ClaudeModelMapping> & { model?: string; baseUrl?: string },
) {
  const marked = providers.find((p) => p.isCurrent)
  if (marked) return marked
  const url = String(settings.baseUrl || '')
    .trim()
    .replace(/\/+$/, '')
    .toLowerCase()
  if (url) {
    const byUrl = providers.find(
      (p) => p.baseUrl.trim().replace(/\/+$/, '').toLowerCase() === url,
    )
    if (byUrl) return byUrl
  }
  return providers[0] || null
}

export function ChatComposer({
  sessionId,
  running,
  disabled,
  status,
  onSend,
  onStop,
  onToast,
}: Props) {
  const [submitting, setSubmitting] = useState(false)
  const [terminalBusy, setTerminalBusy] = useState(false)
  const [text, setText] = useState('')
  const [options, setOptions] = useState<ModelOption[]>([])
  const [providers, setProviders] = useState<ClaudeProvider[]>([])
  const [currentProvider, setCurrentProvider] = useState<ClaudeProvider | null>(
    null,
  )
  const [choice, setChoice] = useState(
    () => localStorage.getItem(preference) || '',
  )
  const [menuOpen, setMenuOpen] = useState(false)
  const [providerOpen, setProviderOpen] = useState(false)
  const [switching, setSwitching] = useState(false)
  const [slashIndex, setSlashIndex] = useState(0)
  const [contextUsage, setContextUsage] = useState<ContextUsage | null>(null)
  const [attachments, setAttachments] = useState<ChatAttachment[]>([])
  const [attachError, setAttachError] = useState('')
  const [dragging, setDragging] = useState(false)
  const [previewSrc, setPreviewSrc] = useState<string | null>(null)
  const [permissionMode, setPermissionMode] = useState<PermissionMode>(
    readStoredPermissionMode,
  )
  const [effort, setEffort] = useState<EffortLevel>(readStoredEffort)
  const [effortOpen, setEffortOpen] = useState(false)
  const [permOpen, setPermOpen] = useState(false)
  const effortRef = useRef<HTMLDivElement>(null)
  const permRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const slashListRef = useRef<HTMLUListElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const dragDepth = useRef(0)

  const slashHits = filterSlashCommands(slashQuery(text))
  const slashOpen = slashHits.length > 0 && !running

  const applySource = useCallback(
    (
      list: ClaudeProvider[],
      settings: Partial<ClaudeModelMapping> & { model?: string; baseUrl?: string },
    ) => {
      const current = pickCurrent(list, settings)
      setProviders(list)
      setCurrentProvider(current)
      const next = optionsFromMapping(current || settings)
      setOptions(next)
      setChoice((prev) => {
        if (next.some((o) => o.value === prev)) return prev
        const fallback = next[0]?.value || ''
        if (fallback) localStorage.setItem(preference, fallback)
        else localStorage.removeItem(preference)
        return fallback
      })
    },
    [],
  )

  const reload = useCallback(async () => {
    try {
      const [settings, providerRes] = await Promise.all([
        api.claudeSettings(),
        api.claudeProviders().catch(() => null),
      ])
      applySource(providerRes?.providers || [], settings)
    } catch {
      setOptions([])
      setProviders([])
      setCurrentProvider(null)
    }
  }, [applySource])

  useEffect(() => {
    void reload()
    const onFocus = () => void reload()
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onFocus)
    return () => {
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onFocus)
    }
  }, [reload])

  useEffect(() => {
    if (!effortOpen && !permOpen) {
      setProviderOpen(false)
      setMenuOpen(false)
      return
    }
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node
      if (effortOpen && effortRef.current && !effortRef.current.contains(t)) {
        setEffortOpen(false)
        setMenuOpen(false)
        setProviderOpen(false)
      }
      if (permOpen && !permRef.current?.contains(t)) setPermOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (providerOpen) setProviderOpen(false)
      else if (menuOpen) setMenuOpen(false)
      else if (effortOpen) setEffortOpen(false)
      else if (permOpen) setPermOpen(false)
    }
    // Defer so the same click that opened the panel doesn't immediately close it.
    const timer = window.setTimeout(() => {
      document.addEventListener('click', onDoc)
    }, 0)
    document.addEventListener('keydown', onKey)
    return () => {
      window.clearTimeout(timer)
      document.removeEventListener('click', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [effortOpen, menuOpen, providerOpen, permOpen])

  const selected = options.find((o) => o.value === choice) || options[0] || null
  const model = selected?.value || ''
  const modelLabel = selected?.label || '选择模型'
  const canOpen = providers.length > 0 || options.length > 0

  useEffect(() => {
    setSlashIndex(0)
  }, [text])

  useEffect(() => {
    if (!slashOpen) return
    const el = slashListRef.current?.querySelector<HTMLElement>(
      `[data-slash-index="${slashIndex}"]`,
    )
    el?.scrollIntoView({ block: 'nearest' })
  }, [slashIndex, slashOpen, slashHits.length])

  useEffect(() => {
    if (!sessionId) {
      setContextUsage(null)
      return
    }
    let cancelled = false
    const load = () => {
      api
        .sessionContext(sessionId)
        .then((ctx) => {
          if (!cancelled) {
            setContextUsage({
              usedTokens: ctx.usedTokens,
              windowSize: ctx.windowSize,
              percent: ctx.percent,
            })
          }
        })
        .catch(() => {
          if (!cancelled) setContextUsage(null)
        })
    }
    load()
    const timer = window.setInterval(load, running ? 2500 : 8000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [sessionId, running, status])

  useEffect(() => {
    if (!running || !onStop) return
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'c') {
        const t = e.target as HTMLElement | null
        // Don't steal copy from selected text in inputs when not generating intent
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) {
          const sel = window.getSelection()?.toString()
          if (sel) return
        }
        e.preventDefault()
        onStop()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [running, onStop])

  useEffect(() => {
    return () => {
      for (const a of attachments) revokeAttachment(a)
    }
    // Only revoke on unmount; live removals call revokeAttachment themselves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function addFiles(list: FileList | File[] | null | undefined) {
    const files = list ? [...list] : []
    if (!files.length || running || disabled) return
    setAttachError('')
    const next: ChatAttachment[] = []
    for (const file of files) {
      try {
        next.push(await fileToAttachment(file))
      } catch (err) {
        setAttachError(err instanceof Error ? err.message : String(err))
      }
    }
    if (!next.length) return
    setAttachments((prev) => [...prev, ...next].slice(0, 16))
  }

  function removeAttachment(id: string) {
    setAttachments((prev) => {
      const hit = prev.find((a) => a.id === id)
      if (hit) revokeAttachment(hit)
      return prev.filter((a) => a.id !== id)
    })
  }

  function pickModel(value: string) {
    setChoice(value)
    localStorage.setItem(preference, value)
    setMenuOpen(false)
  }

  function applySlash(cmd: string, insertSpace?: boolean) {
    const next = insertSpace ? `${cmd} ` : cmd
    setText(next)
    requestAnimationFrame(() => {
      const el = textareaRef.current
      if (!el) return
      el.focus()
      const pos = next.length
      el.setSelectionRange(pos, pos)
    })
  }

  async function switchProvider(p: ClaudeProvider) {
    if (switching || running || p.id === currentProvider?.id) {
      setProviderOpen(false)
      return
    }
    setSwitching(true)
    try {
      const payload: ClaudeSettingsInput = {
        baseUrl: p.baseUrl,
        apiKey: p.apiKey,
        authField:
          p.authField === 'ANTHROPIC_API_KEY'
            ? 'ANTHROPIC_API_KEY'
            : 'ANTHROPIC_AUTH_TOKEN',
        model: p.model,
        ...pickMapping(p),
      }
      await api.updateClaudeSettings(payload)
      const listed = await api.useClaudeProvider(p.id).catch(() => null)
      applySource(listed?.providers || providers.map((x) => ({
        ...x,
        isCurrent: x.id === p.id,
      })), p)
      setProviderOpen(false)
    } catch {
      await reload()
    } finally {
      setSwitching(false)
    }
  }

  function pickPermission(mode: PermissionMode) {
    setPermissionMode(mode)
    try {
      localStorage.setItem(PERMISSION_PREF, mode)
    } catch {
      /* ignore */
    }
    setPermOpen(false)
  }

  function pickEffort(next: EffortLevel) {
    setEffort(next)
    try {
      localStorage.setItem(EFFORT_PREF, next)
    } catch {
      /* ignore */
    }
  }

  async function submit() {
    const prompt = text.trim()
    if (running || submitting || disabled || (!prompt && !attachments.length)) return
    setSubmitting(true)
    try {
      const result = await onSend({ prompt, model, permissionMode, effort, attachments: [...attachments] })
      setTerminalBusy(result === 'terminal')
      if (result === 'sent') {
        setText(current => current === text ? '' : current)
        setAttachments(current => current.filter(a => !attachments.some(sent => sent.id === a.id)))
        setAttachError('')
      }
    } catch (err) {
      onToast?.(String(err), true)
    } finally {
      setSubmitting(false)
    }
  }

  async function focusTerminal() {
    if (!sessionId) return
    try {
      const result = await api.focusSessionTerminal(sessionId)
      if (!result.active) {
        setTerminalBusy(false)
        onToast?.('终端里的 Claude 已退出，可以发送了')
      }
    } catch (err) {
      onToast?.(err instanceof Error ? err.message : String(err), true)
    }
  }

  const canSend = !disabled && !submitting && !running && (!!text.trim() || attachments.length > 0)

  async function copyPreview(src: string) {
    try {
      await copyImageToClipboard(src)
      onToast?.('已复制图片')
    } catch (err) {
      onToast?.(err instanceof Error ? err.message : String(err), true)
    }
  }

  return (
    <>
    <form
      className="chat-composer"
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
    >
      {terminalBusy && (
        <div className="chat-status" role="status">
          该会话正在终端中使用。退出终端里的 Claude 后即可继续发送。{' '}
          <button type="button" className="btn" onClick={() => void focusTerminal()}>切到终端</button>
        </div>
      )}
      {status && !terminalBusy && (
        <div className="chat-status" role="status">
          {status}
        </div>
      )}
      {attachError ? (
        <div className="chat-attach-error" role="alert">
          {attachError}
        </div>
      ) : null}
      <div
        className={`chat-input-box${dragging ? ' is-dragging' : ''}`}
        onDragEnter={(e) => {
          e.preventDefault()
          dragDepth.current += 1
          setDragging(true)
        }}
        onDragLeave={(e) => {
          e.preventDefault()
          dragDepth.current = Math.max(0, dragDepth.current - 1)
          if (dragDepth.current === 0) setDragging(false)
        }}
        onDragOver={(e) => {
          e.preventDefault()
          e.dataTransfer.dropEffect = 'copy'
        }}
        onDrop={(e) => {
          e.preventDefault()
          dragDepth.current = 0
          setDragging(false)
          void addFiles(e.dataTransfer.files)
        }}
      >
        {slashOpen ? (
          <ul
            ref={slashListRef}
            className="slash-menu"
            role="listbox"
            aria-label="Claude Code 命令"
          >
            {slashHits.map((c, i) => (
              <li key={c.cmd}>
                <button
                  type="button"
                  role="option"
                  data-slash-index={i}
                  aria-selected={i === slashIndex}
                  className={`slash-option${i === slashIndex ? ' active' : ''}`}
                  onMouseEnter={() => setSlashIndex(i)}
                  onClick={() => applySlash(c.cmd, c.insertSpace)}
                >
                  <span className="slash-cmd">{c.cmd}</span>
                  <span className="slash-meta">
                    <span className="slash-label">{c.label}</span>
                    <span className="slash-detail">{c.detail}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        {attachments.length > 0 ? (
          <ul className="chat-attach-list" aria-label="待发送附件">
            {attachments.map((a) => (
              <li key={a.id} className={`chat-attach-item kind-${a.kind}`}>
                {a.previewUrl ? (
                  <button
                    type="button"
                    className="chat-attach-thumb-btn"
                    title="点击放大 · 右键复制"
                    onClick={() => setPreviewSrc(a.previewUrl || null)}
                    onContextMenu={(e) => {
                      e.preventDefault()
                      const src = a.previewUrl
                      if (!src) return
                      void copyImageToClipboard(src)
                        .then(() => onToast?.('已复制图片'))
                        .catch((err) =>
                          onToast?.(
                            err instanceof Error ? err.message : String(err),
                            true,
                          ),
                        )
                    }}
                  >
                    <img
                      src={a.previewUrl}
                      alt={a.name}
                      className="chat-attach-thumb"
                      draggable={false}
                    />
                    <span className="chat-attach-zoom-hint">放大</span>
                  </button>
                ) : (
                  <span className="chat-attach-badge">
                    {a.kind === 'document' ? 'PDF' : 'FILE'}
                  </span>
                )}
                <span className="chat-attach-meta">
                  <span className="chat-attach-name" title={a.name}>
                    {a.name}
                  </span>
                  <span className="chat-attach-size">{formatBytes(a.size)}</span>
                </span>
                <button
                  type="button"
                  className="chat-attach-remove"
                  aria-label={`移除 ${a.name}`}
                  disabled={running}
                  onClick={() => removeAttachment(a.id)}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        <textarea
          ref={textareaRef}
          aria-label="向 Claude 提问"
          placeholder="向 Claude 提问… 可粘贴/拖入图片与文件，输入 / 可选用命令"
          rows={2}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onPaste={(e) => {
            const items = e.clipboardData?.items
            if (!items?.length) return
            const files: File[] = []
            for (const item of items) {
              if (item.kind !== 'file') continue
              const f = item.getAsFile()
              if (f) files.push(f)
            }
            if (!files.length) return
            e.preventDefault()
            void addFiles(files)
          }}
          onKeyDown={(e) => {
            if (slashOpen) {
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                setSlashIndex((i) => (i + 1) % slashHits.length)
                return
              }
              if (e.key === 'ArrowUp') {
                e.preventDefault()
                setSlashIndex(
                  (i) => (i - 1 + slashHits.length) % slashHits.length,
                )
                return
              }
              if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
                e.preventDefault()
                const hit = slashHits[slashIndex] || slashHits[0]
                if (hit) applySlash(hit.cmd, hit.insertSpace)
                return
              }
              if (e.key === 'Escape') {
                e.preventDefault()
                setText('')
                return
              }
            }
            if (
              e.key === 'Enter' &&
              !e.shiftKey &&
              !e.nativeEvent.isComposing &&
              e.nativeEvent.keyCode !== 229
            ) {
              e.preventDefault()
              submit()
            }
          }}
        />
        <input
          ref={fileInputRef}
          type="file"
          multiple
          hidden
          accept={ATTACH_ACCEPT}
          onChange={(e) => {
            void addFiles(e.target.files)
            e.target.value = ''
          }}
        />
        <div className="chat-input-tools">
          <div className="chat-input-tools-left">
            <button
              type="button"
              className="chat-attach-plus"
              disabled={running || disabled}
              title="添加图片或文件（也可粘贴 / 拖入）"
              aria-label="添加图片或文件"
              onClick={() => fileInputRef.current?.click()}
            >
              <span aria-hidden>+</span>
            </button>
            <div
              className={`chat-perm${permOpen ? ' is-open' : ''}`}
              ref={permRef}
            >
              <button
                type="button"
                className="chat-perm-trigger"
                disabled={running || disabled}
                aria-haspopup="listbox"
                aria-expanded={permOpen}
                title="权限模式（对应 Claude Code --permission-mode）"
                onClick={() => {
                  setPermOpen((v) => !v)
                  setEffortOpen(false)
                  setMenuOpen(false)
                }}
              >
                <span className="chat-perm-label">
                  {permissionModeLabel(permissionMode)}
                </span>
              </button>
              {permOpen ? (
                <div
                  className="chat-perm-panel"
                  role="listbox"
                  aria-label="权限模式"
                  onWheel={(e) => e.stopPropagation()}
                >
                  <div className="chat-perm-head">
                    权限模式
                  </div>
                  <ul className="chat-perm-menu">
                    {PERMISSION_MODES.map((m) => (
                      <li key={m.id}>
                        <button
                          type="button"
                          role="option"
                          aria-selected={m.id === permissionMode}
                          className={`chat-perm-option${
                            m.id === permissionMode ? ' active' : ''
                          }`}
                          onClick={() => pickPermission(m.id)}
                        >
                          <span
                            className={`chat-perm-ico kind-${m.icon}`}
                            aria-hidden
                          />
                          <span className="chat-perm-meta">
                            <span className="chat-perm-name">
                              {m.label}
                              <span className="chat-perm-zh"> · {m.labelZh}</span>
                            </span>
                            <span className="chat-perm-detail">{m.detail}</span>
                          </span>
                          {m.id === permissionMode ? (
                            <span className="chat-perm-check">✓</span>
                          ) : null}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          </div>

          <div className="chat-input-tools-right">
            {(() => {
              const pct =
                contextUsage?.percent != null
                  ? Math.min(100, Math.max(0, contextUsage.percent))
                  : null
              const r = 10
              const c = 2 * Math.PI * r
              const dash =
                pct == null ? 0 : (Math.min(100, pct) / 100) * c
              return (
                <div
                  className={`chat-context-ring${
                    pct == null
                      ? ' is-empty'
                      : pct >= 85
                        ? ' is-high'
                        : pct >= 60
                          ? ' is-mid'
                          : ''
                  }`}
                  tabIndex={0}
                  title={
                    pct == null
                      ? '暂无上下文用量'
                      : `上下文约 ${contextUsage!.usedTokens.toLocaleString()} / ${contextUsage!.windowSize.toLocaleString()} tokens（${Math.round(pct)}%）`
                  }
                  aria-label={
                    pct == null
                      ? '暂无上下文用量'
                      : `上下文已用 ${Math.round(pct)}%`
                  }
                >
                  <svg viewBox="0 0 28 28" width="22" height="22" aria-hidden>
                    <circle
                      className="chat-context-track"
                      cx="14"
                      cy="14"
                      r={r}
                      fill="none"
                    />
                    <circle
                      className="chat-context-arc"
                      cx="14"
                      cy="14"
                      r={r}
                      fill="none"
                      strokeDasharray={`${dash} ${c}`}
                      transform="rotate(-90 14 14)"
                    />
                  </svg>
                  <span className="chat-context-tip">
                    {pct == null ? '—' : `${Math.round(pct)}%`}
                  </span>
                </div>
              )
            })()}
            <div
              className={`chat-effort${effortOpen ? ' is-open' : ''}${
                canOpen ? '' : ' is-empty'
              }`}
              ref={effortRef}
            >
              <button
                type="button"
                className="chat-effort-trigger"
                disabled={running || disabled}
                aria-haspopup="dialog"
                aria-expanded={effortOpen}
                title={`${modelLabel} · ${effortLabel(effort)}（点开可改模型与思考强度）`}
                onClick={() => {
                  setEffortOpen((v) => !v)
                  setMenuOpen(false)
                  setProviderOpen(false)
                  setPermOpen(false)
                }}
              >
                <span className="chat-effort-trigger-label">
                  <span className="chat-effort-trigger-model">{modelLabel}</span>
                  <span className="chat-effort-trigger-effort">
                    {effortLabel(effort)}
                  </span>
                </span>
              </button>
              {effortOpen ? (
                <div
                  className={`chat-effort-panel${menuOpen ? ' is-models' : ''}`}
                  role="dialog"
                  aria-label="思考强度"
                  onClick={(e) => e.stopPropagation()}
                >
                  {!menuOpen ? (
                    <>
                      <div className="chat-effort-head">
                        <span className="chat-effort-level">
                          {effortLabel(effort)}
                        </span>
                      </div>
                      <button
                        type="button"
                        className="chat-effort-model"
                        disabled={running}
                        title="选择供应商与模型"
                        onClick={(e) => {
                          e.preventDefault()
                          e.stopPropagation()
                          setProviderOpen(false)
                          setMenuOpen(true)
                          void reload()
                        }}
                      >
                        <span className="chat-effort-model-name">
                          {modelLabel}
                        </span>
                        <span className="chat-effort-model-chev" aria-hidden>
                          ›
                        </span>
                      </button>
                      <div className="chat-effort-slider-wrap">
                        <input
                          type="range"
                          className="chat-effort-slider"
                          min={0}
                          max={EFFORT_LEVELS.length - 1}
                          step={1}
                          value={effortIndex(effort)}
                          aria-valuetext={effortLabel(effort)}
                          aria-label="思考强度"
                          disabled={running}
                          onChange={(e) =>
                            pickEffort(effortFromIndex(Number(e.target.value)))
                          }
                        />
                        <div className="chat-effort-dots" aria-hidden>
                          {EFFORT_LEVELS.map((lv, i) => (
                            <button
                              key={lv.id}
                              type="button"
                              className={`chat-effort-dot${
                                i <= effortIndex(effort) ? ' on' : ''
                              }${i === effortIndex(effort) ? ' active' : ''}`}
                              tabIndex={-1}
                              onClick={() => pickEffort(lv.id)}
                            />
                          ))}
                        </div>
                      </div>
                    </>
                  ) : (
                    <div className="chat-model-panel nested">
                      <button
                        type="button"
                        className="chat-effort-back"
                        onClick={(e) => {
                          e.preventDefault()
                          e.stopPropagation()
                          setMenuOpen(false)
                          setProviderOpen(false)
                        }}
                      >
                        ‹ 思考强度
                      </button>
                      {providers.length > 0 ? (
                        <div className="chat-provider-block">
                          <button
                            type="button"
                            className={`chat-provider-trigger${
                              providerOpen ? ' is-open' : ''
                            }`}
                            disabled={switching || running}
                            onClick={() => setProviderOpen((v) => !v)}
                          >
                            <span
                              className="chat-provider-dot"
                              style={{
                                background:
                                  currentProvider?.iconColor || 'var(--claude)',
                              }}
                            />
                            <span className="chat-provider-name">
                              {currentProvider?.name || '选择供应商'}
                            </span>
                            <span className="chat-provider-chevron">
                              {providerOpen ? '▾' : '›'}
                            </span>
                          </button>
                          {providerOpen ? (
                            <ul className="chat-provider-menu" role="listbox">
                              {providers.map((p) => (
                                <li key={p.id}>
                                  <button
                                    type="button"
                                    role="option"
                                    aria-selected={p.id === currentProvider?.id}
                                    className={`chat-provider-option${
                                      p.id === currentProvider?.id
                                        ? ' active'
                                        : ''
                                    }`}
                                    disabled={switching || running}
                                    onClick={() => void switchProvider(p)}
                                  >
                                    <span
                                      className="chat-provider-dot"
                                      style={{
                                        background:
                                          p.iconColor || 'var(--claude)',
                                      }}
                                    />
                                    <span className="chat-provider-option-name">
                                      {p.name}
                                    </span>
                                    {p.id === currentProvider?.id ? (
                                      <span className="chat-provider-check">
                                        ✓
                                      </span>
                                    ) : null}
                                  </button>
                                </li>
                              ))}
                            </ul>
                          ) : null}
                        </div>
                      ) : null}

                      {!providerOpen ? (
                        options.length > 0 ? (
                          <ul className="chat-model-menu" role="listbox">
                            {options.map((o) => (
                              <li key={o.value}>
                                <button
                                  type="button"
                                  role="option"
                                  aria-selected={o.value === model}
                                  className={`chat-model-option${
                                    o.value === model ? ' active' : ''
                                  }`}
                                  onClick={() => {
                                    pickModel(o.value)
                                    setMenuOpen(false)
                                  }}
                                >
                                  {o.label}
                                </button>
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <div className="chat-model-empty">
                            当前供应商还没有配置模型映射
                          </div>
                        )
                      ) : null}
                    </div>
                  )}
                </div>
              ) : null}
            </div>
            {running ? (
              <button
                className="btn danger chat-stop"
                type="button"
                title="停止生成（⌘/Ctrl+C）"
                onClick={onStop}
              >
                停止生成
              </button>
            ) : (
              <button
                className="btn primary chat-send"
                type="submit"
                disabled={!canSend}
              >
                发送
              </button>
            )}
          </div>
        </div>
      </div>
    </form>
    {previewSrc ? (
      <ImageLightbox
        src={previewSrc}
        onClose={() => setPreviewSrc(null)}
        onCopy={(src) => void copyPreview(src)}
      />
    ) : null}
    </>
  )
}
