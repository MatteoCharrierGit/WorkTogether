import { Link } from 'react-router-dom'
import { CalendarDays, Target } from 'lucide-react'
import type { DashboardData } from '@/types'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { CardEmpty, DashboardCard, Meter, formatNumber, formatShortDate, percent } from './DashboardCard'

function daysLeftLabel(daysLeft?: number | null): { text: string; tone: string } {
  if (daysLeft == null) return { text: 'Senza data di fine', tone: 'text-muted-foreground' }
  if (daysLeft > 1) return { text: `${daysLeft} giorni rimasti`, tone: 'text-foreground' }
  if (daysLeft === 1) return { text: '1 giorno rimasto', tone: 'text-warning' }
  if (daysLeft === 0) return { text: 'Termina oggi', tone: 'text-warning' }
  const over = -daysLeft
  return { text: `Oltre la fine di ${over} ${over === 1 ? 'giorno' : 'giorni'}`, tone: 'text-destructive' }
}

/** Sprint attiva: obiettivo, avanzamento, giorni rimasti. Stato vuoto con link alla pianificazione. */
export function SprintCard({ wsId, sprint }: { wsId: string; sprint: DashboardData['activeSprint'] }) {
  const to = `/workspace/${wsId}/sprint`
  if (!sprint) {
    return (
      <DashboardCard title="Sprint attiva" icon={Target}>
        <CardEmpty
          icon={Target}
          title="Nessuna sprint in corso"
          description="Avvia una sprint per seguire qui avanzamento e giorni rimasti."
          action={<Button asChild size="sm" variant="outline" className="mt-1"><Link to={to}>Vai alle sprint</Link></Button>}
        />
      </DashboardCard>
    )
  }
  const pct = percent(sprint.done, sprint.total)
  const left = daysLeftLabel(sprint.daysLeft)
  const range = [formatShortDate(sprint.startDate), formatShortDate(sprint.endDate)].filter(Boolean).join(' – ')
  const todo = Math.max(0, sprint.total - sprint.done - sprint.inProgress)
  return (
    <DashboardCard title="Sprint attiva" icon={Target} link={{ to, label: 'Apri' }}>
      <div className="flex flex-1 flex-col gap-4">
        <div className="min-w-0 space-y-1">
          <p className="truncate text-heading">{sprint.name}</p>
          {sprint.goal && <p className="line-clamp-2 text-sm text-muted-foreground">{sprint.goal}</p>}
        </div>

        <div className="space-y-2">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-title">{pct}%</span>
            <span className="text-caption text-muted-foreground tabular-nums">
              {formatNumber(sprint.done)} di {formatNumber(sprint.total)} completati
            </span>
          </div>
          <Meter value={pct} label={`Avanzamento sprint ${sprint.name}`} />
        </div>

        <dl className="grid grid-cols-3 gap-2 text-center">
          {[
            { label: 'Da fare', value: todo },
            { label: 'In corso', value: sprint.inProgress },
            { label: 'Bloccati', value: sprint.blocked, alert: sprint.blocked > 0 },
          ].map(s => (
            <div key={s.label} className="rounded-md bg-surface-2 px-2 py-1.5">
              <dt className="text-2xs text-muted-foreground">{s.label}</dt>
              <dd className={cn('text-sm font-semibold', s.alert && 'text-warning')}>{formatNumber(s.value)}</dd>
            </div>
          ))}
        </dl>

        <div className="mt-auto flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t pt-3 text-caption">
          <span className="inline-flex items-center gap-1 text-muted-foreground">
            <CalendarDays className="h-3.5 w-3.5" aria-hidden="true" />
            {range || 'Date non impostate'}
          </span>
          <span className={cn('font-medium', left.tone)}>{left.text}</span>
        </div>
      </div>
    </DashboardCard>
  )
}
