import { forwardRef, memo } from 'react'
import { Link } from 'react-router-dom'
import { ChevronRight, Trash2, FolderOpen } from 'lucide-react'
import { differenceInCalendarDays, format, startOfDay } from 'date-fns'
import { it } from 'date-fns/locale'
import type { Element, ElementStatus } from '@/types'
import { cn } from '@/lib/utils'
import { IconButton } from '@/components/ui/icon-button'
import { TypeIcon, STATUS_META } from '@/components/shared'
import type { RoadmapRow, Scale, Segment } from './roadmap-utils'

/** Colori delle barre: epiche in accento, il resto per stato. Testo sempre text-foreground. */
const BAR_TONE: Record<ElementStatus | 'EPICA', { bar: string; fill: string; dot: string }> = {
  EPICA: { bar: 'border-primary/45 bg-primary/10', fill: 'bg-primary/30', dot: 'bg-primary' },
  DA_FARE: { bar: 'border-border-strong bg-muted', fill: '', dot: 'bg-muted-foreground' },
  IN_CORSO: { bar: 'border-info/45 bg-info-subtle', fill: '', dot: 'bg-info' },
  COMPLETATO: { bar: 'border-success/45 bg-success-subtle', fill: '', dot: 'bg-success' },
  ARCHIVIATO: { bar: 'border-border bg-muted/60 text-muted-foreground', fill: '', dot: 'bg-muted-foreground/60' },
}
const toneFor = (el: Element) => (el.type === 'EPICA' ? BAR_TONE.EPICA : BAR_TONE[el.status] ?? BAR_TONE.DA_FARE)

const fmt = (iso?: string) => (iso ? format(new Date(iso), 'd MMM yyyy', { locale: it }) : '—')

function Bar({ el, scale, span }: { el: Element; scale: Scale; span?: { start: Date; end: Date } }) {
  const tone = toneFor(el)
  const s = el.startDate ? startOfDay(new Date(el.startDate)) : null
  const e = el.endDate ? startOfDay(new Date(el.endDate)) : null
  const tip = `${el.title}\n${fmt(el.startDate)} → ${fmt(el.endDate)}${el.type === 'EPICA' ? ` · ${el.progress ?? 0}%` : ''}`

  if (!s && !e && span) {
    // Nessuna data propria: intervallo ricavato dai figli, tratteggiato.
    const from = startOfDay(span.start)
    const left = scale.x(from)
    const width = Math.max(scale.ppd, (differenceInCalendarDays(startOfDay(span.end), from) + 1) * scale.ppd)
    const dashed = (
      <div
        className="absolute top-1/2 flex h-5 -translate-y-1/2 items-center overflow-hidden rounded-md border border-dashed border-border-strong bg-surface-2/60 text-muted-foreground"
        style={{ left, width }}
        title={`${el.title}\nSenza date proprie · periodo dei task: ${format(span.start, 'd MMM', { locale: it })} → ${format(span.end, 'd MMM yyyy', { locale: it })}`}
      >
        {width >= 72 && <span className="truncate px-2 text-xs">{el.title}</span>}
      </div>
    )
    return width >= 72 ? dashed : (
      <>
        {dashed}
        <span className="absolute top-1/2 -translate-y-1/2 whitespace-nowrap text-xs text-muted-foreground" style={{ left: left + width + 6 }}>
          {el.title}
        </span>
      </>
    )
  }

  if (!s && !e) {
    return <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground/70">Senza date</span>
  }

  // Solo una data (es. task con scadenza): milestone a rombo.
  if (!s || !e) {
    const d = (s ?? e)!
    const left = scale.x(d) + scale.ppd / 2
    return (
      <div className="absolute top-1/2 flex -translate-y-1/2 items-center gap-1.5" style={{ left: left - 5 }} title={tip}>
        <span className={cn('h-2.5 w-2.5 rotate-45 rounded-[2px] ring-2 ring-background', tone.dot)} aria-hidden="true" />
        <span className="whitespace-nowrap text-xs text-muted-foreground">{el.title}</span>
      </div>
    )
  }

  const [from, to] = e < s ? [e, s] : [s, e]
  const left = scale.x(from)
  const width = Math.max(scale.ppd, (differenceInCalendarDays(to, from) + 1) * scale.ppd)
  const isEpic = el.type === 'EPICA'
  const labelInside = width >= 72
  const progress = Math.max(0, Math.min(100, el.progress ?? 0))

  return (
    <>
      <div
        className={cn(
          'absolute top-1/2 flex -translate-y-1/2 items-center overflow-hidden rounded-md border text-foreground shadow-xs',
          isEpic ? 'h-6' : 'h-5',
          tone.bar,
          el.blocked && 'ring-1 ring-destructive/60'
        )}
        style={{ left, width }}
        title={tip}
      >
        {isEpic && progress > 0 && (
          <div className={cn('absolute inset-y-0 left-0', tone.fill)} style={{ width: `${progress}%` }} aria-hidden="true" />
        )}
        {labelInside && (
          <span className="relative truncate px-2 text-xs font-medium">
            {el.title}
            {isEpic && <span className="ml-1.5 font-normal text-muted-foreground tabular-nums">{progress}%</span>}
          </span>
        )}
      </div>
      {!labelInside && (
        <span
          className="absolute top-1/2 -translate-y-1/2 whitespace-nowrap text-xs text-muted-foreground"
          style={{ left: left + width + 6 }}
        >
          {el.title}
        </span>
      )}
    </>
  )
}

export interface RowProps {
  row: RoadmapRow
  scale: Scale
  canDelete: (el: Pick<Element, 'type' | 'createdBy'>) => boolean
  onDelete: (el: Element) => void
  onToggle: (key: string) => void
}

export const TimelineRow = memo(function TimelineRow({ row, scale, canDelete, onDelete, onToggle }: RowProps) {
  const { el, depth, childCount, open, groupLabel } = row
  const isEpic = el?.type === 'EPICA'
  const indent = 8 + depth * 14
  return (
    <div
      role="row"
      className={cn('group flex hover:bg-accent/40', isEpic || groupLabel ? 'h-10' : 'h-9', (isEpic || groupLabel) && depth === 0 && 'border-t first:border-t-0')}
    >
      <div
        role="rowheader"
        className="sticky left-0 z-sticky flex w-[var(--left-w)] shrink-0 items-center gap-1 border-r bg-background pr-1 group-hover:bg-accent"
        style={{ paddingLeft: indent }}
      >
        {childCount > 0 ? (
          <IconButton
            label={open ? 'Comprimi' : `Espandi (${childCount})`}
            icon={<ChevronRight className={cn('transition-transform', open && 'rotate-90')} />}
            size="xs"
            noTooltip
            aria-expanded={open}
            onClick={() => onToggle(row.key)}
            className="h-6 w-6 shrink-0"
          />
        ) : (
          <span className="w-6 shrink-0" aria-hidden="true" />
        )}
        {el ? <TypeIcon type={el.type} size="sm" /> : <FolderOpen className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />}
        {el ? (
          <Link
            to={`/workspace/${el.workspaceId}/element/${el.id}`}
            title={el.title}
            className={cn(
              'ml-1 min-w-0 flex-1 truncate text-sm hover:text-primary focus-visible:underline focus-visible:outline-none',
              isEpic ? 'font-semibold' : depth >= 2 ? 'text-muted-foreground' : 'font-medium',
              el.status === 'COMPLETATO' && !isEpic && 'text-muted-foreground line-through decoration-muted-foreground/50'
            )}
          >
            {el.title}
          </Link>
        ) : (
          <span className="ml-1 min-w-0 flex-1 truncate text-sm font-medium text-muted-foreground">{groupLabel}</span>
        )}
        {el && isEpic && (
          <span className="hidden shrink-0 text-xs tabular-nums text-muted-foreground sm:inline">{el.progress ?? 0}%</span>
        )}
        {el && !isEpic && (
          <span className="hidden shrink-0 px-1 sm:inline" title={STATUS_META[el.status]?.label}>
            <span className={cn('block h-1.5 w-1.5 rounded-full', toneFor(el).dot)} aria-hidden="true" />
            <span className="sr-only">{STATUS_META[el.status]?.label}</span>
          </span>
        )}
        {el && canDelete(el) && (
          <IconButton
            label={`Elimina "${el.title}"`}
            icon={<Trash2 />}
            size="xs"
            onClick={() => onDelete(el)}
            className="hidden h-6 w-6 shrink-0 hover:text-destructive sm:inline-flex sm:opacity-0 sm:focus-visible:opacity-100 sm:group-hover:opacity-100"
          />
        )}
      </div>
      <div role="gridcell" className="relative shrink-0" style={{ width: scale.width }}>
        {el && <Bar el={el} scale={scale} span={row.span} />}
      </div>
    </div>
  )
})

/** Intestazione (due righe) con il marcatore "Oggi". */
export const TimelineHeader = forwardRef<
  HTMLDivElement,
  { top: Segment[]; bottom: Segment[]; scale: Scale; todayX: number | null; label: string }
>(function TimelineHeader({ top, bottom, scale, todayX, label }, ref) {
  return (
    <div role="row" className="sticky top-0 z-header flex border-b bg-surface-2">
      <div
        ref={ref}
        role="columnheader"
        className="sticky left-0 z-header flex w-[var(--left-w)] shrink-0 items-end border-r bg-surface-2 px-3 pb-1.5 text-xs font-medium text-muted-foreground"
      >
        {label}
      </div>
      <div className="relative h-14 shrink-0" style={{ width: scale.width }} aria-hidden="true">
        {top.map(s => (
          <div key={s.key} className="absolute top-0 h-7 border-l first:border-l-0" style={{ left: s.left, width: s.width }}>
            <span className="sticky left-[calc(var(--left-w)+0.5rem)] inline-block whitespace-nowrap px-2 pt-1.5 text-xs font-semibold capitalize text-foreground">
              {s.label}
            </span>
          </div>
        ))}
        {bottom.map(s => (
          <div
            key={s.key}
            className="absolute top-7 flex h-7 items-center overflow-hidden border-l border-t px-1.5 text-xs capitalize text-muted-foreground"
            style={{ left: s.left, width: s.width }}
          >
            <span className="truncate">{s.label}</span>
          </div>
        ))}
        {todayX != null && (
          <span
            className="absolute bottom-1 z-[1] -translate-x-1/2 rounded-sm bg-primary px-1 text-2xs font-semibold text-primary-foreground"
            style={{ left: todayX }}
          >
            Oggi
          </span>
        )}
      </div>
    </div>
  )
})

/** Linee verticali + marcatore di oggi sotto le righe. */
export const TimelineGrid = memo(function TimelineGrid({ bottom, todayX }: { bottom: Segment[]; todayX: number | null }) {
  return (
    <div className="pointer-events-none absolute inset-y-0 left-[var(--left-w)]" aria-hidden="true">
      {bottom.map(s => (
        <div key={s.key} className="absolute inset-y-0 border-l border-border/60" style={{ left: s.left }} />
      ))}
      {todayX != null && <div className="absolute inset-y-0 w-px bg-primary/70" style={{ left: todayX }} />}
    </div>
  )
})
