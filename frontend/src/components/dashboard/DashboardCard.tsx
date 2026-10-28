import * as React from 'react'
import { Link } from 'react-router-dom'
import { ChevronRight, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface DashboardCardProps {
  title: string
  icon: LucideIcon
  /** Riga sotto il titolo (riepilogo breve) */
  description?: React.ReactNode
  /** Link "Vedi tutto" in alto a destra */
  link?: { to: string; label: string }
  className?: string
  bodyClassName?: string
  children: React.ReactNode
}

/** Riquadro standard della dashboard: intestazione compatta + corpo che riempie l'altezza della riga. */
export function DashboardCard({ title, icon: Icon, description, link, className, bodyClassName, children }: DashboardCardProps) {
  const id = React.useId()
  return (
    <section
      aria-labelledby={id}
      className={cn('flex min-w-0 flex-col rounded-lg border bg-card text-card-foreground shadow-xs', className)}
    >
      <header className="flex items-start justify-between gap-3 px-4 pb-3 pt-4">
        <div className="flex min-w-0 items-start gap-2.5">
          <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-surface-2 text-muted-foreground">
            <Icon className="h-3.5 w-3.5" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h2 id={id} className="truncate text-sm font-semibold leading-6">{title}</h2>
            {description && <p className="text-caption text-muted-foreground">{description}</p>}
          </div>
        </div>
        {link && (
          <Link
            to={link.to}
            className="focus-ring -mr-1 inline-flex shrink-0 items-center gap-0.5 rounded-sm px-1 py-0.5 text-caption font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            {link.label}
            <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
        )}
      </header>
      <div className={cn('flex flex-1 flex-col px-4 pb-4', bodyClassName)}>{children}</div>
    </section>
  )
}

/** Testo compatto per stati vuoti dentro una card. */
export function CardEmpty({ icon: Icon, title, description, action }: {
  icon: LucideIcon; title: string; description?: string; action?: React.ReactNode
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 py-6 text-center">
      <span className="flex h-8 w-8 items-center justify-center rounded-lg border bg-surface-2 text-muted-foreground">
        <Icon className="h-4 w-4" aria-hidden="true" />
      </span>
      <p className="text-sm font-medium">{title}</p>
      {description && <p className="max-w-xs text-caption text-muted-foreground">{description}</p>}
      {action}
    </div>
  )
}

const NUMBER = new Intl.NumberFormat('it-IT')
export const formatNumber = (n: number) => NUMBER.format(n)

const SHORT_DATE = new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'short' })
export function formatShortDate(value: string | Date | null | undefined): string {
  if (!value) return ''
  const d = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T00:00:00`) // LocalDate: evita lo slittamento di fuso
    : new Date(value)
  return isNaN(d.getTime()) ? '' : SHORT_DATE.format(d)
}

export function percent(done: number, total: number): number {
  return total > 0 ? Math.round((done / total) * 100) : 0
}

/** Barra di avanzamento: riempimento primary, traccia nella stessa tinta più chiara. */
export function Meter({ value, label, className }: { value: number; label: string; className?: string }) {
  const v = Math.max(0, Math.min(100, value))
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={v}
      className={cn('h-1.5 w-full overflow-hidden rounded-full bg-primary/15', className)}
    >
      <div className="h-full rounded-full bg-primary transition-[width] duration-500 ease-out" style={{ width: `${v}%` }} />
    </div>
  )
}
