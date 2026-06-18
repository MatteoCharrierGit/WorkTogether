import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

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
