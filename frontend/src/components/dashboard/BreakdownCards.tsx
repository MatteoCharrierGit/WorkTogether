import { Link } from 'react-router-dom'
import { BarChart3, CalendarDays, Rocket, Users } from 'lucide-react'
import type { DashboardData, ElementPriority } from '@/types'
import { PRIORITY_META, UserAvatar } from '@/components/shared'
import { SimpleTooltip } from '@/components/ui/tooltip'
import { cn, isOverdue } from '@/lib/utils'
import { CardEmpty, DashboardCard, Meter, formatNumber, formatShortDate, percent } from './DashboardCard'

// ---------------------------------------------------------------- Priorità

/** Riempimento delle barre per priorità: stessi token semantici di PRIORITY_META (icona + etichetta sempre presenti). */
const PRIORITY_FILL: Record<ElementPriority, string> = {
  URGENT: 'bg-destructive',
  HIGH: 'bg-warning',
  MEDIUM: 'bg-info',
  LOW: 'bg-muted-foreground/60',
  NONE: 'bg-muted-foreground/30',
}

/** Distribuzione dei task aperti per priorità (barre orizzontali, valore in punta). */
export function PriorityCard({ data }: { data: DashboardData['openByPriority'] }) {
  const total = data.reduce((s, p) => s + p.count, 0)
  const max = Math.max(1, ...data.map(p => p.count))
  const urgent = data.find(p => p.priority === 'URGENT')?.count ?? 0
  const high = data.find(p => p.priority === 'HIGH')?.count ?? 0
  return (
    <DashboardCard
      title="Priorità dei task aperti"
      icon={BarChart3}
      description={total === 0 ? 'Nessun task aperto' : `${formatNumber(urgent + high)} su ${formatNumber(total)} ad alta priorità o urgenti`}
    >
      {total === 0 ? (
        <CardEmpty icon={BarChart3} title="Nessun task aperto" description="La distribuzione apparirà quando ci saranno task da fare." />
      ) : (
        <ul className="flex flex-1 flex-col justify-center gap-3">
          {data.map(p => {
            const meta = PRIORITY_META[p.priority]
            const Icon = meta.icon
            return (
              <li key={p.priority} className="grid grid-cols-[6.5rem_1fr] items-center gap-3">
                <span className="flex min-w-0 items-center gap-2 text-sm">
                  <Icon className={cn('h-3.5 w-3.5 shrink-0', meta.className)} aria-hidden="true" />
                  <span className="truncate">{meta.label}</span>
                </span>
                <span className="flex min-w-0 items-center gap-2">
                  <span className="h-2.5 min-w-0 flex-1">
                    {p.count > 0 && (
                      <span
                        className={cn('block h-full rounded-r-[4px] transition-[width] duration-500', PRIORITY_FILL[p.priority])}
                        style={{ width: `${(p.count / max) * 100}%` }}
                      />
                    )}
                  </span>
                  <span className="w-7 shrink-0 text-right text-caption font-medium tabular-nums">{formatNumber(p.count)}</span>
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </DashboardCard>
  )
}

// ---------------------------------------------------------------- Epiche

export function EpicsCard({ wsId, epics }: { wsId: string; epics: DashboardData['epics'] }) {
  return (
    <DashboardCard
      title="Epiche"
      icon={Rocket}
      description="Avanzamento, per attività recente"
      link={{ to: `/workspace/${wsId}/roadmap`, label: 'Roadmap' }}
      bodyClassName="px-2 pb-2"
    >
      {epics.length === 0 ? (
        <CardEmpty icon={Rocket} title="Nessuna epica" description="Crea un'epica dalla Kanban per seguirne qui l'avanzamento." />
      ) : (
        <ul className="space-y-0.5">
          {epics.map(e => {
            const pct = percent(e.done, e.total)
            const completed = e.status === 'COMPLETATO'
            const late = !completed && isOverdue(e.endDate)
            return (
              <li key={e.id}>
                <Link
                  to={`/workspace/${wsId}/element/${e.id}`}
                  className="focus-ring block space-y-1.5 rounded-md px-2 py-2 transition-colors hover:bg-accent"
                >
                  <span className="flex items-center gap-2">
                    <span className={cn('min-w-0 flex-1 truncate text-sm font-medium', completed && 'text-muted-foreground')}>{e.title}</span>
                    <span className="shrink-0 text-caption tabular-nums text-muted-foreground">
                      {e.total > 0 ? `${formatNumber(e.done)}/${formatNumber(e.total)}` : 'Nessun task'}
                    </span>
                  </span>
                  <Meter value={pct} label={`Avanzamento ${e.title}`} />
                  <span className="flex items-center justify-between gap-2 text-2xs text-muted-foreground">
                    <span className="font-medium tabular-nums text-foreground/80">{pct}%</span>
                    {e.endDate && (
                      <span className={cn('inline-flex items-center gap-1', late && 'font-medium text-destructive')}>
                        <CalendarDays className="h-3 w-3" aria-hidden="true" />
                        {late ? 'Scaduta il ' : 'Entro il '}{formatShortDate(e.endDate)}
                      </span>
                    )}
                  </span>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </DashboardCard>
  )
}

// ---------------------------------------------------------------- Carico del team

const WORKLOAD_LIMIT = 8

/** Task aperti per membro: barra impilata In corso + Da fare, scaduti segnalati a parte. */
export function WorkloadCard({ workload, unassigned }: { workload: DashboardData['workload']; unassigned: number }) {
  const shown = workload.slice(0, WORKLOAD_LIMIT)
  const rest = workload.length - shown.length
  const max = Math.max(1, ...workload.map(m => m.open))
  const anyOpen = workload.some(m => m.open > 0)
  return (
    <DashboardCard
      title="Carico del team"
      icon={Users}
      description={unassigned > 0
        ? `${formatNumber(unassigned)} ${unassigned === 1 ? 'task aperto' : 'task aperti'} senza assegnatario`
        : 'Task aperti per persona'}
    >
      {!anyOpen ? (
        <CardEmpty icon={Users} title="Nessun task assegnato" description="Assegna i task ai membri per vedere come si distribuisce il lavoro." />
      ) : (
        <div className="flex flex-1 flex-col gap-3">
          <div className="flex items-center gap-4 text-2xs text-muted-foreground" aria-hidden="true">
            <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-primary" />In corso</span>
            <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-primary/35" />Da fare</span>
          </div>
          <ul className="space-y-2.5">
            {shown.map(m => {
              const todo = Math.max(0, m.open - m.inProgress)
              const label = `${m.displayName}: ${m.open} aperti (${m.inProgress} in corso, ${todo} da fare${m.overdue ? `, ${m.overdue} scaduti` : ''})`
              return (
                <li key={m.userId} className="flex items-center gap-2.5">
                  <UserAvatar name={m.displayName} avatarUrl={m.avatarUrl} size="sm" />
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-sm">{m.displayName}</span>
                      <span className="shrink-0 text-caption tabular-nums text-muted-foreground">
                        {m.overdue > 0 && (
                          <span className="mr-2 font-medium text-destructive">{formatNumber(m.overdue)} {m.overdue === 1 ? 'scaduto' : 'scaduti'}</span>
                        )}
                        <span className="font-medium text-foreground">{formatNumber(m.open)}</span>
                      </span>
                    </div>
                    <SimpleTooltip content={label}>
                      <div
                        role="img"
                        aria-label={label}
                        tabIndex={0}
                        className="focus-ring flex h-2 gap-0.5 rounded-sm"
                      >
                        {m.open === 0 ? (
                          <span className="h-full w-full rounded-full bg-muted" />
                        ) : (
                          <>
                            {m.inProgress > 0 && (
                              <span
                                className={cn('h-full bg-primary', todo === 0 && 'rounded-r-[4px]')}
                                style={{ width: `${(m.inProgress / max) * 100}%` }}
                              />
                            )}
                            {todo > 0 && (
                              <span className="h-full rounded-r-[4px] bg-primary/35" style={{ width: `${(todo / max) * 100}%` }} />
                            )}
                          </>
                        )}
                      </div>
                    </SimpleTooltip>
                  </div>
                </li>
              )
            })}
          </ul>
          {rest > 0 && <p className="text-caption text-muted-foreground">e altri {rest} membri</p>}
        </div>
      )}
    </DashboardCard>
  )
}
