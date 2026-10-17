// Theme preference: System (follow the OS), Light or Dark. Stored per machine in localStorage —
// it's a display preference, not part of the shared workspace.

export type ThemePref = 'system' | 'light' | 'dark'
export type Theme = 'light' | 'dark'

const KEY = 'apiman.theme'
const media = (): MediaQueryList => window.matchMedia('(prefers-color-scheme: dark)')

export function loadThemePref(): ThemePref {
  try {
    const v = localStorage.getItem(KEY)
    if (v === 'light' || v === 'dark' || v === 'system') return v
  } catch {
    /* storage unavailable */
  }
  return 'system'
}

export function saveThemePref(pref: ThemePref): void {
  try {
    localStorage.setItem(KEY, pref)
  } catch {
    /* storage unavailable */
  }
}

export const resolveTheme = (pref: ThemePref): Theme => (pref === 'system' ? (media().matches ? 'dark' : 'light') : pref)

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme
}

/** Call `onChange` when the OS switches between light and dark. Returns an unsubscribe function. */
export function watchSystemTheme(onChange: () => void): () => void {
  const m = media()
  m.addEventListener('change', onChange)
  return () => m.removeEventListener('change', onChange)
}
