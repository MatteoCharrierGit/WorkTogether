import { useEffect, useRef } from 'react'
import { format } from 'date-fns'
import { it } from 'date-fns/locale'
import { CalendarDays, Plus } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { EmptyState } from '@/components/shared'
import { CalendarItemRow, type ChipActions } from './CalendarChip'
import { dayKey, type CalendarItem } from './calendar-utils'

/** Lista dei giorni del mese che hanno elementi (vista predefinita su mobile). */
export function AgendaView({
  days, buckets, todayKey, canCreate, onCreate, canDelete, onDelete,
}: {
  days: Date[]
  buckets: Map<string, CalendarItem[]>
  todayKey: string
  canCreate: boolean
  onCreate: (d: Date) => void
} & ChipActions) {
  const listRef = useRef<HTMLDivElement>(null)
  const groups = days.map(d => ({ date: d, key: dayKey(d), items: buckets.get(dayKey(d)) })).filter(g => g.items?.length)

  // Porta in vista il primo giorno da oggi in poi (solo al cambio di mese).
  const firstKey = days.length ? dayKey(days[0]) : ''
  useEffect(() => {
    const target = groups.find(g => g.key >= todayKey)
    if (!target || target.key === groups[0]?.key) return
    listRef.current?.querySelector(`[data-agenda="${target.key}"]`)?.scrollIntoView({ block: 'start' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firstKey])

  if (groups.length === 0) {
    return (
      <EmptyState
        bordered
        icon={CalendarDays}
        title="Niente in programma questo mese"
        description="Gli eventi e le scadenze del mese compariranno qui."
        action={
          canCreate && (
            <Button size="sm" variant="outline" onClick={() => onCreate(new Date())}>
              <Plus className="h-4 w-4" /> Nuovo evento
            </Button>
          )
        }
      />
    )
  }

  return (
    <div ref={listRef} className="overflow-hidden rounded-lg border bg-card shadow-xs">
      {groups.map(({ date, key, items }) => {
        const today = key === todayKey
        const past = key < todayKey
        return (
          <section
            key={key}
            data-agenda={key}
            aria-label={format(date, 'EEEE d MMMM', { locale: it })}
            className="scroll-mt-2 border-b last:border-b-0 sm:flex"
          >
            <div className={cn('flex items-center gap-2 px-3 pb-1 pt-2.5 sm:w-40 sm:shrink-0 sm:items-start sm:py-3', past && 'opacity-70')}>
              <span
                className={cn(
                  'inline-flex h-7 min-w-7 items-center justify-center rounded-full px-1 text-sm font-semibold tabular-nums',
                  today ? 'bg-primary text-primary-foreground' : 'text-foreground'
                )}
              >
                {format(date, 'd')}
              </span>
              <span className={cn('text-xs font-medium capitalize sm:pt-1.5', today ? 'text-primary' : 'text-muted-foreground')}>
                {today ? 'Oggi · ' : ''}
                {format(date, 'EEE', { locale: it })}
              </span>
              {canCreate && (
                <IconButton
                  label={`Nuovo evento ${format(date, 'd MMMM', { locale: it })}`}
                  icon={<Plus />}
                  size="xs"
                  onClick={() => onCreate(date)}
                  className="ml-auto sm:hidden"
                />
              )}
            </div>
            <div className="min-w-0 flex-1 px-1 pb-1.5 sm:py-1.5">
              {items!.map(item => (
                <CalendarItemRow key={item.el.id + key} item={item} canDelete={canDelete} onDelete={onDelete} />
              ))}
            </div>
          </section>
        )
      })}
    </div>
  )
}
