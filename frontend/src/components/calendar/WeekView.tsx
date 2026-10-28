import { memo } from 'react'
import { format } from 'date-fns'
import { it } from 'date-fns/locale'
import { Plus } from 'lucide-react'
import { cn } from '@/lib/utils'
import { CalendarChip, CalendarItemRow, type ChipActions } from './CalendarChip'
import { dayKey, emptyItems, type CalendarItem } from './calendar-utils'

interface WeekDayProps extends ChipActions {
  date: Date
  today: boolean
  items: CalendarItem[]
  canCreate: boolean
  compact: boolean
  onCreate: (d: Date) => void
}

const WeekDay = memo(function WeekDay({ date, today, items, canCreate, compact, onCreate, canDelete, onDelete }: WeekDayProps) {
  const label = format(date, 'EEEE d MMMM', { locale: it })
  const header = (
    <div className={cn('flex items-center gap-2', compact ? 'px-1 pb-1' : 'flex-col gap-0.5 border-b px-2 py-2')}>
      <span className={cn('text-xs font-medium uppercase tracking-wide', today ? 'text-primary' : 'text-muted-foreground')}>
        {format(date, 'EEE', { locale: it })}
      </span>
      <span
        className={cn(
          'inline-flex h-7 min-w-7 items-center justify-center rounded-full px-1 text-sm font-semibold tabular-nums',
          today && 'bg-primary text-primary-foreground'
        )}
      >
        {format(date, 'd')}
      </span>
      {compact && today && <span className="text-xs font-medium text-primary">Oggi</span>}
      {canCreate && (
        <button
          type="button"
          onClick={e => {
            e.stopPropagation()
            onCreate(date)
          }}
          aria-label={`Nuovo evento ${label}`}
          className={cn(
            'focus-ring inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground',
            compact ? 'ml-auto' : 'absolute right-1 top-1 opacity-0 focus-visible:opacity-100 group-hover:opacity-100'
          )}
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
        </button>
      )}
    </div>
  )

  if (compact) {
    return (
      <section aria-label={label} className="border-b py-2 last:border-b-0">
        {header}
        {items.length === 0 ? (
          <p className="px-2 py-1 text-xs text-muted-foreground">Niente in programma</p>
        ) : (
          items.map(item => <CalendarItemRow key={item.el.id} item={item} canDelete={canDelete} onDelete={onDelete} />)
        )}
      </section>
    )
  }

  return (
    <section
      aria-label={label}
      onClick={() => canCreate && onCreate(date)}
      className={cn(
        'group relative flex min-h-80 min-w-0 flex-col bg-card',
        canCreate && 'cursor-pointer'
      )}
    >
      {header}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5 p-1.5">
        {items.map(item => (
          <CalendarChip key={item.el.id} item={item} canDelete={canDelete} onDelete={onDelete} />
        ))}
      </div>
    </section>
  )
})

export function WeekView({
  days, buckets, todayKey, canCreate, compact, onCreate, canDelete, onDelete,
}: {
  days: Date[]
  buckets: Map<string, CalendarItem[]>
  todayKey: string
  canCreate: boolean
  compact: boolean
  onCreate: (d: Date) => void
} & ChipActions) {
  return (
    <div
      className={cn(
        'overflow-hidden rounded-lg border shadow-xs',
        compact ? 'bg-card px-1' : 'grid grid-cols-7 gap-px bg-border'
      )}
    >
      {days.map(d => {
        const k = dayKey(d)
        return (
          <WeekDay
            key={k}
            date={d}
            today={k === todayKey}
            items={buckets.get(k) ?? emptyItems()}
            canCreate={canCreate}
            compact={compact}
            onCreate={onCreate}
            canDelete={canDelete}
            onDelete={onDelete}
          />
        )
      })}
    </div>
  )
}
