import {
  PERMISSION_PREF,
  normalizePermissionMode,
  type PermissionMode,
} from './permissionModes'

const MODEL_PREF = 'cc-desk.chat-model'

/** Read the model / permission mode currently shown in the composer. */
export function readLaunchPrefs(): {
  model: string | null
  permissionMode: PermissionMode
} {
  let model: string | null = null
  let permissionMode: PermissionMode = 'default'
  try {
    const m = localStorage.getItem(MODEL_PREF)
    if (m && m.trim()) model = m.trim()
  } catch {
    /* ignore */
  }
  try {
    permissionMode = normalizePermissionMode(
      localStorage.getItem(PERMISSION_PREF),
    )
  } catch {
    /* ignore */
  }
  return { model, permissionMode }
}

/** Map CC Desk UI permission mode → Claude Code CLI `--permission-mode`. */
export function permissionModeToCli(
  mode: PermissionMode | string | null | undefined,
): string | null {
  const m = normalizePermissionMode(mode)
  if (m === 'default') return null // CLI default Ask / manual
  return m
}
