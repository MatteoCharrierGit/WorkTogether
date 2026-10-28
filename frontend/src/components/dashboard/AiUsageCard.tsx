import { useQuery } from '@tanstack/react-query'
import { Bot } from 'lucide-react'
import { aiAdminApi } from '@/lib/api'
import { Skeleton } from '@/components/ui/skeleton'
import { DashboardCard, Meter } from './DashboardCard'

const fmt = new Intl.NumberFormat('it-IT', { notation: 'compact', maximumFractionDigits: 1 })

/** Card "Utilizzo IA" (solo admin): richieste e token degli ultimi 30 giorni, utenti più attivi. */
export function AiUsageCard({ wsId }: { wsId: string }) {
  const query = useQuery({
    queryKey: ['ai-usage', wsId, 30],
    queryFn: () => aiAdminApi.usage(wsId, 30),
    staleTime: 60_000,
  })

  // Senza dati (IA mai usata o endpoint non disponibile) la card non occupa spazio.
  if (query.isError) return null
  const data = query.data
  if (data && data.totalPeriod.requests === 0) return null

  const top = data
    ? [...data.users].filter(u => u.period.requests > 0).sort((a, b) => b.period.requests - a.period.requests).slice(0, 5)
    : []
  const max = top[0]?.period.requests || 1

  return (
    <DashboardCard
      title="Utilizzo IA"
      icon={Bot}
      description="Ultimi 30 giorni"
      link={{ to: `/workspace/${wsId}/admin?tab=ai`, label: 'Gestisci' }}
    >
      {!data ? (
        <div className="space-y-3 px-4 pb-4">
          <Skeleton className="h-8 w-24" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
        </div>
      ) : (
        <div className="space-y-4 px-4 pb-4">
          <dl className="grid grid-cols-3 gap-2">
            <Stat label="Richieste" value={fmt.format(data.totalPeriod.requests)} hint={`${data.totalToday.requests} oggi`} />
            <Stat label="Token in" value={fmt.format(data.totalPeriod.inputTokens)} />
            <Stat label="Token out" value={fmt.format(data.totalPeriod.outputTokens)} />
          </dl>
          {top.length > 0 && (
            <ul className="space-y-2.5">
              {top.map(u => (
                <li key={u.userId} className="space-y-1">
                  <div className="flex items-baseline justify-between gap-2 text-sm">
                    <span className="truncate">{u.displayName}</span>
                    <span className="shrink-0 tabular-nums text-muted-foreground">{u.period.requests}</span>
                  </div>
                  <Meter value={(u.period.requests / max) * 100} label={`Richieste di ${u.displayName}`} />
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </DashboardCard>
  )
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-md bg-surface-2 px-2.5 py-2">
      <dt className="text-caption text-muted-foreground">{label}</dt>
      <dd className="text-lg font-semibold tabular-nums">{value}</dd>
      {hint && <dd className="text-2xs text-muted-foreground">{hint}</dd>}
    </div>
  )
}
