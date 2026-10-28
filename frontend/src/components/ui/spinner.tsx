import { cn } from '@/lib/utils'

const SIZES = { xs: 'h-3 w-3', sm: 'h-4 w-4', md: 'h-5 w-5', lg: 'h-8 w-8' } as const

/** Indicatore di caricamento circolare (eredita il colore dal testo). */
export function Spinner({ size = 'sm', className, label = 'Caricamento…' }: { size?: keyof typeof SIZES; className?: string; label?: string }) {
  return (
    <svg role="status" aria-label={label} className={cn('animate-spin text-muted-foreground', SIZES[size], className)} viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.2" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}
