/**
 * Claude Code CLI `--permission-mode` values shown in the interactive cycle
 * (Shift+Tab): default → acceptEdits → auto → plan.
 * See: https://code.claude.com/docs/en/permission-modes
 */

export type PermissionMode = 'default' | 'acceptEdits' | 'auto' | 'plan'

export type PermissionModeOption = {
  id: PermissionMode
  /** English name aligned with Claude Code CLI / docs */
  label: string
  /** Short Chinese helper */
  labelZh: string
  detail: string
  icon: 'hand' | 'spark' | 'plan' | 'auto'
}

/** Persist last choice across reloads. */
export const PERMISSION_PREF = 'cc-desk.permission-mode'

export const PERMISSION_MODES: PermissionModeOption[] = [
  {
    id: 'default',
    label: 'Ask',
    labelZh: '每次询问',
    detail: '读写工作区外文件、执行命令或访问网络前都先征求你同意',
    icon: 'hand',
  },
  {
    id: 'acceptEdits',
    label: 'Accept edits',
    labelZh: '自动批准编辑',
    detail: '自动允许工作区内的文件编辑与常见文件系统命令，其它操作仍会询问',
    icon: 'spark',
  },
  {
    id: 'auto',
    label: 'Auto',
    labelZh: '自动',
    detail: '尽量自动执行，由后台分类器审查可能不安全的操作',
    icon: 'auto',
  },
  {
    id: 'plan',
    label: 'Plan',
    labelZh: '仅规划',
    detail: '可以读代码、调研并给出方案，但不直接改源码',
    icon: 'plan',
  },
]

const ALLOWED = new Set(PERMISSION_MODES.map((m) => m.id))

export function normalizePermissionMode(value: unknown): PermissionMode {
  const v = String(value || '').trim()
  // CLI aliases / legacy CC Desk values
  if (v === 'manual') return 'default'
  if (v === 'dontAsk' || v === 'bypassPermissions') return 'default'
  if (ALLOWED.has(v as PermissionMode)) return v as PermissionMode
  return 'default'
}

export function readStoredPermissionMode(): PermissionMode {
  try {
    return normalizePermissionMode(localStorage.getItem(PERMISSION_PREF))
  } catch {
    return 'default'
  }
}

/** Compact label for the composer pill (English, CLI-aligned). */
export function permissionModeLabel(id: PermissionMode) {
  return PERMISSION_MODES.find((m) => m.id === id)?.label || id
}
