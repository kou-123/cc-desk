/**
 * Claude Code CLI `--effort` levels.
 * See: `claude --help` → --effort <low|medium|high|xhigh|max>
 */

export type EffortLevel = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

export type EffortOption = {
  id: EffortLevel
  label: string
  labelZh: string
}

export const EFFORT_PREF = 'cc-desk.chat-effort'

export const EFFORT_LEVELS: EffortOption[] = [
  { id: 'low', label: 'Low', labelZh: '低' },
  { id: 'medium', label: 'Medium', labelZh: '中' },
  { id: 'high', label: 'High', labelZh: '高' },
  { id: 'xhigh', label: 'Extra high', labelZh: '很高' },
  { id: 'max', label: 'Max', labelZh: '最高' },
]

const ALLOWED = new Set(EFFORT_LEVELS.map((e) => e.id))

export function normalizeEffort(value: unknown): EffortLevel {
  const v = String(value || '')
    .trim()
    .toLowerCase()
  if (v === 'extra' || v === 'extra-high' || v === 'extra_high') return 'xhigh'
  if (ALLOWED.has(v as EffortLevel)) return v as EffortLevel
  return 'high'
}

export function readStoredEffort(): EffortLevel {
  try {
    return normalizeEffort(localStorage.getItem(EFFORT_PREF))
  } catch {
    return 'high'
  }
}

export function effortLabel(id: EffortLevel) {
  return EFFORT_LEVELS.find((e) => e.id === id)?.label || id
}

export function effortIndex(id: EffortLevel) {
  const i = EFFORT_LEVELS.findIndex((e) => e.id === id)
  return i >= 0 ? i : 2
}

export function effortFromIndex(index: number): EffortLevel {
  const i = Math.max(0, Math.min(EFFORT_LEVELS.length - 1, Math.round(index)))
  return EFFORT_LEVELS[i].id
}
