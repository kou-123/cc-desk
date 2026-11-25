export type ThemeMode = 'dark' | 'light'

const KEY = 'claude-panel-theme'

export function readTheme(): ThemeMode {
  try {
    const v = localStorage.getItem(KEY)
    if (v === 'light' || v === 'dark') return v
  } catch {
    /* ignore */
  }
  return 'dark'
}

export function applyTheme(theme: ThemeMode) {
  document.documentElement.setAttribute('data-theme', theme)
  try {
    localStorage.setItem(KEY, theme)
  } catch {
    /* ignore */
  }
}

export function toggleTheme(current: ThemeMode): ThemeMode {
  const next: ThemeMode = current === 'dark' ? 'light' : 'dark'
  applyTheme(next)
  return next
}
