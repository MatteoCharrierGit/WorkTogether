import { lazy, Suspense, useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Bot, FileText, Gauge, Plug, Save, SlidersHorizontal } from 'lucide-react'
import { aiApi, aiAdminApi } from '@/lib/api'
import type { AiAutonomy, AiMemoryMode, AiModelCatalog, AiProvider, AiSettings, AiTestResult } from '@/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Skeleton } from '@/components/ui/skeleton'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { toast } from '@/components/ui/toast'
import { QueryState } from '@/components/shared'
import { SettingRow, SettingsSection, apiError } from './shared'
import { AiUsersSection } from './AiUsersSection'

const PROVIDER_LABELS: Record<AiProvider, string> = { OPENROUTER: 'OpenRouter', ANTHROPIC: 'Anthropic (Claude)' }

// CodeMirror resta in un chunk separato: si scarica solo aprendo questa scheda.
const CodeEditor = lazy(() => import('@/components/editor/CodeEditor'))

function MdEditorBox({ label, hint, value, onChange }: {
  label: string; hint?: string; value: string; onChange: (v: string) => void
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {hint && <p className="text-caption text-muted-foreground">{hint}</p>}
      <div className="h-52 overflow-hidden rounded-md border">
        <Suspense fallback={<Skeleton className="h-full w-full rounded-none" />}>
          <CodeEditor value={value} onChange={onChange} language="markdown" />
        </Suspense>
      </div>
    </div>
  )
}

function NumberField({ id, label, value, onChange, ...rest }: {
  id: string; label: string; value: number; onChange: (v: string) => void
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'id'>) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-caption">{label}</Label>
      <Input id={id} type="number" inputMode="decimal" value={value} onChange={e => onChange(e.target.value)} {...rest} />
    </div>
  )
}

function AiSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true">
      {[0, 1, 2].map(i => (
        <div key={i} className="space-y-3 rounded-lg border p-5">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-3 w-2/3" />
          <Skeleton className="h-9 w-full" />
        </div>
      ))}
    </div>
  )
}

export function AiTab({ wsId }: { wsId: string }) {
  const queryClient = useQueryClient()
  const settingsQuery = useQuery<AiSettings>({
    queryKey: ['ai-settings', wsId],
    queryFn: () => aiApi.getSettings(wsId),
    enabled: !!wsId,
  })
  const settings = settingsQuery.data
  const [form, setForm] = useState<AiSettings | null>(null)
  const [newKey, setNewKey] = useState('')
  const [newAnthropicKey, setNewAnthropicKey] = useState('')
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)

  const provider: AiProvider = form?.provider ?? settings?.provider ?? 'OPENROUTER'
  const catalogQuery = useQuery<AiModelCatalog>({
    queryKey: ['ai-models', wsId, provider],
    queryFn: () => aiAdminApi.models(wsId, provider),
    enabled: !!wsId && !!settings,
    staleTime: 1000 * 60 * 10,
    retry: false,
  })
  const models = catalogQuery.data?.models ?? []

  useEffect(() => { if (settings) setForm(settings) }, [settings])

  if (settingsQuery.isError || !form) {
    return (
      <QueryState query={settingsQuery} loading={<AiSkeleton />} errorTitle="Impossibile caricare le impostazioni AI">
        <AiSkeleton />
      </QueryState>
    )
  }

  const set = (patch: Partial<AiSettings>) => setForm(f => f ? { ...f, ...patch } : f)

  const save = async () => {
    setSaving(true)
    try {
      const payload: Record<string, unknown> = {
        enabled: form.enabled, model: form.model, temperature: form.temperature,
        maxTokens: form.maxTokens, contextWindowTokens: form.contextWindowTokens,
        compactThresholdPct: form.compactThresholdPct, autonomy: form.autonomy,
        memoryMode: form.memoryMode, maxToolIterations: form.maxToolIterations,
        personalityMd: form.personalityMd, memoryMd: form.memoryMd, toolsMd: form.toolsMd,
        provider: form.provider, anthropicModel: form.anthropicModel,
        ratePerMinute: form.ratePerMinute, ratePerDay: form.ratePerDay,
        maxConcurrent: form.maxConcurrent, automationDailyCap: form.automationDailyCap,
      }
      if (newKey.trim()) payload.apiKey = newKey.trim()
      if (newAnthropicKey.trim()) payload.anthropicApiKey = newAnthropicKey.trim()
      const updated: AiSettings = await aiApi.updateSettings(wsId, payload)
      queryClient.setQueryData(['ai-settings', wsId], updated)
      setForm(updated); setNewKey(''); setNewAnthropicKey('')
      // Provider/chiave/modello possono cambiare elenco modelli, assegnazioni e vista "me".
      queryClient.invalidateQueries({ queryKey: ['ai-models', wsId] })
      queryClient.invalidateQueries({ queryKey: ['ai-users', wsId] })
      queryClient.invalidateQueries({ queryKey: ['ai-me', wsId] })
      toast('Impostazioni salvate')
    } catch (err) {
      toast(apiError(err), 'destructive')
    } finally {
      setSaving(false)
    }
  }

  const test = async () => {
    setTesting(true)
    try {
      const typed = provider === 'ANTHROPIC' ? newAnthropicKey.trim() : newKey.trim()
      const res: AiTestResult = await aiAdminApi.test(wsId, provider, typed || undefined)
      toast(res.message, res.ok ? undefined : 'destructive')
    } catch {
      toast('Errore nel test di connessione', 'destructive')
    } finally {
      setTesting(false)
    }
  }

  const num = (v: string, fallback: number) => {
    const n = Number(v)
    return Number.isFinite(n) ? n : fallback
  }

  return (
    <div className="space-y-6">
      <SettingsSection icon={Bot} title="Agente AI" description="Akari risponde nella chat del workspace e può agire su task ed eventi.">
        <SettingRow htmlFor="ai-enabled" label="Abilita l'agente AI in questo workspace">
          <Switch id="ai-enabled" checked={form.enabled} onCheckedChange={v => set({ enabled: v })} />
        </SettingRow>
      </SettingsSection>

      <SettingsSection
        icon={Plug}
        title="Provider e connessione"
        description="Le chiavi sono salvate cifrate e non vengono mai mostrate in chiaro. Ogni provider ha la sua chiave e il suo modello predefinito."
        contentClassName="space-y-4"
      >
        <div className="space-y-1.5">
          <Label className="text-caption">Provider attivo</Label>
          <Select value={provider} onValueChange={v => set({ provider: v as AiProvider })}>
            <SelectTrigger aria-label="Provider attivo" className="sm:max-w-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="OPENROUTER">{PROVIDER_LABELS.OPENROUTER}</SelectItem>
              <SelectItem value="ANTHROPIC">{PROVIDER_LABELS.ANTHROPIC}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {provider === 'ANTHROPIC' ? (
          <div className="space-y-1.5">
            <Label htmlFor="ai-key-anthropic">Chiave API Anthropic</Label>
            <Input
              id="ai-key-anthropic"
              type="password"
              autoComplete="off"
              value={newAnthropicKey}
              onChange={e => setNewAnthropicKey(e.target.value)}
              placeholder={form.anthropicApiKeySet ? `Configurata (${form.anthropicApiKeyPreview}). Inserisci per sostituirla` : 'sk-ant-...'}
            />
          </div>
        ) : (
          <div className="space-y-1.5">
            <Label htmlFor="ai-key">Chiave API OpenRouter</Label>
            <Input
              id="ai-key"
              type="password"
              autoComplete="off"
              value={newKey}
              onChange={e => setNewKey(e.target.value)}
              placeholder={form.apiKeySet ? `Configurata (${form.apiKeyPreview}). Inserisci per sostituirla` : 'sk-or-...'}
            />
          </div>
        )}

        <div className="space-y-1.5">
          <Label htmlFor="ai-model">Modello predefinito del workspace</Label>
          <Input
            id="ai-model"
            list="ai-models-list"
            value={provider === 'ANTHROPIC' ? form.anthropicModel : form.model}
            onChange={e => set(provider === 'ANTHROPIC' ? { anthropicModel: e.target.value } : { model: e.target.value })}
            placeholder={provider === 'ANTHROPIC' ? 'claude-opus-5-5' : 'openai/gpt-4o-mini'}
          />
          <datalist id="ai-models-list">
            {models.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
          </datalist>
          <p className="text-caption text-muted-foreground">
            {catalogQuery.isLoading
              ? 'Caricamento modelli…'
              : catalogQuery.data?.live
                ? `${models.length} modelli disponibili — scrivi per filtrare o incolla un id.`
                : `Elenco di riserva (${catalogQuery.data?.error || 'provider non raggiungibile'}). Puoi comunque scrivere un id.`}
            {' '}Si può assegnare un modello diverso ai singoli membri qui sotto.
          </p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={test} loading={testing}>
          {!testing && <Plug className="h-3.5 w-3.5" />} Testa connessione {PROVIDER_LABELS[provider]}
        </Button>
      </SettingsSection>

      <SettingsSection
        icon={Gauge}
        title="Limiti d'uso"
        description="Valgono per ogni membro (sovrascrivibili per utente). Oltre il limite Akari risponde con un avviso e l'invio resta bloccato fino allo scadere."
        contentClassName="space-y-3"
      >
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <NumberField id="ai-rpm" label="Richieste al minuto" min="1" max="600" value={form.ratePerMinute} onChange={v => set({ ratePerMinute: num(v, form.ratePerMinute) })} />
          <NumberField id="ai-rpd" label="Richieste al giorno" min="1" value={form.ratePerDay} onChange={v => set({ ratePerDay: num(v, form.ratePerDay) })} />
          <NumberField id="ai-conc" label="Generazioni in parallelo" min="1" max="10" value={form.maxConcurrent} onChange={v => set({ maxConcurrent: num(v, form.maxConcurrent) })} />
          <NumberField id="ai-auto" label="Automazioni IA al giorno" min="0" max="1000" value={form.automationDailyCap} onChange={v => set({ automationDailyCap: num(v, form.automationDailyCap) })} />
        </div>
        <p className="text-caption text-muted-foreground">
          Le automazioni (recap del venerdì, digest del lunedì) non consumano i limiti dei membri ma hanno un tetto giornaliero per workspace.
        </p>
      </SettingsSection>

      <SettingsSection icon={SlidersHorizontal} title="Comportamento" description="Quanto può fare l'agente e come gestisce contesto e memoria." contentClassName="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label className="text-caption">Autonomia</Label>
            <Select value={form.autonomy} onValueChange={v => set({ autonomy: v as AiAutonomy })}>
              <SelectTrigger aria-label="Autonomia"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="READ_ONLY">Sola lettura + proposte</SelectItem>
                <SelectItem value="CONFIRM_DESTRUCTIVE">Conferma per eliminare</SelectItem>
                <SelectItem value="FULL">Pieno controllo</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-caption">Memoria</Label>
            <Select value={form.memoryMode} onValueChange={v => set({ memoryMode: v as AiMemoryMode })}>
              <SelectTrigger aria-label="Memoria"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="AUTO_AND_ADMIN">Auto-evolutiva + admin</SelectItem>
                <SelectItem value="ADMIN_ONLY">Solo admin</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <NumberField id="ai-temp" label={provider === 'ANTHROPIC' ? 'Temperatura (solo OpenRouter)' : 'Temperatura'} step="0.1" min="0" max="2" value={form.temperature} onChange={v => set({ temperature: num(v, form.temperature) })} />
          <NumberField id="ai-maxtok" label="Max token risposta" min="1" value={form.maxTokens} onChange={v => set({ maxTokens: num(v, form.maxTokens) })} />
          <NumberField id="ai-ctx" label="Finestra contesto" min="1000" value={form.contextWindowTokens} onChange={v => set({ contextWindowTokens: num(v, form.contextWindowTokens) })} />
          <NumberField id="ai-compact" label="Soglia compacting (%)" min="10" max="95" value={form.compactThresholdPct} onChange={v => set({ compactThresholdPct: num(v, form.compactThresholdPct) })} />
          <NumberField id="ai-iter" label="Max passi tool/turno" min="1" max="20" value={form.maxToolIterations} onChange={v => set({ maxToolIterations: num(v, form.maxToolIterations) })} />
        </div>
      </SettingsSection>

      <AiUsersSection wsId={wsId} provider={settings?.provider ?? 'OPENROUTER'} />

      <SettingsSection icon={FileText} title="File dell'agente" description="Istruzioni in markdown lette dall'agente a ogni conversazione." contentClassName="space-y-5">
        <MdEditorBox label="Personalità (personality.md)" hint="Chi è l'agente e come si comporta. Supporta {{workspaceName}}, {{userName}}, {{today}}." value={form.personalityMd} onChange={v => set({ personalityMd: v })} />
        <MdEditorBox label="Memoria (memory.md)" hint="Fatti durevoli condivisi nel workspace. In modalità auto-evolutiva l'agente può aggiungerne." value={form.memoryMd} onChange={v => set({ memoryMd: v })} />
        <MdEditorBox label="Tool / policy (tools.md)" hint="Quali tool abilitare e regole d'uso (es. 'non creare epiche senza conferma')." value={form.toolsMd} onChange={v => set({ toolsMd: v })} />
      </SettingsSection>

      <div className="sticky bottom-0 z-sticky -mx-4 flex justify-end border-t bg-background/90 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-lg sm:border sm:px-4">
        <Button onClick={save} loading={saving}>
          {!saving && <Save className="h-4 w-4" />} Salva impostazioni
        </Button>
      </div>
    </div>
  )
}
