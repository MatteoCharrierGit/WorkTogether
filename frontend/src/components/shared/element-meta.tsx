import {
  Archive, CalendarDays, Circle, CircleCheck, CircleDot, BookOpen, Minus, OctagonAlert, Rocket,
  SquareCheck, TriangleAlert,
  type LucideIcon,
} from 'lucide-react'
import type { ElementPriority, ElementStatus, ElementType } from '@/types'
import { cn, STATUS_LABELS, TYPE_LABELS } from '@/lib/utils'

/** Icona + colore (solo token) per ogni tipo di elemento. */
export const TYPE_META: Record<ElementType, { label: string; icon: LucideIcon; className: string }> = {
  EPICA: { label: TYPE_LABELS.EPICA, icon: Rocket, className: 'text-primary' },
  STORIA: { label: TYPE_LABELS.STORIA, icon: BookOpen, className: 'text-info' },
  TASK: { label: TYPE_LABELS.TASK, icon: SquareCheck, className: 'text-muted-foreground' },
  EVENTO: { label: TYPE_LABELS.EVENTO, icon: CalendarDays, className: 'text-warning' },
}

/** Icona + colore + variante badge per ogni stato. */
export const STATUS_META: Record<
  ElementStatus,
  { label: string; icon: LucideIcon; className: string; badge: string }
> = {
  DA_FARE: { label: STATUS_LABELS.DA_FARE, icon: Circle, className: 'text-muted-foreground', badge: 'bg-muted text-muted-foreground' },
  IN_CORSO: { label: STATUS_LABELS.IN_CORSO, icon: CircleDot, className: 'text-info', badge: 'bg-info-subtle text-info' },
  COMPLETATO: { label: STATUS_LABELS.COMPLETATO, icon: CircleCheck, className: 'text-success', badge: 'bg-success-subtle text-success' },
  ARCHIVIATO: { label: STATUS_LABELS.ARCHIVIATO, icon: Archive, className: 'text-muted-foreground/70', badge: 'bg-muted text-muted-foreground/80' },
}

const FALLBACK_TYPE = TYPE_META.TASK
const FALLBACK_STATUS = STATUS_META.DA_FARE

const ICON_SIZE = { xs: 'h-3 w-3', sm: 'h-3.5 w-3.5', md: 'h-4 w-4', lg: 'h-5 w-5' } as const

export interface TypeIconProps {
  type: ElementType | string
  size?: keyof typeof ICON_SIZE
  className?: string
  /** Se true l'icona è annunciata dagli screen reader col nome del tipo */
  labelled?: boolean
}

/** Icona lucide colorata per il tipo di elemento (EPICA, STORIA, TASK, EVENTO). */
export function TypeIcon({ type, size = 'md', className, labelled = false }: TypeIconProps) {
  const meta = TYPE_META[type as ElementType] ?? FALLBACK_TYPE
  const Icon = meta.icon
  return (
    <Icon
      className={cn('shrink-0', ICON_SIZE[size], meta.className, className)}
      aria-hidden={!labelled}
      aria-label={labelled ? meta.label : undefined}
      role={labelled ? 'img' : undefined}
    />
  )
}

export function StatusIcon({ status, size = 'md', className }: { status: ElementStatus | string; size?: keyof typeof ICON_SIZE; className?: string }) {
  const meta = STATUS_META[status as ElementStatus] ?? FALLBACK_STATUS
  const Icon = meta.icon
  return <Icon className={cn('shrink-0', ICON_SIZE[size], meta.className, className)} aria-hidden="true" />
}

export interface StatusBadgeProps {
  status: ElementStatus | string
  /** Mostra l'icona di stato prima dell'etichetta (default true) */
  icon?: boolean
  size?: 'sm' | 'default'
  className?: string
}

/** Badge dello stato di un elemento (Da fare / In corso / Completato / Archiviato). */
export function StatusBadge({ status, icon = true, size = 'default', className }: StatusBadgeProps) {
  const meta = STATUS_META[status as ElementStatus] ?? FALLBACK_STATUS
  const Icon = meta.icon
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 whitespace-nowrap rounded-full font-medium',
        size === 'sm' ? 'px-1.5 py-0 text-2xs' : 'px-2 py-0.5 text-xs',
        meta.badge,
        className
      )}
    >
      {icon && <Icon className={size === 'sm' ? 'h-3 w-3' : 'h-3.5 w-3.5'} aria-hidden="true" />}
      {meta.label ?? status}
    </span>
  )
}

/** Badge "Bloccante". */
export function BlockedBadge({ className, size = 'default' }: { className?: string; size?: 'sm' | 'default' }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-destructive-subtle font-medium text-destructive',
        size === 'sm' ? 'px-1.5 py-0 text-2xs' : 'px-2 py-0.5 text-xs',
        className
      )}
    >
      <TriangleAlert className={size === 'sm' ? 'h-3 w-3' : 'h-3.5 w-3.5'} aria-hidden="true" />
      Bloccante
    </span>
  )
}

// --- Priorità ---

type PriorityIconComponent = (props: { className?: string; 'aria-hidden'?: boolean | 'true' | 'false' }) => JSX.Element

/** Tre barre crescenti: le prime `level` piene (colore corrente), le altre tenui. */
function bars(level: 1 | 2 | 3): PriorityIconComponent {
  return function PriorityBars({ className, ...rest }) {
    return (
      <svg viewBox="0 0 16 16" fill="currentColor" className={className} {...rest}>
        {[0, 1, 2].map(i => (
          <rect
            key={i}
            x={2 + i * 4.5}
            y={10 - i * 3.5}
            width="3"
            height={4 + i * 3.5}
            rx="1"
            opacity={i < level ? 1 : 0.25}
          />
        ))}
      </svg>
    )
  }
}

/** Icona + colore (solo token) + peso di ordinamento per ogni priorità. */
export const PRIORITY_META: Record<
  ElementPriority,
  { label: string; icon: LucideIcon | PriorityIconComponent; className: string; badge: string; rank: number }
> = {
  URGENT: { label: 'Urgente', icon: OctagonAlert, className: 'text-destructive', badge: 'bg-destructive-subtle text-destructive', rank: 4 },
  HIGH: { label: 'Alta', icon: bars(3), className: 'text-warning', badge: 'bg-warning-subtle text-warning', rank: 3 },
  MEDIUM: { label: 'Media', icon: bars(2), className: 'text-info', badge: 'bg-info-subtle text-info', rank: 2 },
  LOW: { label: 'Bassa', icon: bars(1), className: 'text-muted-foreground', badge: 'bg-muted text-muted-foreground', rank: 1 },
  NONE: { label: 'Nessuna', icon: Minus, className: 'text-muted-foreground/70', badge: 'bg-muted text-muted-foreground', rank: 0 },
}

/** Priorità dalla più alta alla più bassa (per Select e filtri). */
export const PRIORITY_ORDER: ElementPriority[] = ['URGENT', 'HIGH', 'MEDIUM', 'LOW', 'NONE']

/** Peso numerico (URGENT=4 … NONE/assente=0): ordinare con `b - a` per avere le urgenti in cima. */
export function priorityRank(p?: ElementPriority | string | null): number {
  return PRIORITY_META[(p ?? 'NONE') as ElementPriority]?.rank ?? 0
}

export interface PriorityIndicatorProps {
  priority?: ElementPriority | string | null
  /** `icon`: solo icona (con tooltip nativo + sr-only); `badge`: pill con etichetta; `inline`: icona + testo */
  variant?: 'icon' | 'badge' | 'inline'
  size?: 'sm' | 'default'
  /** Mostra anche "Nessuna" (default: non renderizza nulla se la priorità è assente) */
  showNone?: boolean
  className?: string
}

/** Indicatore di priorità (Urgente / Alta / Media / Bassa). */
export function PriorityIndicator({ priority, variant = 'icon', size = 'default', showNone = false, className }: PriorityIndicatorProps) {
  const key = (priority ?? 'NONE') as ElementPriority
  const meta = PRIORITY_META[key] ?? PRIORITY_META.NONE
  if (key === 'NONE' && !showNone) return null
  const Icon = meta.icon
  const iconCls = size === 'sm' ? 'h-3 w-3' : 'h-3.5 w-3.5'
  if (variant === 'icon') {
    return (
      <span className={cn('inline-flex shrink-0 items-center', meta.className, className)} title={`Priorità: ${meta.label}`}>
        <Icon className={iconCls} aria-hidden="true" />
        <span className="sr-only">Priorità {meta.label.toLowerCase()}</span>
      </span>
    )
  }
  if (variant === 'inline') {
    return (
      <span className={cn('inline-flex items-center gap-1.5', size === 'sm' ? 'text-2xs' : 'text-sm', className)}>
        <Icon className={cn(iconCls, meta.className)} aria-hidden="true" />
        {meta.label}
      </span>
    )
  }
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 whitespace-nowrap rounded-full font-medium',
        size === 'sm' ? 'px-1.5 py-0 text-2xs' : 'px-2 py-0.5 text-xs',
        meta.badge,
        className
      )}
    >
      <Icon className={iconCls} aria-hidden="true" />
      {meta.label}
    </span>
  )
}
