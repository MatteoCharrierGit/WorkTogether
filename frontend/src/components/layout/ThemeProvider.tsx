import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'

/**
 * Tema: due temi curati (chiaro/scuro) + "system" che segue prefers-color-scheme.
 * Accento: colore primario selezionabile, applicato via data-accent su <html>.
 * Persistenza: localStorage 'wt-theme' e 'wt-accent'. I vecchi valori
 * (bianco, crema, …, grigio, notte, …) vengono migrati senza errori.
 */

export const THEMES = [
  { value: 'light', label: 'Chiaro' },
  { value: 'dark', label: 'Scuro' },
  { value: 'system', label: 'Sistema' },
] as const

export type Theme = (typeof THEMES)[number]['value']
export type ResolvedTheme = 'light' | 'dark'

export const ACCENTS = [
  { value: 'indigo', label: 'Indaco', swatch: '#4f46e5' },
  { value: 'blue', label: 'Blu', swatch: '#2563eb' },
  { value: 'violet', label: 'Viola', swatch: '#7c3aed' },
  { value: 'green', label: 'Verde', swatch: '#16a34a' },
  { value: 'amber', label: 'Ambra', swatch: '#f59e0b' },
  { value: 'rose', label: 'Rosa', swatch: '#e11d48' },
] as const

export type Accent = (typeof ACCENTS)[number]['value']

const THEME_KEY = 'wt-theme'
const ACCENT_KEY = 'wt-accent'

// Vecchi temi (9 palette) → nuovo tema + accento suggerito
const LEGACY_LIGHT = ['bianco', 'crema', 'beige', 'blu', 'lavanda']
const LEGACY_DARK = ['grigio', 'notte', 'carbone', 'foresta']
const LEGACY_ACCENT: Record<string, Accent> = { blu: 'blue', lavanda: 'violet', notte: 'blue', foresta: 'green' }

function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}
function safeSet(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* storage non disponibile: il tema resta valido per la sessione */
  }
}

export function normalizeTheme(value: unknown): Theme {
  if (value === 'light' || value === 'dark' || value === 'system') return value
  if (typeof value === 'string') {
    if (LEGACY_LIGHT.includes(value)) return 'light'
    if (LEGACY_DARK.includes(value)) return 'dark'
  }
  return 'system'
}

export function normalizeAccent(value: unknown): Accent {
  return ACCENTS.some(a => a.value === value) ? (value as Accent) : 'indigo'
}

function readInitial(): { theme: Theme; accent: Accent } {
  if (typeof window === 'undefined') return { theme: 'system', accent: 'indigo' }
  const rawTheme = safeGet(THEME_KEY)
  const rawAccent = safeGet(ACCENT_KEY)
  const accent = rawAccent ? normalizeAccent(rawAccent) : (rawTheme && LEGACY_ACCENT[rawTheme]) || 'indigo'
  return { theme: normalizeTheme(rawTheme), accent }
}

function systemPrefersDark(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-color-scheme: dark)').matches
}

interface ThemeCtx {
  /** Preferenza salvata: light | dark | system */
  theme: Theme
  /** Tema effettivamente applicato */
  resolvedTheme: ResolvedTheme
  setTheme: (t: Theme | string) => void
  accent: Accent
  setAccent: (a: Accent | string) => void
}

const ThemeContext = createContext<ThemeCtx>({
  theme: 'system',
  resolvedTheme: 'light',
  setTheme: () => {},
  accent: 'indigo',
  setAccent: () => {},
})

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [initial] = useState(readInitial)
  const [theme, setThemeState] = useState<Theme>(initial.theme)
  const [accent, setAccentState] = useState<Accent>(initial.accent)
  const [systemDark, setSystemDark] = useState(systemPrefersDark)

  // Segue i cambi di prefers-color-scheme (rilevante solo con theme === 'system')
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)')
    if (!mq) return
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches)
    mq.addEventListener?.('change', onChange)
    return () => mq.removeEventListener?.('change', onChange)
  }, [])

  const resolvedTheme: ResolvedTheme = theme === 'system' ? (systemDark ? 'dark' : 'light') : theme

  useEffect(() => {
    const root = document.documentElement
    root.classList.toggle('dark', resolvedTheme === 'dark')
    root.setAttribute('data-theme', resolvedTheme)
    safeSet(THEME_KEY, theme)
  }, [theme, resolvedTheme])

  useEffect(() => {
    document.documentElement.setAttribute('data-accent', accent)
    safeSet(ACCENT_KEY, accent)
  }, [accent])

  // Breve transizione dei colori solo quando l'utente cambia tema/accento
  const withTransition = useCallback((fn: () => void) => {
    const root = document.documentElement
    root.classList.add('theme-transition')
    fn()
    window.setTimeout(() => root.classList.remove('theme-transition'), 250)
  }, [])

  const setTheme = useCallback(
    (t: Theme | string) => withTransition(() => setThemeState(normalizeTheme(t))),
    [withTransition],
  )
  const setAccent = useCallback(
    (a: Accent | string) => withTransition(() => setAccentState(normalizeAccent(a))),
    [withTransition],
  )

  const value = useMemo(
    () => ({ theme, resolvedTheme, setTheme, accent, setAccent }),
    [theme, resolvedTheme, setTheme, accent, setAccent],
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export const useTheme = () => useContext(ThemeContext)
