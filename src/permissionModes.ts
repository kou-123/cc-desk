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
    label: 'Manual',
    labelZh: '手动审批',
    detail: '需要审批的操作会先询问你；已获准的操作直接执行。',
    icon: 'hand',
  },
  {
    id: 'acceptEdits',
    label: 'Accept edits',
    labelZh: '接受编辑',
    detail: '自动批准工作区内的文件编辑和部分常用文件操作，其他操作按权限规则处理。',
    icon: 'spark',
  },
  {
    id: 'auto',
    label: 'Auto',
    labelZh: '自动',
    detail: '由 Claude Code 自动审查工具调用，放行常规操作，拦截高风险操作。',
    icon: 'auto',
  },
  {
    id: 'plan',
    label: 'Plan',
    labelZh: '规划',
    detail: '只读探索项目并拟定方案，退出规划模式后再实施。',
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
