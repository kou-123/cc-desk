import { EFFORT_PREF, normalizeEffort, type EffortLevel } from './effortLevels'
import {
  PERMISSION_PREF,
  normalizePermissionMode,
  type PermissionMode,
} from './permissionModes'

const MODEL_PREF = 'cc-desk.chat-model'

/** Read the model / permission / effort currently shown in the composer. */
export function readLaunchPrefs(): {
  model: string | null
  permissionMode: PermissionMode
  effort: EffortLevel
} {
  let model: string | null = null
  let permissionMode: PermissionMode = 'default'
  let effort: EffortLevel = 'high'
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
  try {
    effort = normalizeEffort(localStorage.getItem(EFFORT_PREF))
  } catch {
    /* ignore */
  }
  return { model, permissionMode, effort }
}

/** Map CC Desk UI permission mode → Claude Code CLI `--permission-mode`. */
export function permissionModeToCli(
  mode: PermissionMode | string | null | undefined,
): string | null {
  const m = normalizePermissionMode(mode)
  if (m === 'default') return null // CLI default Ask / manual
  return m
}
