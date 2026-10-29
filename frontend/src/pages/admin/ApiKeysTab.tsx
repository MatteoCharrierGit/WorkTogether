import { useCallback, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Copy, KeyRound, Plus, Trash2 } from 'lucide-react'
import { apiKeysApi } from '@/lib/api'
import type { ApiKey, ApiScope, CreatedApiKey } from '@/types'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { toast } from '@/components/ui/toast'
import { Callout, QueryState, useConfirm } from '@/components/shared'
import { formatDate } from '@/lib/utils'
import { ListHeader, SettingsSection, apiError } from './shared'

// Scope disponibili per le API key, raggruppati per area, con etichette leggibili.
// Nessuno scope ne implica un altro (salvo :write che include la lettura per elementi, Drive e tag).
const SCOPE_GROUPS: { title: string; options: { id: ApiScope; label: string; hint?: string }[] }[] = [
  {
    title: 'Elementi',
    options: [
      { id: 'elements:read', label: 'Leggere elementi (task, eventi, storie, epiche) e allegati' },
      { id: 'elements:write', label: 'Creare, modificare ed eliminare elementi e allegati' },
    ],
  },
  {
    title: 'Sprint',
    options: [
      { id: 'sprints:read', label: 'Leggere le sprint e i loro task' },
      {
        id: 'sprints:write',
        label: 'Aggiungere o togliere task dalle sprint',
        hint: 'Non crea, avvia, chiude né elimina sprint',
      },
    ],
  },
  {
    title: 'Membri',
    options: [
      {
        id: 'members:read',
        label: 'Vedere i membri (nome e ruolo)',
        hint: 'Serve per assegnare i task; niente email, nessuna modifica',
      },
    ],
  },
  {
    title: 'Tag',
    options: [
      { id: 'tags:read', label: 'Leggere i tag' },
      { id: 'tags:write', label: 'Gestire i tag' },
    ],
  },
  {
    title: 'Drive',
    options: [
      { id: 'drive:read', label: 'Leggere i file del Drive' },
      { id: 'drive:write', label: 'Caricare e modificare file' },
    ],
  },
]

// ─── Create API Key Dialog ────────────────────────────────────────────────────
function CreateApiKeyDialog({ wsId, open, onClose }: { wsId: string; open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [scopes, setScopes] = useState<Set<ApiScope>>(new Set())
  const [expiry, setExpiry] = useState('0') // 0 = nessuna scadenza
  const [loading, setLoading] = useState(false)
  const [created, setCreated] = useState<CreatedApiKey | null>(null)
  const [copied, setCopied] = useState(false)

  const reset = () => {
    setName(''); setScopes(new Set()); setExpiry('0'); setCreated(null); setCopied(false)
  }
  const close = () => { reset(); onClose() }

  const toggleScope = (id: ApiScope) => {
    setScopes(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const handle = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim() || scopes.size === 0) return
    setLoading(true)
    try {
      const days = Number(expiry)
      const res: CreatedApiKey = await apiKeysApi.create(wsId, {
        name: name.trim(),
        scopes: Array.from(scopes),
        expiresInDays: days > 0 ? days : null,
      })
      setCreated(res)
      queryClient.invalidateQueries({ queryKey: ['api-keys', wsId] })
    } catch (err) {
      toast(apiError(err), 'destructive')
    } finally {
      setLoading(false)
    }
  }

  const copySecret = async () => {
    if (!created) return
    try {
      await navigator.clipboard.writeText(created.secret)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast('Copia non riuscita: selezionala manualmente', 'destructive')
    }
  }

  return (
    <Dialog open={open} onOpenChange={v => !v && close()}>
      <DialogContent className="max-w-md">
        {!created ? (
          <>
            <DialogHeader>
              <DialogTitle>Nuova API key</DialogTitle>
              <DialogDescription>Scegli un nome riconoscibile e solo i permessi necessari.</DialogDescription>
            </DialogHeader>
            <form onSubmit={handle} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="key-name">Nome</Label>
                <Input id="key-name" value={name} onChange={e => setName(e.target.value)} required placeholder="Es: Bot Discord" autoFocus />
              </div>
              <fieldset className="space-y-2">
                <legend className="mb-2 text-sm font-medium">Permessi (scope)</legend>
                <div className="max-h-[45vh] divide-y overflow-y-auto rounded-md border">
                  {SCOPE_GROUPS.map(g => (
                    <div key={g.title} role="group" aria-labelledby={`scope-group-${g.title}`} className="divide-y">
                      <p id={`scope-group-${g.title}`} className="bg-muted/40 px-3 py-1.5 text-2xs font-medium uppercase tracking-wide text-muted-foreground">
                        {g.title}
                      </p>
                      {g.options.map(s => (
                        <label key={s.id} htmlFor={`scope-${s.id}`} className="flex cursor-pointer select-none items-center gap-2.5 px-3 py-2 text-sm hover:bg-accent/40">
                          <Checkbox id={`scope-${s.id}`} checked={scopes.has(s.id)} onCheckedChange={() => toggleScope(s.id)} />
                          <span className="min-w-0 flex-1">
                            {s.label}
                            {s.hint && <span className="block text-caption text-muted-foreground">{s.hint}</span>}
                          </span>
                          <code className="hidden font-mono text-2xs text-muted-foreground sm:inline">{s.id}</code>
                        </label>
                      ))}
                    </div>
                  ))}
                </div>
              </fieldset>
              {scopes.has('sprints:write') && (
                <Callout variant="warning">
                  Con <code className="font-mono">sprints:write</code> la chiave può spostare i task dentro e fuori dalle sprint, anche da quella attiva.
                </Callout>
              )}
              <div className="space-y-1.5">
                <Label>Scadenza</Label>
                <Select value={expiry} onValueChange={setExpiry}>
                  <SelectTrigger aria-label="Scadenza"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="0">Nessuna scadenza</SelectItem>
                    <SelectItem value="30">30 giorni</SelectItem>
                    <SelectItem value="90">90 giorni</SelectItem>
                    <SelectItem value="365">1 anno</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={close}>Annulla</Button>
                <Button type="submit" loading={loading} disabled={!name.trim() || scopes.size === 0}>
                  Crea chiave
                </Button>
              </DialogFooter>
            </form>
          </>
        ) : (
          <>
            <DialogHeader><DialogTitle>API key creata</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <Callout variant="warning">
                Copia ora questa chiave: per sicurezza non sarà più mostrata. Conservala in un posto sicuro.
              </Callout>
              <div className="flex items-center gap-2">
                <code className="min-w-0 flex-1 break-all rounded-md border bg-muted px-3 py-2 font-mono text-xs">
                  {created.secret}
                </code>
                <IconButton
                  variant="outline"
                  size="default"
                  label={copied ? 'Copiata' : 'Copia chiave'}
                  icon={copied ? <Check className="text-success" /> : <Copy />}
                  onClick={copySecret}
                />
              </div>
              <p className="text-caption text-muted-foreground">
                Usala nell&apos;header HTTP: <code className="font-mono">Authorization: Bearer {created.key.prefix}…</code>
              </p>
              <DialogFooter>
                <Button type="button" onClick={close}>Fatto</Button>
              </DialogFooter>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

const COLS = 'md:grid-cols-[minmax(0,1.3fr)_minmax(0,1.5fr)_7.5rem_2rem]'

export function ApiKeysTab({ wsId }: { wsId: string }) {
  const queryClient = useQueryClient()
  const confirm = useConfirm()
  const [createOpen, setCreateOpen] = useState(false)

  const keysQuery = useQuery<ApiKey[]>({
    queryKey: ['api-keys', wsId],
    queryFn: () => apiKeysApi.list(wsId),
    enabled: !!wsId,
  })

  const deleteApiKey = useCallback(async (k: ApiKey) => {
    const ok = await confirm({
      title: `Revocare la chiave "${k.name}"?`,
      description: 'Le integrazioni che la usano smetteranno di funzionare.',
      confirmLabel: 'Revoca',
      destructive: true,
    })
    if (!ok) return
    try {
      await apiKeysApi.delete(wsId, k.id)
      queryClient.invalidateQueries({ queryKey: ['api-keys', wsId] })
      toast('API key revocata')
    } catch (err) {
      toast(apiError(err), 'destructive')
    }
  }, [wsId, queryClient, confirm])

  return (
    <SettingsSection
      icon={KeyRound}
      title="API key"
      description="Chiavi per collegare servizi esterni (es. un bot Discord). Ogni chiave ha permessi limitati, agisce solo su questo workspace e il segreto è mostrato una sola volta."
      actions={
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="h-3.5 w-3.5" /> Nuova API key
        </Button>
      }
    >
      <QueryState
        query={keysQuery}
        skeleton="table"
        rows={3}
        empty={{
          icon: KeyRound,
          title: 'Nessuna API key',
          description: 'Creane una per collegare un servizio esterno.',
          size: 'sm',
          bordered: true,
        }}
      >
        {(keys: ApiKey[]) => (
          <div role="table" aria-label="API key" className="overflow-hidden rounded-md border">
            <ListHeader className={COLS}>
              <span>Nome</span>
              <span>Permessi</span>
              <span>Ultimo uso</span>
              <span className="sr-only">Azioni</span>
            </ListHeader>
            <div className="divide-y">
              {keys.map(k => {
                const expired = !!k.expiresAt && new Date(k.expiresAt).getTime() < Date.now()
                return (
                  <div key={k.id} role="row" className={`grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 gap-y-2 px-3 py-3 md:items-center md:gap-4 md:px-4 ${COLS}`}>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="truncate text-sm font-medium">{k.name}</span>
                        {expired && <Badge variant="destructive" size="sm">Scaduta</Badge>}
                      </div>
                      <code className="font-mono text-2xs text-muted-foreground">{k.prefix}…</code>
                    </div>
                    <div className="col-span-2 row-start-2 flex flex-wrap gap-1 md:col-span-1 md:row-start-auto">
                      {k.scopes.map(s => (
                        <code key={s} className="rounded bg-muted px-1.5 py-0.5 font-mono text-2xs">{s}</code>
                      ))}
                    </div>
                    <div className="col-span-2 row-start-3 text-caption text-muted-foreground md:col-span-1 md:row-start-auto">
                      <span className="md:hidden">Ultimo uso: </span>
                      {k.lastUsedAt ? formatDate(k.lastUsedAt) : 'mai'}
                      {k.expiresAt && (
                        <span className="md:block">
                          <span className="md:hidden"> · </span>Scade: {formatDate(k.expiresAt)}
                        </span>
                      )}
                    </div>
                    <div className="col-start-2 row-start-1 md:col-start-auto md:row-start-auto">
                      <IconButton
                        size="xs"
                        label={`Revoca ${k.name}`}
                        icon={<Trash2 />}
                        className="hover:text-destructive"
                        onClick={() => deleteApiKey(k)}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </QueryState>
      <CreateApiKeyDialog wsId={wsId} open={createOpen} onClose={() => setCreateOpen(false)} />
    </SettingsSection>
  )
}
