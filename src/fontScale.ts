/** UI font scale — drives `html { font-size }` so rem-based layout scales together. */

export type FontScaleId = 'sm' | 'md' | 'lg' | 'xl' | 'custom'

export type FontScaleOption = {
  id: Exclude<FontScaleId, 'custom'>
  label: string
  /** Root font size in px */
  px: number
  hint: string
}

/** Source of truth: integer root px. */
export const FONT_PX_PREF = 'cc-desk.font-px'
/** Optional preset id for the settings radios. */
export const FONT_SCALE_PREF = 'cc-desk.font-scale'
/** @deprecated legacy multiplier / mixed value */
export const FONT_SCALE_CUSTOM_PREF = 'cc-desk.font-scale-value'

export const FONT_PX_MIN = 12
export const FONT_PX_MAX = 22
export const FONT_PX_DEFAULT = 16

export const FONT_SCALE_OPTIONS: FontScaleOption[] = [
  { id: 'sm', label: 'Small', px: 14, hint: '14px' },
  { id: 'md', label: 'Default', px: 16, hint: '16px' },
  { id: 'lg', label: 'Large', px: 18, hint: '18px' },
  { id: 'xl', label: 'Larger', px: 20, hint: '20px' },
]

const PRESET = new Set(FONT_SCALE_OPTIONS.map((o) => o.id))

export function clampFontPx(n: number) {
  if (!Number.isFinite(n)) return FONT_PX_DEFAULT
  return Math.min(FONT_PX_MAX, Math.max(FONT_PX_MIN, Math.round(n)))
}

export function pxToScale(px: number) {
  return clampFontPx(px) / FONT_PX_DEFAULT
}

export function scaleToPx(scale: number) {
  return clampFontPx((Number(scale) || 1) * FONT_PX_DEFAULT)
}

function parseStoredPx(raw: string | null): number | null {
  if (raw == null || raw === '') return null
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) return null
  // Legacy multiplier from the old slider (e.g. 0.875 / 1.125)
  if (n > 0 && n < 4) return scaleToPx(n)
  return clampFontPx(n)
}

export function matchPresetPx(
  px: number,
): Exclude<FontScaleId, 'custom'> | 'custom' {
  const n = clampFontPx(px)
  const hit = FONT_SCALE_OPTIONS.find((o) => o.px === n)
  return hit ? hit.id : 'custom'
}

export function fontScaleMeta(id: FontScaleId): FontScaleOption {
  if (id === 'custom') {
    const px = readFontPx()
    return { id: 'md', label: 'Custom', px, hint: `${px}px` }
  }
  return FONT_SCALE_OPTIONS.find((o) => o.id === id) || FONT_SCALE_OPTIONS[1]
}

/** Current root px — prefers the dedicated px key, then migrates legacy keys. */
export function readFontPx(): number {
  try {
    const direct = parseStoredPx(localStorage.getItem(FONT_PX_PREF))
    if (direct != null) return direct

    const legacyCustom = parseStoredPx(
      localStorage.getItem(FONT_SCALE_CUSTOM_PREF),
    )
    if (legacyCustom != null) return legacyCustom

    const id = String(localStorage.getItem(FONT_SCALE_PREF) || '').trim()
    if (PRESET.has(id as FontScaleOption['id'])) {
      return (
        FONT_SCALE_OPTIONS.find((o) => o.id === id)?.px || FONT_PX_DEFAULT
      )
    }
  } catch {
    /* ignore */
  }
  return FONT_PX_DEFAULT
}

export function readFontScale(): FontScaleId {
  return matchPresetPx(readFontPx())
}

export function readFontScaleValue(): number {
  return pxToScale(readFontPx())
}

export function applyFontScale(id: FontScaleId, px?: number) {
  const value =
    id === 'custom' || px != null
      ? clampFontPx(px ?? readFontPx())
      : fontScaleMeta(id).px
  const resolvedId = matchPresetPx(value)
  const root = document.documentElement
  root.style.setProperty('--font-scale', String(pxToScale(value)))
  root.setAttribute('data-font-scale', resolvedId)
  try {
    localStorage.setItem(FONT_PX_PREF, String(value))
    localStorage.setItem(FONT_SCALE_PREF, resolvedId)
    // Keep legacy key in sync so older builds still see something sensible.
    localStorage.setItem(FONT_SCALE_CUSTOM_PREF, String(value))
  } catch {
    /* ignore */
  }
  return { id: resolvedId as FontScaleId, px: value, scale: pxToScale(value) }
}

export function formatFontPx(px: number) {
  return `${clampFontPx(px)}px`
}
