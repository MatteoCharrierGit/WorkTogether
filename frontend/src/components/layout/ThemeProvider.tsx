import React, { createContext, useContext, useEffect, useState } from 'react'

export const THEMES = [
  // Chiari
  { value: 'bianco', label: 'Bianco', swatch: '#ffffff' },
  { value: 'crema', label: 'Crema', swatch: '#efe7d6' },
  { value: 'beige', label: 'Beige', swatch: '#d9cfbd' },
  { value: 'blu', label: 'Blu', swatch: '#2563eb' },
  { value: 'lavanda', label: 'Lavanda', swatch: '#a78bfa' },
  // Scuri
  { value: 'grigio', label: 'Grigio scuro', swatch: '#262626' },
  { value: 'notte', label: 'Notte', swatch: '#1e3a8a' },
  { value: 'carbone', label: 'Carbone', swatch: '#0a0a0a' },
  { value: 'foresta', label: 'Foresta', swatch: '#14532d' },
] as const

export type Theme = (typeof THEMES)[number]['value']

const DARK_THEMES: Theme[] = ['grigio', 'notte', 'carbone', 'foresta']

interface ThemeCtx {
  theme: Theme
  setTheme: (t: Theme) => void
}

const ThemeContext = createContext<ThemeCtx>({ theme: 'bianco', setTheme: () => {} })

function readInitialTheme(): Theme {
  if (typeof window === 'undefined') return 'bianco'
  const saved = localStorage.getItem('wt-theme')
  if (saved && THEMES.some(t => t.value === saved)) return saved as Theme
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'grigio' : 'bianco'
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>(readInitialTheme)

  useEffect(() => {
    const root = document.documentElement
    root.setAttribute('data-theme', theme)
    // Le utility Tailwind dark: dipendono dalla classe .dark
    root.classList.toggle('dark', DARK_THEMES.includes(theme))
    localStorage.setItem('wt-theme', theme)
  }, [theme])

  return <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>
}

export const useTheme = () => useContext(ThemeContext)
