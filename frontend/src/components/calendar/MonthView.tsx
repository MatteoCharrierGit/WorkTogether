import { memo, useEffect, useRef, useState } from 'react'
import { addDays, format } from 'date-fns'
import { it } from 'date-fns/locale'
import { Plus } from 'lucide-react'
import { cn, tintVars } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { CalendarChip, CalendarItemRow, type ChipActions } from './CalendarChip'
import { dayKey, emptyItems, type CalendarItem } from './calendar-utils'

export const WEEKDAYS = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom']
const MAX_CHIPS = 3

interface DayCellProps extends ChipActions {
  date: Date
  k: string
  inMonth: boolean
  today: boolean
  focused: boolean
  selected: boolean
  items: CalendarItem[]
  canCreate: boolean
  compact: boolean
  onActivate: (d: Date) => void
  onCreate: (d: Date) => void
}

/** Pallini colorati (mobile): uno per elemento, max 3. */
function Dots({ items }: { items: CalendarItem[] }) {
  return (
    <div className="flex items-center justify-center gap-0.5 pt-0.5" aria-hidden="true">
      {items.slice(0, 3).map((it, i) => {
        const tag = it.el.tags?.[0]
        return (
          <span
            key={i}
            className={cn(
              'h-1.5 w-1.5 rounded-full',
              it.kind === 'task' ? 'bg-muted-foreground/60' : tag ? 'tinted' : 'bg-primary'
            )}
            style={it.kind === 'event' && tag ? { ...tintVars(tag.color), backgroundColor: 'var(--tint-solid)' } : undefined}
          />
        )
      })}
    </div>
  )
}

const DayCell = memo(function DayCell({
  date, k, inMonth, today, focused, selected, items, canCreate, compact, onActivate, onCreate, canDelete, onDelete,
}: DayCellProps) {
  const [moreOpen, setMoreOpen] = useState(false)
  const overflow = items.length > MAX_CHIPS
  const shown = overflow ? items.slice(0, MAX_CHIPS - 1) : items
  const label = format(date, 'EEEE d MMMM', { locale: it })
  const count = items.length

  return (
    <div
      role="gridcell"
      aria-selected={compact ? selected : undefined}
      onClick={() => onActivate(date)}
      className={cn(
        'group relative flex min-w-0 flex-col gap-0.5 bg-card p-1 transition-colors sm:min-h-28 sm:p-1.5',
        'min-h-14',
        !inMonth && 'bg-surface-2',
        (canCreate || compact) && 'cursor-pointer hover:bg-accent/50',
        selected && compact && 'bg-accent'
      )}
    >
      <div className="flex items-center justify-center sm:justify-between">
        <button
          type="button"
          data-day={k}
          tabIndex={focused ? 0 : -1}
          aria-current={today ? 'date' : undefined}
          aria-label={`${label}${count ? `, ${count} elementi` : ''}${canCreate && !compact ? ' — nuovo evento' : ''}`}
          onClick={e => {
            e.stopPropagation()
            onActivate(date)
          }}
          className={cn(
            'focus-ring inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-xs font-medium tabular-nums',
            today
              ? 'bg-primary text-primary-foreground'
              : inMonth
                ? 'text-foreground hover:bg-accent'
                : 'text-muted-foreground/70 hover:bg-accent'
          )}
        >
          {format(date, 'd')}
        </button>
        {canCreate && !compact && (
          <Plus className="h-3.5 w-3.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" aria-hidden="true" />
        )}
      </div>

      {compact ? (
        count > 0 && <Dots items={items} />
      ) : (
        <div className="flex min-w-0 flex-col gap-0.5">
          {shown.map(item => (
            <CalendarChip key={item.el.id} item={item} canDelete={canDelete} onDelete={onDelete} />
          ))}
          {overflow && (
            <Popover open={moreOpen} onOpenChange={setMoreOpen}>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  onClick={e => e.stopPropagation()}
                  className="focus-ring h-5 rounded-sm px-1.5 text-left text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  +{count - shown.length} altri
                </button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-72 p-1.5" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between gap-2 px-2 pb-1 pt-0.5">
                  <p className="text-sm font-semibold capitalize">{label}</p>
                  <span className="text-xs text-muted-foreground tabular-nums">{count}</span>
                </div>
                <div className="max-h-80 overflow-y-auto">
                  {items.map(item => (
                    <CalendarItemRow key={item.el.id} item={item} canDelete={canDelete} onDelete={onDelete} />
                  ))}
                </div>
                {canCreate && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="mt-1 w-full justify-start text-muted-foreground"
                    onClick={() => {
                      setMoreOpen(false)
                      onCreate(date)
                    }}
                  >
                    <Plus className="h-3.5 w-3.5" /> Nuovo evento
                  </Button>
                )}
              </PopoverContent>
            </Popover>
          )}
        </div>
      )}
    </div>
  )
})

export interface MonthViewProps extends ChipActions {
  days: Date[]
  month: Date
  buckets: Map<string, CalendarItem[]>
  todayKey: string
  focusDate: Date
  selectedKey?: string
  canCreate: boolean
  compact: boolean
  onActivate: (d: Date) => void
  onCreate: (d: Date) => void
  /** Spostamento con le frecce: la pagina cambia mese se serve */
  onFocusDate: (d: Date) => void
}

const KEY_DELTA: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }

export function MonthView({
  days, month, buckets, todayKey, focusDate, selectedKey, canCreate, compact, onActivate, onCreate, onFocusDate, canDelete, onDelete,
}: MonthViewProps) {
  const gridRef = useRef<HTMLDivElement>(null)
  const pendingFocus = useRef(false)
  const focusKey = dayKey(focusDate)
  const monthNum = month.getMonth()
  const weeks: Date[][] = []
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7))

  // Dopo una navigazione da tastiera sposta il focus sul nuovo giorno (anche dopo il cambio mese).
  useEffect(() => {
    if (!pendingFocus.current) return
    pendingFocus.current = false
    gridRef.current?.querySelector<HTMLButtonElement>(`[data-day="${focusKey}"]`)?.focus()
  }, [focusKey, days])

  const onKeyDown = (e: React.KeyboardEvent) => {
    const target = e.target as HTMLElement
    if (!target.dataset.day) return
    let next: Date | null = null
    if (KEY_DELTA[e.key] != null) next = addDays(focusDate, KEY_DELTA[e.key])
    else if (e.key === 'Home') next = addDays(focusDate, -((focusDate.getDay() + 6) % 7))
    else if (e.key === 'End') next = addDays(focusDate, 6 - ((focusDate.getDay() + 6) % 7))
    if (!next) return
    e.preventDefault()
    pendingFocus.current = true
    onFocusDate(next)
  }

  return (
    <div
      ref={gridRef}
      role="grid"
      aria-label={format(month, 'MMMM yyyy', { locale: it })}
      onKeyDown={onKeyDown}
      className="overflow-hidden rounded-lg border bg-border shadow-xs"
    >
      <div role="row" className="grid grid-cols-7 gap-px border-b bg-surface-2">
        {WEEKDAYS.map((d, i) => (
          <div
            key={d}
            role="columnheader"
            className={cn('bg-surface-2 py-1.5 text-center text-xs font-medium text-muted-foreground', i >= 5 && 'text-muted-foreground/70')}
          >
            {compact ? d.charAt(0) : d}
          </div>
        ))}
      </div>
      {weeks.map(week => (
        <div role="row" key={dayKey(week[0])} className="grid grid-cols-7 gap-px [&:not(:last-child)]:mb-px">
          {week.map(date => {
            const k = dayKey(date)
            return (
              <DayCell
                key={k}
                k={k}
                date={date}
                inMonth={date.getMonth() === monthNum}
                today={k === todayKey}
                focused={k === focusKey}
                selected={k === selectedKey}
                items={buckets.get(k) ?? emptyItems()}
                canCreate={canCreate}
                compact={compact}
                onActivate={onActivate}
                onCreate={onCreate}
                canDelete={canDelete}
                onDelete={onDelete}
              />
            )
          })}
        </div>
      ))}
    </div>
  )
}
