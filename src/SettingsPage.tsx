import { useEffect, useMemo, useState } from 'react'
import {
  api,
  type ClaudeCliInfo,
  type ClaudeMcpServer,
  type ClaudeMcpTool,
  type ClaudeModelMapping,
  type ClaudeProvider,
  type ClaudeProviderInput,
  type ClaudeSettings,
  type ClaudeSkill,
} from './api'
import { ConfirmDialog } from './ConfirmDialog'
import {
  applyFontScale,
  FONT_PX_DEFAULT,
  FONT_PX_MAX,
  FONT_PX_MIN,
  FONT_SCALE_OPTIONS,
  formatFontPx,
  readFontPx,
  readFontScale,
  type FontScaleId,
} from './fontScale'

const DEFAULT_UPDATE_CMD =
  'npm install -g @anthropic-ai/claude-code@latest'

type Props = {
  busy?: boolean
  onClose: () => void
  onToast: (msg: string, error?: boolean) => void
}

type TabId = 'model' | 'skills' | 'mcp' | 'appearance' | 'about'

const emptyMapping: ClaudeModelMapping = {
  anthropicModel: '',
  anthropicModel1m: false,
  sonnetModel: '',
  sonnetName: '',
  sonnet1m: false,
  opusModel: '',
  opusName: '',
  opus1m: false,
  fableModel: '',
  fableName: '',
  fable1m: false,
  haikuModel: '',
  haikuName: '',
  haiku1m: false,
  subagentModel: '',
  subagent1m: false,
}

const empty: ClaudeSettings = {
  path: '',
  exists: false,
  baseUrl: '',
  apiKey: '',
  authField: 'ANTHROPIC_AUTH_TOKEN',
  model: '',
  ...emptyMapping,
}

type ProviderDraft = {
  id: string | null
  name: string
  baseUrl: string
  apiKey: string
  authField: string
  model: string
  iconColor: string
} & ClaudeModelMapping

function blankDraft(
  from?: Partial<ClaudeSettings & ClaudeProvider>,
): ProviderDraft {
  return {
    id: null,
    name: from?.name || '',
    baseUrl: from?.baseUrl || '',
    apiKey: from?.apiKey || '',
    authField:
      from?.authField === 'ANTHROPIC_API_KEY'
        ? 'ANTHROPIC_API_KEY'
        : 'ANTHROPIC_AUTH_TOKEN',
    model: from?.model || '',
    iconColor: from?.iconColor || '#C45F40',
    ...pickMapping(from || {}),
  }
}

const NAV: { id: TabId; label: string; group: string }[] = [
  { id: 'model', label: 'Model', group: 'Claude Code' },
  { id: 'skills', label: 'Skills', group: 'Claude Code' },
  { id: 'mcp', label: 'MCP', group: 'Claude Code' },
  { id: 'appearance', label: 'Appearance', group: 'App' },
  { id: 'about', label: 'About', group: 'App' },
]

type RoleRow = {
  role: string
  modelKey: keyof ClaudeModelMapping
  nameKey?: keyof ClaudeModelMapping
  oneMKey: keyof ClaudeModelMapping
  nameDisabled?: boolean
  namePlaceholder?: string
}

const ROLE_ROWS: RoleRow[] = [
  {
    role: 'Default',
    modelKey: 'anthropicModel',
    oneMKey: 'anthropicModel1m',
    nameDisabled: true,
    namePlaceholder: 'ANTHROPIC_MODEL',
  },
  {
    role: 'Sonnet',
    modelKey: 'sonnetModel',
    nameKey: 'sonnetName',
    oneMKey: 'sonnet1m',
  },
  {
    role: 'Opus',
    modelKey: 'opusModel',
    nameKey: 'opusName',
    oneMKey: 'opus1m',
  },
  {
    role: 'Fable',
    modelKey: 'fableModel',
    nameKey: 'fableName',
    oneMKey: 'fable1m',
  },
  {
    role: 'Haiku',
    modelKey: 'haikuModel',
    nameKey: 'haikuName',
    oneMKey: 'haiku1m',
  },
  {
    role: 'Subagent',
    modelKey: 'subagentModel',
    oneMKey: 'subagent1m',
    nameDisabled: true,
    namePlaceholder: '不显示在 /model 菜单',
  },
]

function normUrl(u: string) {
  return u.trim().replace(/\/+$/, '').toLowerCase()
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

function settingsPayload(form: ClaudeSettings) {
  return {
    baseUrl: form.baseUrl,
    apiKey: form.apiKey,
    authField:
      form.authField === 'ANTHROPIC_API_KEY'
        ? ('ANTHROPIC_API_KEY' as const)
        : ('ANTHROPIC_AUTH_TOKEN' as const),
    model: form.model,
    ...pickMapping(form),
  }
}

function fromProvider(p: ClaudeProvider, prev: ClaudeSettings): ClaudeSettings {
  return {
    ...prev,
    baseUrl: p.baseUrl,
    apiKey: p.apiKey,
    authField:
      p.authField === 'ANTHROPIC_API_KEY'
        ? 'ANTHROPIC_API_KEY'
        : 'ANTHROPIC_AUTH_TOKEN',
    model: p.model || prev.model,
    ...pickMapping(p),
  }
}

function draftToInput(d: ProviderDraft): ClaudeProviderInput {
  return {
    name: d.name,
    baseUrl: d.baseUrl,
    apiKey: d.apiKey,
    authField: d.authField,
    model: d.model,
    iconColor: d.iconColor,
    ...pickMapping(d),
  }
}

export function SettingsPage({ busy, onClose, onToast }: Props) {
  const [tab, setTab] = useState<TabId>('model')
  const [form, setForm] = useState<ClaudeSettings>(empty)
  const [providers, setProviders] = useState<ClaudeProvider[]>([])
  const [providersPath, setProvidersPath] = useState('')
  const [ccSwitchAvailable, setCcSwitchAvailable] = useState(false)
  const [importedAt, setImportedAt] = useState<number | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [navQuery, setNavQuery] = useState('')
  const [draft, setDraft] = useState<ProviderDraft | null>(null)
  const [showDraftKey, setShowDraftKey] = useState(false)
  const [draftMappingOpen, setDraftMappingOpen] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<ClaudeProvider | null>(null)
  const [cli, setCli] = useState<ClaudeCliInfo | null>(null)
  const [updateOpen, setUpdateOpen] = useState(false)
  const [fontScale, setFontScale] = useState<FontScaleId>(() => readFontScale())
  const [fontPx, setFontPx] = useState(() => readFontPx())
  const [fontPxDraft, setFontPxDraft] = useState(() => String(readFontPx()))
  const [skills, setSkills] = useState<ClaudeSkill[]>([])
  const [skillsDir, setSkillsDir] = useState('')
  const [mcpServers, setMcpServers] = useState<ClaudeMcpServer[]>([])
  const [mcpPath, setMcpPath] = useState('')
  const [skillDraft, setSkillDraft] = useState({
    name: '',
    description: '',
    body: '',
  })
  const [mcpDraft, setMcpDraft] = useState({
    name: '',
    transport: 'http' as 'http' | 'sse' | 'stdio',
    url: '',
    command: '',
    argsText: '',
    headerAuth: '',
  })
  const [mcpExpandedId, setMcpExpandedId] = useState<string | null>(null)
  const [mcpToolsById, setMcpToolsById] = useState<
    Record<
      string,
      {
        loading?: boolean
        error?: string
        tools?: ClaudeMcpTool[]
        toolCount?: number
        serverInfo?: { name?: string; version?: string } | null
      }
    >
  >({})
  const [mcpEditingId, setMcpEditingId] = useState<string | null>(null)
  const [mcpEditDraft, setMcpEditDraft] = useState({
    name: '',
    transport: 'http' as 'http' | 'sse' | 'stdio',
    url: '',
    command: '',
    argsText: '',
    headerAuth: '',
  })
  const [extBusy, setExtBusy] = useState(false)

  // Re-sync from storage whenever Appearance is shown (settings remount / tab switch).
  useEffect(() => {
    if (tab !== 'appearance') return
    const px = readFontPx()
    const id = readFontScale()
    setFontPx(px)
    setFontPxDraft(String(px))
    setFontScale(id)
    applyFontScale(id, px)
  }, [tab])

  useEffect(() => {
    if (tab !== 'skills' && tab !== 'mcp') return
    let cancelled = false
    ;(async () => {
      try {
        if (tab === 'skills') {
          const res = await api.claudeSkills()
          if (cancelled) return
          setSkills(res.skills || [])
          setSkillsDir(res.skillsDir || '')
        } else {
          const res = await api.claudeMcp()
          if (cancelled) return
          setMcpServers(res.servers || [])
          setMcpPath(res.claudeJsonPath || '')
        }
      } catch (e) {
        if (!cancelled) {
          onToast(e instanceof Error ? e.message : String(e), true)
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [tab, onToast])

  const applyProvidersResponse = (
    prov: Awaited<ReturnType<typeof api.claudeProviders>>,
  ) => {
    setProviders(prov.providers || [])
    setProvidersPath(prov.path || '')
    setCcSwitchAvailable(Boolean(prov.ccSwitchAvailable))
    setImportedAt(prov.importedFromCcSwitchAt ?? null)
  }

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const [data, prov, cliInfo] = await Promise.all([
          api.claudeSettings(),
          api.claudeProviders(),
          api.claudeCli().catch(() => null),
        ])
        if (cancelled) return
        setForm({ ...empty, ...data, ...pickMapping(data) })
        applyProvidersResponse(prov)
        if (cliInfo) setCli(cliInfo)
        const match =
          (prov.providers || []).find((p) => p.isCurrent) ||
          (prov.providers || []).find(
            (p) =>
              p.baseUrl &&
              data.baseUrl &&
              normUrl(p.baseUrl) === normUrl(data.baseUrl),
          )
        if (match) setSelectedId(match.id)
      } catch (e) {
        if (!cancelled) {
          onToast(e instanceof Error ? e.message : String(e), true)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [onToast])

  const activeByUrl = useMemo(() => {
    const u = normUrl(form.baseUrl)
    if (!u) return null
    return providers.find((p) => normUrl(p.baseUrl) === u)?.id ?? null
  }, [form.baseUrl, providers])

  const currentProvider = useMemo(() => {
    if (selectedId) {
      const hit = providers.find((p) => p.id === selectedId)
      if (hit) return hit
    }
    return providers.find((p) => p.id === activeByUrl) || null
  }, [providers, selectedId, activeByUrl])

  const filteredNav = useMemo(() => {
    const q = navQuery.trim().toLowerCase()
    if (!q) return NAV
    return NAV.filter((n) => n.label.toLowerCase().includes(q))
  }, [navQuery])

  const groups = useMemo(() => {
    const map = new Map<string, typeof NAV>()
    for (const item of filteredNav) {
      const list = map.get(item.group) || []
      list.push(item)
      map.set(item.group, list)
    }
    return [...map.entries()]
  }, [filteredNav])

  const setText =
    (key: keyof ClaudeSettings) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      setForm((f) => ({ ...f, [key]: e.target.value }))
    }

  const syncSelectedProvider = async (nextForm: ClaudeSettings) => {
    if (!selectedId) return
    try {
      await api.updateClaudeProvider(selectedId, {
        baseUrl: nextForm.baseUrl,
        apiKey: nextForm.apiKey,
        authField: nextForm.authField,
        model: nextForm.model,
        ...pickMapping(nextForm),
      })
      const prov = await api.claudeProviders()
      applyProvidersResponse(prov)
    } catch {
      /* non-fatal */
    }
  }

  const saveForm = async (nextForm: ClaudeSettings, toastMsg?: string) => {
    setSaving(true)
    try {
      const next = await api.updateClaudeSettings(settingsPayload(nextForm))
      setForm({ ...empty, ...next, ...pickMapping(next) })
      await syncSelectedProvider(nextForm)
      onToast(toastMsg || '已写入 ~/.claude/settings.json')
    } catch (e) {
      onToast(e instanceof Error ? e.message : String(e), true)
      throw e
    } finally {
      setSaving(false)
    }
  }

  const switchProvider = async (p: ClaudeProvider) => {
    if (saving || busy || draft) return
    const next = fromProvider(p, form)
    setSelectedId(p.id)
    setForm(next)
    try {
      await saveForm(next, `已切换到「${p.name}」`)
      await api.useClaudeProvider(p.id).then(applyProvidersResponse).catch(() => null)
    } catch {
      /* toast already shown */
    }
  }

  const openCreate = (seedCurrent = false) => {
    setDraft(
      seedCurrent
        ? { ...blankDraft({ ...form, name: '新供应商' }), name: '新供应商' }
        : blankDraft({ name: '新供应商' }),
    )
    setDraftMappingOpen(false)
    setShowDraftKey(false)
  }

  const openEdit = (p: ClaudeProvider) => {
    setDraft({
      ...blankDraft(p),
      id: p.id,
      name: p.name,
      baseUrl: p.baseUrl,
      apiKey: p.apiKey,
      authField: p.authField,
      model: p.model,
      iconColor: p.iconColor || '#C45F40',
    })
    setDraftMappingOpen(false)
    setShowDraftKey(false)
  }

  const saveDraft = async () => {
    if (!draft) return
    if (!draft.name.trim()) {
      onToast('请填写供应商名称', true)
      return
    }
    setSaving(true)
    try {
      const body = draftToInput(draft)
      if (draft.id) {
        await api.updateClaudeProvider(draft.id, body)
        onToast(`已更新「${draft.name.trim()}」`)
      } else {
        const created = await api.createClaudeProvider(body)
        setSelectedId(created.id)
        onToast(`已添加「${created.name}」`)
      }
      applyProvidersResponse(await api.claudeProviders())
      setDraft(null)
    } catch (e) {
      onToast(e instanceof Error ? e.message : String(e), true)
    } finally {
      setSaving(false)
    }
  }

  const askRemoveProvider = (p: ClaudeProvider) => {
    if (saving || busy || draft) return
    setPendingDelete(p)
  }

  const confirmRemoveProvider = async () => {
    const p = pendingDelete
    if (!p) return
    setSaving(true)
    try {
      await api.deleteClaudeProvider(p.id)
      if (selectedId === p.id) setSelectedId(null)
      if (draft?.id === p.id) setDraft(null)
      setPendingDelete(null)
      applyProvidersResponse(await api.claudeProviders())
      onToast(`已删除「${p.name}」`)
    } catch (e) {
      onToast(e instanceof Error ? e.message : String(e), true)
    } finally {
      setSaving(false)
    }
  }

  const copyUpdateCommand = async () => {
    const cmd = cli?.updateCommand || DEFAULT_UPDATE_CMD
    try {
      await navigator.clipboard.writeText(cmd)
      onToast('已复制更新命令')
    } catch {
      onToast('复制失败，请手动选择命令', true)
    }
  }

  const runUpdateInTerminal = async () => {
    setSaving(true)
    try {
      await api.updateClaudeCli()
      setUpdateOpen(false)
      onToast('已在终端打开更新命令，完成后可点刷新查看版本')
      const next = await api.claudeCli().catch(() => null)
      if (next) setCli(next)
    } catch (e) {
      onToast(e instanceof Error ? e.message : String(e), true)
    } finally {
      setSaving(false)
    }
  }

  const refreshCli = async () => {
    try {
      setCli(await api.claudeCli())
      onToast('已刷新 Claude Code 版本')
    } catch (e) {
      onToast(e instanceof Error ? e.message : String(e), true)
    }
  }

  const importCcSwitch = async (replace = false) => {
    setSaving(true)
    try {
      const res = await api.importCcSwitchProviders(replace)
      if (!res.ok) {
        onToast(res.error || '导入失败', true)
        return
      }
      applyProvidersResponse(res)
      onToast(
        replace
          ? `已用 CC Switch 覆盖本地（${res.providers?.length || 0} 个）`
          : `已合并导入，新增 ${res.added ?? 0} 个`,
      )
    } catch (e) {
      onToast(e instanceof Error ? e.message : String(e), true)
    } finally {
      setSaving(false)
    }
  }

  const title =
    tab === 'model'
      ? 'Model'
      : tab === 'skills'
        ? 'Skills'
        : tab === 'mcp'
          ? 'MCP'
          : tab === 'appearance'
            ? 'Appearance'
            : 'About'
  const subtitle =
    tab === 'model'
      ? '供应商保存在本地；编辑可改连接与模型映射，切换即写入 Claude Code。'
      : tab === 'skills'
        ? 'Personal skills live in ~/.claude/skills (same as Claude Code). Plugin skills are listed read-only.'
        : tab === 'mcp'
          ? 'User-scoped MCP servers are stored in ~/.claude.json. Project/local entries are shown read-only.'
          : tab === 'appearance'
            ? 'Adjust UI font size. Changes apply immediately and are remembered.'
            : '配置文件位置与来源。'

  async function submitSkill() {
    const name = skillDraft.name.trim()
    if (!name) {
      onToast('Skill name is required', true)
      return
    }
    setExtBusy(true)
    try {
      const res = await api.createClaudeSkill({
        name,
        description: skillDraft.description.trim(),
        body: skillDraft.body,
      })
      setSkills(res.skills || [])
      setSkillsDir(res.skillsDir || skillsDir)
      setSkillDraft({ name: '', description: '', body: '' })
      onToast(`Skill added: ${name}`)
    } catch (e) {
      onToast(e instanceof Error ? e.message : String(e), true)
    } finally {
      setExtBusy(false)
    }
  }

  async function removeSkill(s: ClaudeSkill) {
    if (!s.editable) return
    setExtBusy(true)
    try {
      const res = await api.deleteClaudeSkill(s.id)
      setSkills(res.skills || [])
      onToast(`Skill removed: ${s.name}`)
    } catch (e) {
      onToast(e instanceof Error ? e.message : String(e), true)
    } finally {
      setExtBusy(false)
    }
  }

  async function submitMcp() {
    const name = mcpDraft.name.trim()
    if (!name) {
      onToast('MCP name is required', true)
      return
    }
    setExtBusy(true)
    try {
      const headers: Record<string, string> = {}
      const auth = mcpDraft.headerAuth.trim()
      if (auth) {
        headers.Authorization = auth.startsWith('Bearer ')
          ? auth
          : `Bearer ${auth}`
      }
      const res = await api.createClaudeMcp({
        name,
        transport: mcpDraft.transport,
        url: mcpDraft.url.trim(),
        command: mcpDraft.command.trim(),
        argsText: mcpDraft.argsText.trim(),
        headers: Object.keys(headers).length ? headers : undefined,
      })
      setMcpServers(res.servers || [])
      setMcpPath(res.claudeJsonPath || mcpPath)
      setMcpDraft({
        name: '',
        transport: 'http',
        url: '',
        command: '',
        argsText: '',
        headerAuth: '',
      })
      onToast(`MCP added: ${name}`)
    } catch (e) {
      onToast(e instanceof Error ? e.message : String(e), true)
    } finally {
      setExtBusy(false)
    }
  }

  async function removeMcp(s: ClaudeMcpServer) {
    if (!s.editable) return
    setExtBusy(true)
    try {
      const res = await api.deleteClaudeMcp(s.name)
      setMcpServers(res.servers || [])
      setMcpExpandedId((id) => (id === s.id ? null : id))
      setMcpEditingId((id) => (id === s.id ? null : id))
      setMcpToolsById((prev) => {
        const next = { ...prev }
        delete next[s.id]
        return next
      })
      onToast(`MCP removed: ${s.name}`)
    } catch (e) {
      onToast(e instanceof Error ? e.message : String(e), true)
    } finally {
      setExtBusy(false)
    }
  }

  async function loadMcpTools(s: ClaudeMcpServer, { force = false } = {}) {
    const cached = mcpToolsById[s.id]
    if (!force && (cached?.tools || cached?.loading)) return
    setMcpToolsById((prev) => ({
      ...prev,
      [s.id]: { ...prev[s.id], loading: true, error: undefined },
    }))
    try {
      const res = await api.claudeMcpTools(s.name, {
        scope: s.scope,
        projectPath: s.projectPath,
      })
      setMcpToolsById((prev) => ({
        ...prev,
        [s.id]: {
          loading: false,
          tools: res.tools || [],
          toolCount: res.toolCount ?? res.tools?.length ?? 0,
          serverInfo: res.serverInfo,
        },
      }))
    } catch (e) {
      setMcpToolsById((prev) => ({
        ...prev,
        [s.id]: {
          loading: false,
          error: e instanceof Error ? e.message : String(e),
          tools: prev[s.id]?.tools,
          toolCount: prev[s.id]?.toolCount,
        },
      }))
    }
  }

  function toggleMcpExpand(s: ClaudeMcpServer) {
    setMcpExpandedId((cur) => {
      const next = cur === s.id ? null : s.id
      if (next === s.id) void loadMcpTools(s)
      return next
    })
  }

  async function startEditMcp(s: ClaudeMcpServer) {
    if (!s.editable) return
    setMcpExpandedId(s.id)
    setMcpEditingId(s.id)
    setMcpEditDraft({
      name: s.name,
      transport: (['http', 'sse', 'stdio'].includes(s.type)
        ? s.type
        : 'http') as 'http' | 'sse' | 'stdio',
      url: s.url || '',
      command: s.command || '',
      argsText: (s.args || []).join(' '),
      headerAuth: s.hasAuthorization ? 'Bearer ••••••••' : '',
    })
    void loadMcpTools(s)
    try {
      const detail = await api.claudeMcpDetail(s.name)
      if (detail.headerAuth) {
        setMcpEditDraft((d) => ({ ...d, headerAuth: detail.headerAuth }))
      }
    } catch {
      /* keep local draft */
    }
  }

  async function saveEditMcp(s: ClaudeMcpServer) {
    if (!s.editable || mcpEditingId !== s.id) return
    const name = mcpEditDraft.name.trim()
    if (!name) {
      onToast('MCP name is required', true)
      return
    }
    setExtBusy(true)
    try {
      const headers: Record<string, string> = {}
      const auth = mcpEditDraft.headerAuth.trim()
      if (auth && !/[•…]/.test(auth)) {
        headers.Authorization = auth.startsWith('Bearer ')
          ? auth
          : `Bearer ${auth}`
      } else if (auth && /[•…]/.test(auth)) {
        // keep existing secret server-side
        headers.Authorization = auth
      }
      const res = await api.updateClaudeMcp(s.name, {
        name,
        transport: mcpEditDraft.transport,
        url: mcpEditDraft.url.trim(),
        command: mcpEditDraft.command.trim(),
        argsText: mcpEditDraft.argsText.trim(),
        headers: Object.keys(headers).length ? headers : undefined,
      })
      setMcpServers(res.servers || [])
      setMcpEditingId(null)
      const next = (res.servers || []).find(
        (x) => x.scope === 'user' && x.name === name,
      )
      if (next) {
        setMcpExpandedId(next.id)
        setMcpToolsById((prev) => {
          const copy = { ...prev }
          delete copy[s.id]
          return copy
        })
        void loadMcpTools(next, { force: true })
      }
      onToast(`MCP updated: ${name}`)
    } catch (e) {
      onToast(e instanceof Error ? e.message : String(e), true)
    } finally {
      setExtBusy(false)
    }
  }

  function pickFontScale(id: Exclude<FontScaleId, 'custom'>) {
    const preset = FONT_SCALE_OPTIONS.find((o) => o.id === id)
    const next = applyFontScale(id, preset?.px)
    setFontScale(next.id)
    setFontPx(next.px)
    setFontPxDraft(String(next.px))
    onToast(`Font size: ${preset?.label || id} (${next.px}px)`)
  }

  function commitFontPx(raw: string) {
    const parsed = Number(String(raw).replace(/px$/i, '').trim())
    if (!Number.isFinite(parsed)) {
      setFontPxDraft(String(fontPx || FONT_PX_DEFAULT))
      onToast('Enter a number in px', true)
      return
    }
    const next = applyFontScale('custom', parsed)
    setFontScale(next.id)
    setFontPx(next.px)
    setFontPxDraft(String(next.px))
    onToast(`Font size saved: ${next.px}px`)
  }

  return (
    <div className="settings-page" role="region" aria-label="Settings">
      <aside className="settings-nav">
        <div className="settings-nav-head">
          <h1>Settings</h1>
          <button type="button" className="icon-btn" onClick={onClose} title="关闭">
            ✕
          </button>
        </div>
        <input
          className="settings-nav-search"
          placeholder="Search"
          value={navQuery}
          onChange={(e) => setNavQuery(e.target.value)}
        />
        <div className="settings-nav-scroll">
          {groups.map(([group, items]) => (
            <div key={group} className="settings-nav-group">
              <div className="settings-nav-group-label">{group}</div>
              {items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`settings-nav-item${tab === item.id ? ' active' : ''}`}
                  onClick={() => setTab(item.id)}
                >
                  {item.label}
                </button>
              ))}
            </div>
          ))}
        </div>
      </aside>

      <section className="settings-content">
        <header className="settings-content-head">
          <h2>{title}</h2>
          <p>{subtitle}</p>
        </header>

        {loading ? (
          <div className="settings-loading">读取配置中…</div>
        ) : (
          <div className="settings-panel settings-panel-wide">
            {tab === 'skills' ? (
              <div className="ext-panel">
                <div className="settings-rows">
                  <div className="settings-row">
                    <div className="settings-row-copy">
                      <div className="settings-row-label">Skills directory</div>
                      <div className="settings-row-desc">
                        Writable user skills · plugin skills are read-only
                      </div>
                    </div>
                    <div className="settings-row-value mono" title={skillsDir}>
                      {skillsDir || '~/.claude/skills'}
                    </div>
                  </div>
                </div>

                <div className="ext-form">
                  <div className="ext-form-title">Add personal skill</div>
                  <div className="ext-form-grid">
                    <label className="ext-field">
                      <span>Name</span>
                      <input
                        value={skillDraft.name}
                        placeholder="my-skill"
                        disabled={extBusy || busy}
                        onChange={(e) =>
                          setSkillDraft((d) => ({ ...d, name: e.target.value }))
                        }
                      />
                    </label>
                    <label className="ext-field">
                      <span>Description</span>
                      <input
                        value={skillDraft.description}
                        placeholder="When should Claude use this skill?"
                        disabled={extBusy || busy}
                        onChange={(e) =>
                          setSkillDraft((d) => ({
                            ...d,
                            description: e.target.value,
                          }))
                        }
                      />
                    </label>
                  </div>
                  <label className="ext-field">
                    <span>SKILL.md body</span>
                    <textarea
                      rows={5}
                      value={skillDraft.body}
                      placeholder="# Instructions&#10;&#10;Write the workflow here…"
                      disabled={extBusy || busy}
                      onChange={(e) =>
                        setSkillDraft((d) => ({ ...d, body: e.target.value }))
                      }
                    />
                  </label>
                  <div className="ext-form-actions">
                    <button
                      type="button"
                      className="btn primary"
                      disabled={extBusy || busy || !skillDraft.name.trim()}
                      onClick={() => void submitSkill()}
                    >
                      Add skill
                    </button>
                  </div>
                </div>

                <div className="ext-list" role="list">
                  {skills.length === 0 ? (
                    <div className="settings-empty">
                      No skills found. Add one above, or create folders under
                      ~/.claude/skills.
                    </div>
                  ) : (
                    skills.map((s) => (
                      <div key={s.id} className="ext-item" role="listitem">
                        <div className="ext-item-main">
                          <div className="ext-item-title">
                            <span className="ext-item-name">/{s.name}</span>
                            <span
                              className={`ext-badge scope-${s.scope}`}
                            >
                              {s.scope}
                            </span>
                          </div>
                          <div className="ext-item-desc">
                            {s.description || s.preview || s.path}
                          </div>
                          {s.plugin ? (
                            <div className="ext-item-meta">{s.plugin}</div>
                          ) : null}
                        </div>
                        {s.editable ? (
                          <button
                            type="button"
                            className="btn danger"
                            disabled={extBusy || busy}
                            onClick={() => void removeSkill(s)}
                          >
                            Delete
                          </button>
                        ) : (
                          <span className="ext-item-ro">Read-only</span>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </div>
            ) : null}

            {tab === 'mcp' ? (
              <div className="ext-panel">
                <div className="settings-rows">
                  <div className="settings-row">
                    <div className="settings-row-copy">
                      <div className="settings-row-label">Claude config</div>
                      <div className="settings-row-desc">
                        User MCP servers · same file as `claude mcp`
                      </div>
                    </div>
                    <div className="settings-row-value mono" title={mcpPath}>
                      {mcpPath || '~/.claude.json'}
                    </div>
                  </div>
                </div>

                <div className="ext-form">
                  <div className="ext-form-title">Add user MCP server</div>
                  <div className="ext-form-grid">
                    <label className="ext-field">
                      <span>Name</span>
                      <input
                        value={mcpDraft.name}
                        placeholder="my-server"
                        disabled={extBusy || busy}
                        onChange={(e) =>
                          setMcpDraft((d) => ({ ...d, name: e.target.value }))
                        }
                      />
                    </label>
                    <label className="ext-field">
                      <span>Transport</span>
                      <select
                        value={mcpDraft.transport}
                        disabled={extBusy || busy}
                        onChange={(e) =>
                          setMcpDraft((d) => ({
                            ...d,
                            transport: e.target.value as
                              | 'http'
                              | 'sse'
                              | 'stdio',
                          }))
                        }
                      >
                        <option value="http">HTTP</option>
                        <option value="sse">SSE</option>
                        <option value="stdio">stdio</option>
                      </select>
                    </label>
                  </div>
                  {mcpDraft.transport === 'stdio' ? (
                    <div className="ext-form-grid">
                      <label className="ext-field">
                        <span>Command</span>
                        <input
                          value={mcpDraft.command}
                          placeholder="npx"
                          disabled={extBusy || busy}
                          onChange={(e) =>
                            setMcpDraft((d) => ({
                              ...d,
                              command: e.target.value,
                            }))
                          }
                        />
                      </label>
                      <label className="ext-field">
                        <span>Args</span>
                        <input
                          value={mcpDraft.argsText}
                          placeholder="-y @modelcontextprotocol/server-filesystem /tmp"
                          disabled={extBusy || busy}
                          onChange={(e) =>
                            setMcpDraft((d) => ({
                              ...d,
                              argsText: e.target.value,
                            }))
                          }
                        />
                      </label>
                    </div>
                  ) : (
                    <div className="ext-form-grid">
                      <label className="ext-field">
                        <span>URL</span>
                        <input
                          value={mcpDraft.url}
                          placeholder="https://example.com/mcp"
                          disabled={extBusy || busy}
                          onChange={(e) =>
                            setMcpDraft((d) => ({
                              ...d,
                              url: e.target.value,
                            }))
                          }
                        />
                      </label>
                      <label className="ext-field">
                        <span>Authorization (optional)</span>
                        <input
                          value={mcpDraft.headerAuth}
                          placeholder="Bearer …"
                          disabled={extBusy || busy}
                          onChange={(e) =>
                            setMcpDraft((d) => ({
                              ...d,
                              headerAuth: e.target.value,
                            }))
                          }
                        />
                      </label>
                    </div>
                  )}
                  <div className="ext-form-actions">
                    <button
                      type="button"
                      className="btn primary"
                      disabled={extBusy || busy || !mcpDraft.name.trim()}
                      onClick={() => void submitMcp()}
                    >
                      Add MCP
                    </button>
                  </div>
                </div>

                <div className="ext-list" role="list">
                  {mcpServers.length === 0 ? (
                    <div className="settings-empty">
                      No MCP servers found. Add a user-scoped server above.
                    </div>
                  ) : (
                    mcpServers.map((s) => {
                      const open = mcpExpandedId === s.id
                      const editing = mcpEditingId === s.id
                      const toolsState = mcpToolsById[s.id]
                      return (
                        <div
                          key={s.id}
                          className={`ext-item mcp-item${open ? ' open' : ''}`}
                          role="listitem"
                        >
                          <div className="mcp-item-head">
                            <button
                              type="button"
                              className="mcp-item-toggle"
                              aria-expanded={open}
                              onClick={() => toggleMcpExpand(s)}
                            >
                              <span className="mcp-chevron" aria-hidden>
                                {open ? '▾' : '▸'}
                              </span>
                              <span className="ext-item-main">
                                <span className="ext-item-title">
                                  <span className="ext-item-name">{s.name}</span>
                                  <span
                                    className={`ext-badge scope-${s.scope}`}
                                  >
                                    {s.scope}
                                  </span>
                                  <span className="ext-badge type">
                                    {s.type}
                                  </span>
                                  {typeof toolsState?.toolCount === 'number' ? (
                                    <span className="ext-badge tools">
                                      {toolsState.toolCount} tools
                                    </span>
                                  ) : null}
                                </span>
                                <span className="ext-item-desc mono">
                                  {s.type === 'stdio'
                                    ? [s.command, ...(s.args || [])].join(' ')
                                    : s.url || '—'}
                                </span>
                                {s.projectPath ? (
                                  <span
                                    className="ext-item-meta"
                                    title={s.projectPath}
                                  >
                                    {s.projectPath}
                                  </span>
                                ) : null}
                              </span>
                            </button>
                            <div className="mcp-item-actions">
                              {s.editable ? (
                                <>
                                  <button
                                    type="button"
                                    className="btn"
                                    disabled={extBusy || busy}
                                    onClick={() => void startEditMcp(s)}
                                  >
                                    Edit
                                  </button>
                                  <button
                                    type="button"
                                    className="btn danger"
                                    disabled={extBusy || busy}
                                    onClick={() => void removeMcp(s)}
                                  >
                                    Delete
                                  </button>
                                </>
                              ) : (
                                <span className="ext-item-ro">Read-only</span>
                              )}
                            </div>
                          </div>

                          {open ? (
                            <div className="mcp-item-body">
                              {editing ? (
                                <div className="ext-form mcp-edit-form">
                                  <div className="ext-form-title">
                                    Edit {s.name}
                                  </div>
                                  <div className="ext-form-grid">
                                    <label className="ext-field">
                                      <span>Name</span>
                                      <input
                                        value={mcpEditDraft.name}
                                        disabled={extBusy || busy}
                                        onChange={(e) =>
                                          setMcpEditDraft((d) => ({
                                            ...d,
                                            name: e.target.value,
                                          }))
                                        }
                                      />
                                    </label>
                                    <label className="ext-field">
                                      <span>Transport</span>
                                      <select
                                        value={mcpEditDraft.transport}
                                        disabled={extBusy || busy}
                                        onChange={(e) =>
                                          setMcpEditDraft((d) => ({
                                            ...d,
                                            transport: e.target.value as
                                              | 'http'
                                              | 'sse'
                                              | 'stdio',
                                          }))
                                        }
                                      >
                                        <option value="http">HTTP</option>
                                        <option value="sse">SSE</option>
                                        <option value="stdio">stdio</option>
                                      </select>
                                    </label>
                                  </div>
                                  {mcpEditDraft.transport === 'stdio' ? (
                                    <div className="ext-form-grid">
                                      <label className="ext-field">
                                        <span>Command</span>
                                        <input
                                          value={mcpEditDraft.command}
                                          disabled={extBusy || busy}
                                          onChange={(e) =>
                                            setMcpEditDraft((d) => ({
                                              ...d,
                                              command: e.target.value,
                                            }))
                                          }
                                        />
                                      </label>
                                      <label className="ext-field">
                                        <span>Args</span>
                                        <input
                                          value={mcpEditDraft.argsText}
                                          disabled={extBusy || busy}
                                          onChange={(e) =>
                                            setMcpEditDraft((d) => ({
                                              ...d,
                                              argsText: e.target.value,
                                            }))
                                          }
                                        />
                                      </label>
                                    </div>
                                  ) : (
                                    <div className="ext-form-grid">
                                      <label className="ext-field">
                                        <span>URL</span>
                                        <input
                                          value={mcpEditDraft.url}
                                          disabled={extBusy || busy}
                                          onChange={(e) =>
                                            setMcpEditDraft((d) => ({
                                              ...d,
                                              url: e.target.value,
                                            }))
                                          }
                                        />
                                      </label>
                                      <label className="ext-field">
                                        <span>
                                          Authorization
                                          {s.hasAuthorization
                                            ? ' (leave masked to keep)'
                                            : ' (optional)'}
                                        </span>
                                        <input
                                          value={mcpEditDraft.headerAuth}
                                          placeholder="Bearer …"
                                          disabled={extBusy || busy}
                                          onChange={(e) =>
                                            setMcpEditDraft((d) => ({
                                              ...d,
                                              headerAuth: e.target.value,
                                            }))
                                          }
                                        />
                                      </label>
                                    </div>
                                  )}
                                  <div className="ext-form-actions">
                                    <button
                                      type="button"
                                      className="btn"
                                      disabled={extBusy || busy}
                                      onClick={() => setMcpEditingId(null)}
                                    >
                                      Cancel
                                    </button>
                                    <button
                                      type="button"
                                      className="btn primary"
                                      disabled={
                                        extBusy ||
                                        busy ||
                                        !mcpEditDraft.name.trim()
                                      }
                                      onClick={() => void saveEditMcp(s)}
                                    >
                                      Save
                                    </button>
                                  </div>
                                </div>
                              ) : null}

                              <div className="mcp-tools">
                                <div className="mcp-tools-head">
                                  <span className="mcp-tools-title">
                                    Tools
                                    {typeof toolsState?.toolCount ===
                                    'number'
                                      ? ` · ${toolsState.toolCount}`
                                      : ''}
                                  </span>
                                  <button
                                    type="button"
                                    className="btn ghost small"
                                    disabled={Boolean(toolsState?.loading)}
                                    onClick={() =>
                                      void loadMcpTools(s, { force: true })
                                    }
                                  >
                                    {toolsState?.loading
                                      ? 'Loading…'
                                      : 'Refresh'}
                                  </button>
                                </div>
                                {toolsState?.error ? (
                                  <div className="mcp-tools-error">
                                    {toolsState.error}
                                  </div>
                                ) : null}
                                {toolsState?.loading &&
                                !toolsState.tools?.length ? (
                                  <div className="mcp-tools-empty">
                                    Connecting to MCP…
                                  </div>
                                ) : null}
                                {toolsState?.tools?.length ? (
                                  <ul className="mcp-tools-list">
                                    {toolsState.tools.map((t) => (
                                      <li key={t.name}>
                                        <div className="mcp-tool-name">
                                          {t.name}
                                        </div>
                                        {t.description ? (
                                          <div className="mcp-tool-desc">
                                            {t.description}
                                          </div>
                                        ) : null}
                                      </li>
                                    ))}
                                  </ul>
                                ) : !toolsState?.loading &&
                                  !toolsState?.error ? (
                                  <div className="mcp-tools-empty">
                                    No tools reported.
                                  </div>
                                ) : null}
                                {toolsState?.serverInfo?.name ? (
                                  <div className="mcp-tools-meta">
                                    Server · {toolsState.serverInfo.name}
                                    {toolsState.serverInfo.version
                                      ? ` ${toolsState.serverInfo.version}`
                                      : ''}
                                  </div>
                                ) : null}
                              </div>
                            </div>
                          ) : null}
                        </div>
                      )
                    })
                  )}
                </div>
              </div>
            ) : null}

            {tab === 'appearance' ? (
              <div className="settings-rows">
                <div className="settings-row stack">
                  <div className="settings-row-copy">
                    <div className="settings-row-label">Font size</div>
                    <div className="settings-row-desc">
                      Scales sidebar, chat, and settings text. Range{' '}
                      {FONT_PX_MIN}–{FONT_PX_MAX}px.
                    </div>
                  </div>
                  <div
                    className="font-scale-options"
                    role="radiogroup"
                    aria-label="Font size presets"
                  >
                    {FONT_SCALE_OPTIONS.map((opt) => (
                      <button
                        key={opt.id}
                        type="button"
                        role="radio"
                        aria-checked={fontScale === opt.id}
                        className={`font-scale-option${
                          fontScale === opt.id ? ' active' : ''
                        }`}
                        onClick={() => pickFontScale(opt.id)}
                      >
                        <span className="font-scale-label">{opt.label}</span>
                        <span className="font-scale-hint">{opt.hint}</span>
                      </button>
                    ))}
                  </div>
                  <div className="font-scale-input-row">
                    <label className="font-scale-input-label" htmlFor="font-px">
                      Custom
                    </label>
                    <div className="font-scale-input-wrap">
                      <input
                        id="font-px"
                        type="number"
                        className="font-scale-input"
                        min={FONT_PX_MIN}
                        max={FONT_PX_MAX}
                        step={1}
                        value={fontPxDraft}
                        aria-label="Font size in pixels"
                        onChange={(e) => setFontPxDraft(e.target.value)}
                        onBlur={() => commitFontPx(fontPxDraft)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault()
                            commitFontPx(fontPxDraft)
                            ;(e.target as HTMLInputElement).blur()
                          }
                        }}
                      />
                      <span className="font-scale-input-suffix">px</span>
                    </div>
                    <span className="font-scale-value">
                      {formatFontPx(fontPx)}
                    </span>
                  </div>
                  <p className="font-scale-preview" aria-hidden>
                    Preview: Ask Claude… Aa sample 123
                  </p>
                </div>
              </div>
            ) : null}

            {tab === 'model' ? (
              <>
                <div className="settings-rows">
                  <div className="settings-row">
                    <div className="settings-row-copy">
                      <div className="settings-row-label">当前供应商</div>
                      <div className="settings-row-desc">本地库 → Claude Code</div>
                    </div>
                    <div
                      className="settings-row-value"
                      title={
                        currentProvider?.name ||
                        form.baseUrl ||
                        undefined
                      }
                    >
                      {currentProvider?.name ||
                        (form.baseUrl
                          ? (() => {
                              try {
                                return new URL(form.baseUrl).host
                              } catch {
                                return form.baseUrl
                              }
                            })()
                          : '未配置')}
                    </div>
                  </div>
                  <div className="settings-row">
                    <div className="settings-row-copy">
                      <div className="settings-row-label">默认 Model</div>
                      <div className="settings-row-desc">
                        settings.json 的 model（haiku / sonnet / opus / fable …）
                      </div>
                    </div>
                    <div className="settings-row-control">
                      <input
                        value={form.model}
                        onChange={setText('model')}
                        placeholder="haiku"
                        autoComplete="off"
                        spellCheck={false}
                      />
                      <button
                        type="button"
                        className="btn primary"
                        disabled={saving || busy}
                        onClick={() => void saveForm(form, '已保存默认 Model')}
                      >
                        {saving ? '…' : '保存'}
                      </button>
                    </div>
                  </div>
                </div>

                <div className="settings-section-label">
                  本地供应商
                  <span>
                    {providers.length} 个
                    {importedAt
                      ? ` · 曾导入 CC Switch`
                      : ccSwitchAvailable
                        ? ' · 可导入 CC Switch'
                        : ''}
                  </span>
                </div>

                <div className="provider-toolbar">
                  <button
                    type="button"
                    className="btn primary"
                    disabled={saving || busy || Boolean(draft)}
                    onClick={() => openCreate(false)}
                  >
                    添加供应商
                  </button>
                  <button
                    type="button"
                    className="btn"
                    disabled={saving || busy || Boolean(draft)}
                    onClick={() => openCreate(true)}
                  >
                    从当前配置新建
                  </button>
                  {ccSwitchAvailable ? (
                    <button
                      type="button"
                      className="btn"
                      disabled={saving || busy || Boolean(draft)}
                      onClick={() => void importCcSwitch(false)}
                      title="只补充本地没有的条目，不覆盖已有"
                    >
                      从 CC Switch 合并导入
                    </button>
                  ) : null}
                </div>

                {draft ? (
                  <div className="provider-editor">
                    <div className="provider-editor-head">
                      <strong>{draft.id ? '编辑供应商' : '添加供应商'}</strong>
                      <button
                        type="button"
                        className="icon-btn"
                        onClick={() => setDraft(null)}
                      >
                        ✕
                      </button>
                    </div>
                    <div className="provider-editor-grid">
                      <label className="field">
                        <span>名称</span>
                        <input
                          value={draft.name}
                          onChange={(e) =>
                            setDraft((d) => (d ? { ...d, name: e.target.value } : d))
                          }
                          placeholder="Bailian / DeepSeek …"
                        />
                      </label>
                      <label className="field">
                        <span>Base URL</span>
                        <input
                          value={draft.baseUrl}
                          onChange={(e) =>
                            setDraft((d) =>
                              d ? { ...d, baseUrl: e.target.value } : d,
                            )
                          }
                          placeholder="https://api.example.com"
                          spellCheck={false}
                          autoComplete="off"
                        />
                      </label>
                      <label className="field">
                        <span>API Key</span>
                        <div className="field-row">
                          <input
                            type={showDraftKey ? 'text' : 'password'}
                            value={draft.apiKey}
                            onChange={(e) =>
                              setDraft((d) =>
                                d ? { ...d, apiKey: e.target.value } : d,
                              )
                            }
                            placeholder="sk-…"
                            spellCheck={false}
                            autoComplete="off"
                          />
                          <button
                            type="button"
                            className="btn"
                            onClick={() => setShowDraftKey((v) => !v)}
                          >
                            {showDraftKey ? '隐藏' : '显示'}
                          </button>
                        </div>
                      </label>
                      <label className="field">
                        <span>鉴权字段</span>
                        <select
                          value={draft.authField}
                          onChange={(e) =>
                            setDraft((d) =>
                              d ? { ...d, authField: e.target.value } : d,
                            )
                          }
                        >
                          <option value="ANTHROPIC_AUTH_TOKEN">
                            ANTHROPIC_AUTH_TOKEN
                          </option>
                          <option value="ANTHROPIC_API_KEY">
                            ANTHROPIC_API_KEY
                          </option>
                        </select>
                      </label>
                      <label className="field">
                        <span>默认 model</span>
                        <input
                          value={draft.model}
                          onChange={(e) =>
                            setDraft((d) =>
                              d ? { ...d, model: e.target.value } : d,
                            )
                          }
                          placeholder="haiku / sonnet / opus …"
                          spellCheck={false}
                          autoComplete="off"
                        />
                      </label>
                    </div>

                    <button
                      type="button"
                      className="settings-adv-toggle"
                      onClick={() => setDraftMappingOpen((v) => !v)}
                    >
                      {draftMappingOpen ? '▾' : '▸'} 模型映射（可选）
                    </button>
                    {draftMappingOpen ? (
                      <div className="mapping-table draft-mapping">
                        <div className="mapping-head">
                          <span>角色</span>
                          <span>显示名称</span>
                          <span>请求模型</span>
                          <span>1M</span>
                        </div>
                        {ROLE_ROWS.map((row) => (
                          <div className="mapping-row" key={row.role}>
                            <span className="mapping-role">
                              <span className="mapping-role-pill">{row.role}</span>
                            </span>
                            <span>
                              <input
                                value={
                                  row.nameKey
                                    ? String(draft[row.nameKey] ?? '')
                                    : ''
                                }
                                disabled={row.nameDisabled || !row.nameKey}
                                placeholder={row.namePlaceholder || '显示名称'}
                                onChange={(e) => {
                                  if (!row.nameKey) return
                                  const key = row.nameKey
                                  setDraft((d) =>
                                    d ? { ...d, [key]: e.target.value } : d,
                                  )
                                }}
                              />
                            </span>
                            <span>
                              <input
                                value={String(draft[row.modelKey] ?? '')}
                                placeholder="上游模型 id"
                                onChange={(e) => {
                                  const key = row.modelKey
                                  setDraft((d) =>
                                    d ? { ...d, [key]: e.target.value } : d,
                                  )
                                }}
                              />
                            </span>
                            <span className="mapping-1m">
                              <label className="mapping-1m-label">
                                <input
                                  type="checkbox"
                                  checked={Boolean(draft[row.oneMKey])}
                                  onChange={(e) => {
                                    const key = row.oneMKey
                                    setDraft((d) =>
                                      d
                                        ? { ...d, [key]: e.target.checked }
                                        : d,
                                    )
                                  }}
                                />
                                <span>1M</span>
                              </label>
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : null}

                    <div className="settings-actions">
                      <button
                        type="button"
                        className="btn"
                        disabled={saving}
                        onClick={() => setDraft(null)}
                      >
                        取消
                      </button>
                      <button
                        type="button"
                        className="btn primary"
                        disabled={saving || busy}
                        onClick={() => void saveDraft()}
                      >
                        {saving ? '保存中…' : '保存到本地'}
                      </button>
                    </div>
                  </div>
                ) : null}

                {providers.length === 0 && !draft ? (
                  <div className="settings-empty">
                    本地还没有供应商。点「添加供应商」手动配置
                    {ccSwitchAvailable ? '，或从 CC Switch 合并导入' : ''}。
                  </div>
                ) : (
                  <div className="settings-provider-list" role="listbox">
                    {providers.map((p) => {
                      const selected =
                        selectedId === p.id ||
                        (!selectedId && activeByUrl === p.id)
                      const live =
                        selected &&
                        normUrl(form.baseUrl) === normUrl(p.baseUrl)
                      return (
                        <div
                          key={p.id}
                          className={`settings-provider-wrap${selected ? ' selected' : ''}`}
                        >
                          <button
                            type="button"
                            role="option"
                            aria-selected={selected}
                            className={`settings-provider${selected ? ' selected' : ''}`}
                            disabled={saving || busy || Boolean(draft)}
                            onClick={() => void switchProvider(p)}
                          >
                            <span
                              className="provider-dot"
                              style={{ background: p.iconColor || '#888' }}
                              aria-hidden
                            />
                            <span className="settings-provider-main">
                              <span className="settings-provider-name">
                                {p.name}
                                {live ? (
                                  <span className="provider-badge">当前</span>
                                ) : null}
                              </span>
                              <span
                                className="settings-provider-sub"
                                title={[
                                  p.baseUrl || p.baseHost || '',
                                  p.model ? `model=${p.model}` : '',
                                  p.anthropicModel
                                    ? `ANTHROPIC_MODEL=${p.anthropicModel}`
                                    : '',
                                ]
                                  .filter(Boolean)
                                  .join('\n')}
                              >
                                {p.baseHost || p.baseUrl || '未设置 Base URL'}
                                {p.model ? ` · ${p.model}` : ''}
                              </span>
                            </span>
                            <span className="settings-provider-action">
                              {live
                                ? '使用中'
                                : saving && selected
                                  ? '切换中…'
                                  : '切换'}
                            </span>
                          </button>
                          <div className="provider-row-actions">
                            <button
                              type="button"
                              className="btn"
                              disabled={saving || Boolean(draft)}
                              onClick={() => openEdit(p)}
                            >
                              编辑
                            </button>
                            <button
                              type="button"
                              className="btn danger-outline"
                              disabled={saving || Boolean(draft)}
                              onClick={() => askRemoveProvider(p)}
                            >
                              删除
                            </button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </>
            ) : null}

            {tab === 'about' ? (
              <div className="settings-rows">
                <div className="settings-row">
                  <div className="settings-row-copy">
                    <div className="settings-row-label">Claude Code</div>
                    <div
                      className="settings-row-desc truncatable"
                      title={
                        cli?.installed
                          ? cli.bin || undefined
                          : undefined
                      }
                    >
                      {cli?.installed
                        ? cli.bin || '已安装'
                        : '未检测到 claude 命令'}
                    </div>
                  </div>
                  <div className="settings-row-control">
                    <span
                      className="settings-row-value mono"
                      title={
                        cli?.installed
                          ? cli.raw || cli.version || undefined
                          : undefined
                      }
                    >
                      {cli?.installed
                        ? cli.version || cli.raw || '未知版本'
                        : '未安装'}
                    </span>
                    <button
                      type="button"
                      className="btn"
                      disabled={saving}
                      onClick={() => void refreshCli()}
                    >
                      刷新
                    </button>
                    <button
                      type="button"
                      className="btn primary"
                      disabled={saving}
                      onClick={() => setUpdateOpen(true)}
                    >
                      更新
                    </button>
                  </div>
                </div>
                <div className="settings-row">
                  <div className="settings-row-copy">
                    <div className="settings-row-label">Claude Code 配置</div>
                    <div className="settings-row-desc">
                      {form.exists ? '已存在' : '保存时将创建'}
                    </div>
                  </div>
                  <div
                    className="settings-row-value mono"
                    title={form.path || undefined}
                  >
                    {form.path || '—'}
                  </div>
                </div>
                <div className="settings-row">
                  <div className="settings-row-copy">
                    <div className="settings-row-label">本地供应商库</div>
                    <div className="settings-row-desc">
                      优先级高于 CC Switch；首次可自动导入
                    </div>
                  </div>
                  <div
                    className="settings-row-value mono"
                    title={providersPath || 'providers.json'}
                  >
                    {providersPath || 'providers.json'}
                  </div>
                </div>
                <div className="settings-row">
                  <div className="settings-row-copy">
                    <div className="settings-row-label">CC Switch</div>
                    <div className="settings-row-desc">可选导入源，不强制依赖</div>
                  </div>
                  <div className="settings-row-value">
                    {ccSwitchAvailable ? '已检测到' : '未安装 / 未检测到'}
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        )}
      </section>

      {pendingDelete ? (
        <ConfirmDialog
          title={`删除本地供应商「${pendingDelete.name}」？`}
          body="只会从本应用的供应商库移除，不会改动 Claude Code 当前配置。"
          confirmLabel="删除"
          cancelLabel="取消"
          danger
          busy={saving}
          onCancel={() => {
            if (!saving) setPendingDelete(null)
          }}
          onConfirm={() => void confirmRemoveProvider()}
        />
      ) : null}

      {updateOpen ? (
        <ConfirmDialog
          title="更新 Claude Code"
          body={`请使用以下命令更新：\n\n${cli?.updateCommand || DEFAULT_UPDATE_CMD}\n\n当前版本：${cli?.installed ? cli.version || '未知' : '未安装'}`}
          confirmLabel="在终端运行"
          secondaryLabel="复制命令"
          cancelLabel="取消"
          danger={false}
          busy={saving}
          onCancel={() => {
            if (!saving) setUpdateOpen(false)
          }}
          onSecondary={() => void copyUpdateCommand()}
          onConfirm={() => void runUpdateInTerminal()}
        />
      ) : null}
    </div>
  )
}
