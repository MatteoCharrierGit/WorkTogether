import type * as React from 'react'
import { type ClassValue, clsx } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

// tailwind-merge deve conoscere i token custom (font-size, z-index, ombre),
// altrimenti es. `text-heading` verrebbe scambiato per un colore e rimosso da `text-muted-foreground`.
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [{ text: ['2xs', 'caption', 'body', 'heading', 'title', 'display'] }],
      z: [{ z: ['sticky', 'header', 'overlay', 'modal', 'popover', 'toast', 'tooltip'] }],
      shadow: [{ shadow: ['xs'] }],
    },
  },
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatDate(date: string | Date | null | undefined): string {
  if (!date) return '—'
  return new Date(date).toLocaleDateString('it-IT', { day: '2-digit', month: 'short', year: 'numeric' })
}

export function getInitials(name: string): string {
  return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
}

// Ridimensiona un'immagine lato client e la restituisce come data URI JPEG.
export function resizeImageToDataUrl(file: File, max = 256): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const img = new Image()
      img.onload = () => {
        const scale = Math.min(1, max / Math.max(img.width, img.height))
        const w = Math.round(img.width * scale)
        const h = Math.round(img.height * scale)
        const canvas = document.createElement('canvas')
        canvas.width = w
        canvas.height = h
        const ctx = canvas.getContext('2d')
        if (!ctx) return reject(new Error('no ctx'))
        ctx.drawImage(img, 0, 0, w, h)
        resolve(canvas.toDataURL('image/jpeg', 0.85))
      }
      img.onerror = reject
      img.src = reader.result as string
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

export function formatBytes(bytes: number): string {
  if (!bytes) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  const value = bytes / Math.pow(1024, i)
  return `${value.toFixed(value < 10 && i > 0 ? 1 : 0)} ${units[i]}`
}

export const STATUS_LABELS: Record<string, string> = {
  DA_FARE: 'Da fare',
  IN_CORSO: 'In corso',
  COMPLETATO: 'Completato',
  ARCHIVIATO: 'Archiviato',
}

export const TYPE_LABELS: Record<string, string> = {
  EPICA: 'Epica',
  STORIA: 'Storia',
  TASK: 'Task',
  EVENTO: 'Evento',
}

export const TYPE_ICONS: Record<string, string> = {
  EPICA: '🚀',
  STORIA: '📂',
  TASK: '📝',
  EVENTO: '📅',
}

export const STATUS_COLORS: Record<string, string> = {
  DA_FARE: 'text-muted-foreground',
  IN_CORSO: 'text-blue-500',
  COMPLETATO: 'text-green-600',
  ARCHIVIATO: 'text-muted-foreground opacity-50',
}

// ---------------------------------------------------------------------------
// Helper del design system
// ---------------------------------------------------------------------------

/** Converte un colore #rgb/#rrggbb in HSL (h 0-360, s/l 0-100). null se non valido. */
export function hexToHsl(hex: string | null | undefined): { h: number; s: number; l: number } | null {
  if (!hex) return null
  let m = hex.trim().replace(/^#/, '')
  if (m.length === 3) m = m.split('').map(ch => ch + ch).join('')
  if (!/^[0-9a-fA-F]{6}$/.test(m)) return null
  const r = parseInt(m.slice(0, 2), 16) / 255
  const g = parseInt(m.slice(2, 4), 16) / 255
  const b = parseInt(m.slice(4, 6), 16) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  let h = 0
  let s = 0
  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0)
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h *= 60
  }
  return { h: Math.round(h), s: Math.round(s * 100), l: Math.round(l * 100) }
}

/**
 * Variabili CSS per la classe `.tinted` (index.css): sfondo tenue + testo leggibile
 * derivati da un colore arbitrario (es. colore di un tag), corretti per tema chiaro/scuro.
 */
export function tintVars(hex: string | null | undefined): React.CSSProperties {
  const hsl = hexToHsl(hex) ?? { h: 240, s: 5, l: 50 }
  return {
    ['--tint-h' as string]: String(hsl.h),
    ['--tint-s' as string]: `${Math.min(hsl.s, 80)}%`,
  } as React.CSSProperties
}

/** Tinta deterministica (0-360) da una stringa, es. per avatar senza foto. */
export function hueFromString(value: string): number {
  let hash = 0
  for (let i = 0; i < value.length; i++) hash = (hash * 31 + value.charCodeAt(i)) | 0
  return Math.abs(hash) % 360
}

/** Estrae un messaggio leggibile da un errore axios/JS. */
export function getErrorMessage(err: unknown, fallback = 'Si è verificato un errore'): string {
  const e = err as { response?: { data?: { error?: string; message?: string } }; message?: string } | null
  return e?.response?.data?.error || e?.response?.data?.message || e?.message || fallback
}

/** true se la data è passata (confronto a livello di giorno). */
export function isOverdue(date: string | Date | null | undefined): boolean {
  if (!date) return false
  const d = new Date(date)
  if (isNaN(d.getTime())) return false
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  d.setHours(0, 0, 0, 0)
  return d < today
}
