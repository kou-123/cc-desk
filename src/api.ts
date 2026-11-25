export type Session = {
  id: string
  name: string | null
  projectKey: string
  cwd: string | null
  preview: string
  messageCount: number
  mtime: number
  lastActivity: number
  transcriptPath: string
}

export type Workspace = {
  id: string
  name: string
  cwd: string | null
  addDirs: string[]
  files: string[]
  note: string
  createdAt: number
  updatedAt: number
}

export type FsItem = {
  name: string
  path: string
  isDirectory: boolean
  isFile: boolean
}

async function req<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
    ...init,
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || res.statusText)
  return data as T
}

export const api = {
  sessions: () => req<{ sessions: Session[] }>('/api/sessions'),
  sessionDetail: (id: string) =>
    req<{
      session: Session
      messages: import('./MessageList').ChatBlock[]
    }>(`/api/sessions/${id}`),
  sessionMeta: (id: string) =>
    req<{
      id: string
      transcriptPath: string
      mtimeMs: number
      size: number
    }>(`/api/sessions/${id}/meta`),
  deleteSession: (id: string) =>
    req<{ ok: boolean; id: string; removed: string[] }>(
      `/api/sessions/${id}`,
      { method: 'DELETE' },
    ),
  removeProject: (body: {
    workspaceId?: string | null
    cwd?: string | null
    sessionIds?: string[]
    purgeClaude?: boolean
  }) =>
    req<{
      ok: boolean
      workspaceDeleted: boolean
      purged?: boolean
      deletedSessions?: string[]
      purgeOutput?: string
    }>('/api/projects/remove', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  workspaces: () => req<{ workspaces: Workspace[] }>('/api/workspaces'),
  createWorkspace: (body: Partial<Workspace>) =>
    req<{ workspace: Workspace }>('/api/workspaces', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  updateWorkspace: (id: string, body: Partial<Workspace>) =>
    req<{ workspace: Workspace }>(`/api/workspaces/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  deleteWorkspace: (id: string) =>
    req<{ ok: boolean }>(`/api/workspaces/${id}`, { method: 'DELETE' }),
  launch: (body: {
    sessionId?: string | null
    cwd?: string | null
    addDirs?: string[]
    files?: string[]
    name?: string | null
    workspaceId?: string | null
  }) =>
    req<{ ok: boolean; cwd: string; command: string }>('/api/launch', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  listFs: (p: string) =>
    req<{ path: string; parent: string; items: FsItem[] }>(
      `/api/fs/list?path=${encodeURIComponent(p)}`,
    ),
  claudeSettings: () => req<ClaudeSettings>('/api/claude-settings'),
  updateClaudeSettings: (body: Partial<ClaudeSettingsInput>) =>
    req<ClaudeSettings>('/api/claude-settings', {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
  claudeCli: () => req<ClaudeCliInfo>('/api/claude-cli'),
  updateClaudeCli: () =>
    req<ClaudeCliInfo & { ok?: boolean; command?: string }>(
      '/api/claude-cli/update',
      { method: 'POST', body: '{}' },
    ),
  claudeProviders: () => req<ClaudeProvidersResponse>('/api/claude-providers'),
  createClaudeProvider: (body: Partial<ClaudeProviderInput>) =>
    req<ClaudeProvider>('/api/claude-providers', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  updateClaudeProvider: (id: string, body: Partial<ClaudeProviderInput>) =>
    req<ClaudeProvider>(`/api/claude-providers/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
  deleteClaudeProvider: (id: string) =>
    req<{ ok: boolean }>(`/api/claude-providers/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),
  importCcSwitchProviders: (replace = false) =>
    req<ClaudeProvidersResponse & { ok: boolean; added?: number; error?: string }>(
      '/api/claude-providers/import-cc-switch',
      {
        method: 'POST',
        body: JSON.stringify({ replace }),
      },
    ),
  useClaudeProvider: (id: string) =>
    req<ClaudeProvidersResponse>(
      `/api/claude-providers/${encodeURIComponent(id)}/use`,
      { method: 'POST', body: '{}' },
    ),
}

/** Model mapping fields shared by settings + CC Switch providers. */
export type ClaudeModelMapping = {
  anthropicModel: string
  anthropicModel1m: boolean
  sonnetModel: string
  sonnetName: string
  sonnet1m: boolean
  opusModel: string
  opusName: string
  opus1m: boolean
  fableModel: string
  fableName: string
  fable1m: boolean
  haikuModel: string
  haikuName: string
  haiku1m: boolean
  subagentModel: string
  subagent1m: boolean
}

export type ClaudeCliInfo = {
  installed: boolean
  bin: string | null
  version: string | null
  raw: string | null
  updateCommand: string
}

export type ClaudeSettings = {
  path: string
  exists: boolean
  baseUrl: string
  apiKey: string
  authField: 'ANTHROPIC_AUTH_TOKEN' | 'ANTHROPIC_API_KEY' | string
  model: string
} & ClaudeModelMapping

export type ClaudeSettingsInput = {
  baseUrl?: string
  apiKey?: string
  authField?: 'ANTHROPIC_AUTH_TOKEN' | 'ANTHROPIC_API_KEY'
  model?: string
} & Partial<ClaudeModelMapping>

export type ClaudeProvider = {
  id: string
  name: string
  isCurrent: boolean
  icon?: string
  iconColor: string
  category?: string
  websiteUrl?: string
  baseUrl: string
  baseHost: string
  apiKey: string
  apiKeyMasked: string
  authField: string
  model: string
  source?: 'local' | 'cc-switch' | string
  updatedAt?: number
} & ClaudeModelMapping

export type ClaudeProviderInput = {
  name?: string
  iconColor?: string
  baseUrl?: string
  apiKey?: string
  authField?: 'ANTHROPIC_AUTH_TOKEN' | 'ANTHROPIC_API_KEY' | string
  model?: string
  isCurrent?: boolean
} & Partial<ClaudeModelMapping>

export type ClaudeProvidersResponse = {
  available: boolean
  path: string
  providers: ClaudeProvider[]
  error?: string
  bootstrapped?: boolean
  importedFromCcSwitchAt?: number | null
  ccSwitchAvailable?: boolean
  ccSwitchPath?: string
  ccSwitchCount?: number
  source?: string
}
