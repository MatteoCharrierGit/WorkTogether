import { Circle, CircleCheck, CircleDot, Clock, TriangleAlert, type LucideIcon } from 'lucide-react'
import type { DashboardData } from '@/types'
import { cn } from '@/lib/utils'
import { formatNumber } from './DashboardCard'

interface Tile {
  key: string
  label: string
  value: number
  icon: LucideIcon
  /** Colore dell'icona (token di stato); il numero resta sempre in inchiostro primario. */
  tone: string
  /** Evidenzia il riquadro quando il valore richiede attenzione. */
  alert?: boolean
  hint?: string
}

/** Riga di KPI: Da fare, In corso, Completati, Scaduti, Bloccati. */
export function StatTiles({ data }: { data: DashboardData }) {
  const c = data.counts
  const tiles: Tile[] = [
    {
      key: 'todo', label: 'Da fare', value: c.todo, icon: Circle, tone: 'text-muted-foreground',
      hint: c.unassigned > 0 ? `${formatNumber(c.unassigned)} senza assegnatario` : 'Tutti assegnati',
    },
    {
      key: 'progress', label: 'In corso', value: c.inProgress, icon: CircleDot, tone: 'text-info',
      hint: c.dueThisWeek > 0 ? `${formatNumber(c.dueThisWeek)} in scadenza questa settimana` : 'Nessuna scadenza a breve',
    },
    {
      key: 'done', label: 'Completati', value: c.done, icon: CircleCheck, tone: 'text-success',
      hint: `${formatNumber(data.throughput.total)} negli ultimi 14 giorni`,
    },
    {
      key: 'overdue', label: 'Scaduti', value: c.overdue, icon: Clock,
      tone: c.overdue > 0 ? 'text-destructive' : 'text-muted-foreground', alert: c.overdue > 0,
      hint: c.overdue > 0 ? 'Task aperti oltre la scadenza' : 'Nessun ritardo',
    },
    {
      key: 'blocked', label: 'Bloccati', value: c.blocked, icon: TriangleAlert,
      tone: c.blocked > 0 ? 'text-warning' : 'text-muted-foreground', alert: c.blocked > 0,
      hint: c.blocked > 0 ? 'Segnalati come bloccanti' : 'Nessun blocco',
    },
  ]
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5" aria-label="Indicatori dei task">
      {tiles.map((t, i) => (
        <li
          key={t.key}
          className={cn(
            'flex min-w-0 flex-col gap-1 rounded-lg border bg-card p-3 shadow-xs sm:p-4',
            // 5 riquadri su 2/3 colonne: l'ultimo riempie la riga.
            i === tiles.length - 1 && 'col-span-2 lg:col-span-1',
          )}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-caption font-medium text-muted-foreground">{t.label}</span>
            <t.icon className={cn('h-4 w-4 shrink-0', t.tone)} aria-hidden="true" />
          </div>
          <span className="text-display">{formatNumber(t.value)}</span>
          {t.hint && (
            <span className={cn('line-clamp-2 text-caption sm:line-clamp-1', t.alert ? 'text-foreground/80' : 'text-muted-foreground')} title={t.hint}>
              {t.hint}
            </span>
          )}
        </li>
      ))}
    </ul>
  )
}
