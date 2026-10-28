import { Link } from 'react-router-dom'
import { CalendarDays, ListChecks, PartyPopper, TriangleAlert } from 'lucide-react'
import type { DashboardData } from '@/types'
import { PriorityIndicator, StatusIcon } from '@/components/shared'
import { cn, isOverdue } from '@/lib/utils'
import { CardEmpty, DashboardCard, formatNumber, formatShortDate } from './DashboardCard'

/** "Le mie priorità": i prossimi 5 task aperti assegnati all'utente, per priorità e scadenza. */
export function MyPrioritiesCard({ wsId, me }: { wsId: string; me: DashboardData['me'] }) {
  const parts = [`${formatNumber(me.openCount)} ${me.openCount === 1 ? 'aperta' : 'aperte'}`]
  if (me.overdueCount > 0) parts.push(`${formatNumber(me.overdueCount)} ${me.overdueCount === 1 ? 'scaduta' : 'scadute'}`)
  if (me.dueThisWeekCount > 0) parts.push(`${formatNumber(me.dueThisWeekCount)} in settimana`)
  return (
    <DashboardCard
      title="Le mie priorità"
      icon={ListChecks}
      description={parts.join(' · ')}
      link={{ to: '/my-tasks', label: 'Tutte' }}
      bodyClassName="px-2 pb-2"
    >
      {me.next.length === 0 ? (
        <CardEmpty
          icon={PartyPopper}
          title="Niente in sospeso"
          description="Non hai task aperti assegnati in questo workspace."
        />
      ) : (
        <ul className="space-y-0.5">
          {me.next.map(t => {
            const overdue = isOverdue(t.endDate)
            return (
              <li key={t.id}>
                <Link
                  to={`/workspace/${wsId}/element/${t.id}`}
                  className="focus-ring flex items-center gap-2.5 rounded-md px-2 py-2 transition-colors hover:bg-accent"
                >
                  <StatusIcon status={t.status} size="sm" />
                  <span className="min-w-0 flex-1 truncate text-sm">{t.title}</span>
                  {t.blocked && (
                    <span className="inline-flex shrink-0 text-warning" title="Bloccante">
                      <TriangleAlert className="h-3.5 w-3.5" aria-hidden="true" />
                      <span className="sr-only">Bloccante</span>
                    </span>
                  )}
                  {t.endDate && (
                    <span
                      className={cn(
                        'inline-flex shrink-0 items-center gap-1 text-caption tabular-nums',
                        overdue ? 'font-medium text-destructive' : 'text-muted-foreground',
                      )}
                    >
                      <CalendarDays className="h-3 w-3" aria-hidden="true" />
                      {formatShortDate(t.endDate)}
                      {overdue && <span className="sr-only">(scaduta)</span>}
                    </span>
                  )}
                  <PriorityIndicator priority={t.priority} showNone className="w-3.5 justify-center" />
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </DashboardCard>
  )
}
