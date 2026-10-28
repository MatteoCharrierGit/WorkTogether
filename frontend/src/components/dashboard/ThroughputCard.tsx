import { useMemo } from 'react'
import { Minus, TrendingDown, TrendingUp, Activity } from 'lucide-react'
import type { DashboardData } from '@/types'
import { SimpleTooltip } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { DashboardCard, formatNumber } from './DashboardCard'

/** Massimo "pulito" per l'asse y (interi). */
function niceMax(m: number): number {
  if (m <= 4) return 4
  const p = 10 ** Math.floor(Math.log10(m))
  for (const f of [1, 2, 2.5, 4, 5, 10]) if (f * p >= m) return f * p
  return 10 * p
}

const DAY_LABEL = new Intl.DateTimeFormat('it-IT', { weekday: 'short', day: 'numeric', month: 'short' })
const AXIS_LABEL = new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'short' })
const parseDay = (d: string) => new Date(`${d}T00:00:00`)

/**
 * Task completati per giorno negli ultimi 14 giorni: colonne (una serie, colore primary) con
 * tooltip per colonna (anche da tastiera) e griglia a linee sottili; ogni colonna ha un'etichetta accessibile.
 */
export function ThroughputCard({ throughput, className }: { throughput: DashboardData['throughput']; className?: string }) {
  const { days, total, previousTotal } = throughput
  const max = useMemo(() => Math.max(0, ...days.map(d => d.count)), [days])
  const yMax = niceMax(max)
  const ticks = yMax % 2 === 0 ? [0, yMax / 2, yMax] : [0, yMax]
  const delta = total - previousTotal

  const trend = delta > 0
    ? { icon: TrendingUp, tone: 'text-success', text: `+${formatNumber(delta)}` }
    : delta < 0
      ? { icon: TrendingDown, tone: 'text-destructive', text: `−${formatNumber(-delta)}` }
      : { icon: Minus, tone: 'text-muted-foreground', text: '=' }

  return (
    <DashboardCard title="Ritmo di completamento" icon={Activity} description="Task chiusi al giorno, ultimi 14 giorni" className={className}>
      <div className="flex flex-1 flex-col gap-4">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="text-display">{formatNumber(total)}</span>
          <span className="inline-flex items-center gap-1 text-caption text-muted-foreground">
            <trend.icon className={cn('h-3.5 w-3.5', trend.tone)} aria-hidden="true" />
            <span className="font-medium text-foreground">{trend.text}</span>
            rispetto ai 14 giorni precedenti ({formatNumber(previousTotal)})
          </span>
        </div>

        <div className="mt-auto">
          <div className="relative h-32 pl-7" role="group" aria-label="Task completati per giorno, ultimi 14 giorni">
            {ticks.map(t => (
              <div
                key={t}
                className={cn('absolute left-7 right-0 border-t', t === 0 ? 'border-border-strong' : 'border-border/70')}
                style={{ bottom: `${(t / yMax) * 100}%` }}
              >
                <span aria-hidden="true" className="absolute -left-7 w-5 -translate-y-1/2 text-right text-2xs tabular-nums text-muted-foreground">
                  {t}
                </span>
              </div>
            ))}
            <div className="relative flex h-full items-end gap-1">
              {days.map((d, i) => {
                const today = i === days.length - 1
                const label = `${DAY_LABEL.format(parseDay(d.date))}: ${d.count} ${d.count === 1 ? 'completato' : 'completati'}`
                return (
                  <SimpleTooltip key={d.date} content={label}>
                    <div
                      tabIndex={0}
                      role="img"
                      aria-label={label}
                      className="focus-ring group flex h-full min-w-0 flex-1 items-end justify-center rounded-sm hover:bg-accent/60"
                    >
                      {d.count > 0 && (
                        <div
                          className={cn(
                            'w-full max-w-6 rounded-t-[4px] transition-colors',
                            today ? 'bg-primary' : 'bg-primary/70 group-hover:bg-primary',
                          )}
                          style={{ height: `${(d.count / yMax) * 100}%` }}
                        />
                      )}
                    </div>
                  </SimpleTooltip>
                )
              })}
            </div>
            {max === 0 && (
              <p className="absolute inset-x-0 top-1/3 pl-7 text-center text-caption text-muted-foreground">
                Nessun task completato in questo periodo
              </p>
            )}
          </div>
          <div className="mt-1.5 flex gap-1 pl-7" aria-hidden="true">
            {days.map((d, i) => (
              <span key={d.date} className="flex min-w-0 flex-1 justify-center whitespace-nowrap text-2xs text-muted-foreground">
                {i === days.length - 1 ? 'Oggi' : i % 7 === 0 ? AXIS_LABEL.format(parseDay(d.date)) : ''}
              </span>
            ))}
          </div>
        </div>

      </div>
    </DashboardCard>
  )
}
