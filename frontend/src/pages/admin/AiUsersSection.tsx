import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { BarChart3, Users } from 'lucide-react'
import { aiAdminApi } from '@/lib/api'
import type { AiModelCatalog, AiProvider, AiUsageReport, AiUsageTotals, AiUserRow } from '@/types'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { toast } from '@/components/ui/toast'
import { QueryState } from '@/components/shared'
import { ListHeader, ROLE_LABELS, SettingsSection, apiError } from './shared'
import type { WorkspaceRole } from '@/types'

const DEFAULT = '__default__'

const fmt = new Intl.NumberFormat('it-IT')
const compact = new Intl.NumberFormat('it-IT', { notation: 'compact', maximumFractionDigits: 1 })

function tokens(t: AiUsageTotals) {
  return compact.format(t.inputTokens + t.outputTokens)
}

function ListSkeleton() {
  return (
    <div className="space-y-2 p-4" aria-busy="true">
      {[0, 1, 2].map(i => <Skeleton key={i} className="h-10 w-full" />)}
    </div>
  )
}

/**
 * Admin → Agente AI: "Modelli per utente" (modello assegnato + override limiti, l'utente non può cambiarli)
 * e riepilogo consumi (oggi / ultimi 30 giorni).
 */
export function AiUsersSection({ wsId, provider }: { wsId: string; provider: AiProvider }) {
  const usersQuery = useQuery<AiUserRow[]>({
    queryKey: ['ai-users', wsId],
    queryFn: () => aiAdminApi.users(wsId, 30),
    enabled: !!wsId,
  })
  const catalogQuery = useQuery<AiModelCatalog>({
    queryKey: ['ai-models', wsId, provider],
    queryFn: () => aiAdminApi.models(wsId, provider),
    enabled: !!wsId,
    staleTime: 1000 * 60 * 10,
    retry: false,
  })
  const usageQuery = useQuery<AiUsageReport>({
    queryKey: ['ai-usage', wsId, 30],
    queryFn: () => aiAdminApi.usage(wsId, 30),
    enabled: !!wsId,
  })
  const models = catalogQuery.data?.models ?? []

  return (
    <>
      <SettingsSection
        icon={Users}
        title="Modelli per utente"
        description="Assegna un modello a singoli membri: ha la precedenza sul predefinito del workspace e l'utente non può cambiarlo. I limiti vuoti usano quelli del workspace."
        contentClassName="p-0"
      >
        <QueryState
          query={usersQuery}
          loading={<ListSkeleton />}
          errorTitle="Impossibile caricare i membri"
          isEmpty={(usersQuery.data ?? []).length === 0}
          empty={<p className="p-4 text-caption text-muted-foreground">Nessun membro.</p>}
        >
          <div role="table" aria-label="Modelli e limiti per utente">
            <ListHeader className="md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_6rem_6rem]">
              <span>Membro · consumo</span><span>Modello</span><span>Rich./min</span><span>Rich./giorno</span>
            </ListHeader>
            <div className="divide-y">
              {(usersQuery.data ?? []).map(row => (
                <UserRowItem key={row.userId} wsId={wsId} row={row} provider={provider} models={models} />
              ))}
            </div>
          </div>
        </QueryState>
      </SettingsSection>

      <SettingsSection
        icon={BarChart3}
        title="Consumi"
        description="Richieste e token per giorno (fuso Europe/Rome). Le automazioni sono conteggiate a parte."
      >
        <QueryState query={usageQuery} loading={<Skeleton className="h-16 w-full" />} errorTitle="Impossibile caricare i consumi">
          {usageQuery.data && (
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="Richieste oggi" value={fmt.format(usageQuery.data.totalToday.requests)} />
              <Stat label="Token oggi" value={tokens(usageQuery.data.totalToday)} />
              <Stat label="Richieste 30 gg" value={fmt.format(usageQuery.data.totalPeriod.requests)} />
              <Stat label="Token 30 gg" value={tokens(usageQuery.data.totalPeriod)} hint={`di cui automazioni: ${tokens(usageQuery.data.automationsPeriod)}`} />
            </dl>
          )}
        </QueryState>
      </SettingsSection>
    </>
  )
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-md border bg-surface-2 px-3 py-2">
      <dt className="text-2xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="text-heading tabular-nums">{value}</dd>
      {hint && <dd className="text-2xs text-muted-foreground">{hint}</dd>}
    </div>
  )
}

function UserRowItem({ wsId, row, provider, models }: {
  wsId: string; row: AiUserRow; provider: AiProvider; models: { id: string; name: string }[]
}) {
  const queryClient = useQueryClient()
  const assigned = (provider === 'ANTHROPIC' ? row.anthropicModel : row.openrouterModel) ?? null
  const [rpm, setRpm] = useState(row.ratePerMinute?.toString() ?? '')
  const [rpd, setRpd] = useState(row.ratePerDay?.toString() ?? '')
  const [saving, setSaving] = useState(false)

  useEffect(() => { setRpm(row.ratePerMinute?.toString() ?? ''); setRpd(row.ratePerDay?.toString() ?? '') }, [row.ratePerMinute, row.ratePerDay])

  const save = async (patch: Partial<{ model: string | null; rpm: string; rpd: string }>) => {
    const model = patch.model !== undefined ? patch.model : assigned
    const toNum = (v: string) => (v.trim() === '' || !Number.isFinite(Number(v)) ? null : Math.max(1, Math.round(Number(v))))
    setSaving(true)
    try {
      const updated = await aiAdminApi.updateUser(wsId, row.userId, {
        openrouterModel: provider === 'OPENROUTER' ? model : row.openrouterModel ?? null,
        anthropicModel: provider === 'ANTHROPIC' ? model : row.anthropicModel ?? null,
        ratePerMinute: toNum(patch.rpm ?? rpm),
        ratePerDay: toNum(patch.rpd ?? rpd),
      })
      queryClient.setQueryData<AiUserRow[]>(['ai-users', wsId], list => list?.map(r => (r.userId === updated.userId ? updated : r)))
      toast(`Impostazioni di ${row.displayName} salvate`)
    } catch (err) {
      toast(apiError(err, 'Salvataggio non riuscito'), 'destructive')
    } finally {
      setSaving(false)
    }
  }

  // Il modello assegnato può non comparire nell'elenco (es. elenco di riserva): lo aggiungo.
  const options = assigned && !models.some(m => m.id === assigned) ? [{ id: assigned, name: assigned }, ...models] : models
  const defaultLimits = row.effectiveLimits

  return (
    <div
      role="row"
      className="grid grid-cols-2 gap-3 px-4 py-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_6rem_6rem] md:items-center md:gap-4"
      aria-busy={saving || undefined}
    >
      <div role="cell" className="col-span-2 min-w-0 md:col-span-1">
        <p className="truncate text-body font-medium">{row.displayName}</p>
        <div className="flex min-w-0 items-center gap-1.5 text-caption text-muted-foreground">
          <Badge variant="muted" size="sm">{ROLE_LABELS[row.role as WorkspaceRole] ?? row.role}</Badge>
          <span className="truncate">{row.email}</span>
        </div>
        <p className="mt-1 text-2xs tabular-nums text-muted-foreground">
          Oggi <span className="text-foreground">{row.usageToday.requests}</span>/{defaultLimits.perDay} rich. · {tokens(row.usageToday)} token
          {' · '}30 gg {fmt.format(row.usagePeriod.requests)} rich. · {tokens(row.usagePeriod)} token
        </p>
      </div>
      <div role="cell" className="col-span-2 min-w-0 md:col-span-1">
        <Select value={assigned ?? DEFAULT} onValueChange={v => save({ model: v === DEFAULT ? null : v })} disabled={saving}>
          <SelectTrigger aria-label={`Modello di ${row.displayName}`}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={DEFAULT}>Predefinito del workspace</SelectItem>
            {options.map(m => <SelectItem key={m.id} value={m.id}>{m.name !== m.id ? `${m.name} · ${m.id}` : m.id}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div role="cell">
        <Input
          type="number"
          inputMode="numeric"
          min={1}
          aria-label={`Richieste al minuto di ${row.displayName}`}
          placeholder={`${defaultLimits.perMinute} (ws)`}
          value={rpm}
          onChange={e => setRpm(e.target.value)}
          onBlur={() => { if (rpm !== (row.ratePerMinute?.toString() ?? '')) save({ rpm }) }}
          disabled={saving}
        />
      </div>
      <div role="cell">
        <Input
          type="number"
          inputMode="numeric"
          min={1}
          aria-label={`Richieste al giorno di ${row.displayName}`}
          placeholder={`${defaultLimits.perDay} (ws)`}
          value={rpd}
          onChange={e => setRpd(e.target.value)}
          onBlur={() => { if (rpd !== (row.ratePerDay?.toString() ?? '')) save({ rpd }) }}
          disabled={saving}
        />
      </div>
    </div>
  )
}
