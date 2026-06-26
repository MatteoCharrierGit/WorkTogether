import { useEffect, useRef, useState } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { workspacesApi, tagsApi, usersApi, apiKeysApi, aiApi, channelsApi, invitationsApi } from '@/lib/api'
import { Member, Tag, Workspace, WorkspaceRole, ApiKey, CreatedApiKey, ApiScope, AiSettings, AiAutonomy, AiMemoryMode, AiTestResult, Channel, Invitation } from '@/types'
import { CodeEditor } from '@/components/editor/CodeEditor'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { UserAvatar } from '@/components/UserAvatar'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { getInitials, resizeImageToDataUrl, formatDate, cn } from '@/lib/utils'
import { toast } from '@/components/ui/toast'
import { useWorkspaceStore } from '@/store/workspaceStore'
import { useAuthStore } from '@/store/authStore'
import { Plus, Trash2, Edit2, Users, Tag as TagIcon, UserPlus, Building2, Image as ImageIcon, Camera, KeyRound, Copy, Check, AlertTriangle, Bot, Save, Plug, Mail, Hash, Lock, DatabaseBackup, Download, Upload } from 'lucide-react'

// Scope disponibili per le API key, con etichette leggibili.
const SCOPE_OPTIONS: { id: ApiScope; label: string }[] = [
  { id: 'elements:read', label: 'Leggere elementi (task, eventi, storie)' },
  { id: 'elements:write', label: 'Creare e modificare elementi' },
  { id: 'drive:read', label: 'Leggere i file del Drive' },
  { id: 'drive:write', label: 'Caricare e modificare file' },
  { id: 'tags:read', label: 'Leggere i tag' },
  { id: 'tags:write', label: 'Gestire i tag' },
]

const ROLE_LABELS: Record<WorkspaceRole, string> = {
  ADMIN: 'Admin',
  COLLABORATORE: 'Collaboratore',
  GUEST: 'Guest',
}

// ─── Create User Dialog ───────────────────────────────────────────────────────
function CreateUserDialog({ wsId, open, onClose }: { wsId: string; open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient()
  const [displayName, setDisplayName] = useState('')
  const [role, setRole] = useState<WorkspaceRole>('COLLABORATORE')
  // Opzionale: l'admin può preimpostare email + password temporanea. Altrimenti l'utente
  // le imposta al primo accesso (onboarding con verifica email).
  const [manualCreds, setManualCreds] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)

  const reset = () => {
    setDisplayName(''); setRole('COLLABORATORE'); setManualCreds(false); setEmail(''); setPassword('')
  }

  const handle = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    try {
      await workspacesApi.createUser(wsId, {
        displayName,
        role,
        email: manualCreds && email ? email : undefined,
        temporaryPassword: manualCreds && password ? password : undefined,
      })
      queryClient.invalidateQueries({ queryKey: ['members', wsId] })
      toast(manualCreds
        ? 'Utente creato. Dovrà cambiare la password al primo accesso.'
        : 'Utente creato. Al primo accesso imposterà email e password.')
      onClose()
      reset()
    } catch (err: any) {
      toast(err.response?.data?.error ?? 'Errore', 'destructive')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Nuovo utente</DialogTitle></DialogHeader>
        <form onSubmit={handle} className="space-y-4">
          <div className="space-y-1.5">
            <Label>Username</Label>
            <Input value={displayName} onChange={e => setDisplayName(e.target.value)} required placeholder="mario.rossi" />
            <p className="text-xs text-muted-foreground">
              È l&apos;identificativo di accesso. L&apos;utente completerà email e password al primo login.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label>Ruolo</Label>
            <Select value={role} onValueChange={v => setRole(v as WorkspaceRole)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ADMIN">Admin</SelectItem>
                <SelectItem value="COLLABORATORE">Collaboratore</SelectItem>
                <SelectItem value="GUEST">Guest (solo lettura)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
            <input type="checkbox" checked={manualCreds} onChange={e => setManualCreds(e.target.checked)} />
            Imposta manualmente email e password temporanea
          </label>
          {manualCreds && (
            <div className="space-y-3 rounded-md border p-3">
              <div className="space-y-1.5">
                <Label>Email</Label>
                <Input type="email" value={email} onChange={e => setEmail(e.target.value)} required={manualCreds} placeholder="mario@esempio.it" />
              </div>
              <div className="space-y-1.5">
                <Label>Password temporanea</Label>
                <Input type="password" value={password} onChange={e => setPassword(e.target.value)} required={manualCreds} minLength={8} placeholder="Min. 8 caratteri" />
              </div>
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>Annulla</Button>
            <Button type="submit" disabled={loading}>{loading ? 'Creazione...' : 'Crea utente'}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ─── Invite Member Dialog ─────────────────────────────────────────────────────
function InviteMemberDialog({ wsId, open, onClose }: { wsId: string; open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient()
  const [identifier, setIdentifier] = useState('')
  const [role, setRole] = useState<WorkspaceRole>('COLLABORATORE')
  const [loading, setLoading] = useState(false)

  const handle = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    try {
      await invitationsApi.create(wsId, identifier.trim(), role)
      queryClient.invalidateQueries({ queryKey: ['invitations', wsId] })
      toast('Invito inviato via email.')
      onClose()
      setIdentifier(''); setRole('COLLABORATORE')
    } catch (err: any) {
      toast(err.response?.data?.error ?? 'Errore', 'destructive')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Invita un utente</DialogTitle></DialogHeader>
        <form onSubmit={handle} className="space-y-4">
          <div className="space-y-1.5">
            <Label>Username o email</Label>
            <Input value={identifier} onChange={e => setIdentifier(e.target.value)} required placeholder="mario.rossi o mario@esempio.it" />
            <p className="text-xs text-muted-foreground">
              Riceverà un&apos;email con un link per accettare l&apos;invito.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label>Ruolo</Label>
            <Select value={role} onValueChange={v => setRole(v as WorkspaceRole)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ADMIN">Admin</SelectItem>
                <SelectItem value="COLLABORATORE">Collaboratore</SelectItem>
                <SelectItem value="GUEST">Guest (solo lettura)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>Annulla</Button>
            <Button type="submit" disabled={loading}>{loading ? 'Invio...' : 'Invia invito'}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ─── Create Tag Dialog ───────────────────────────────────────────────────────
function CreateTagDialog({ wsId, open, onClose }: { wsId: string; open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [color, setColor] = useState('#6366f1')
  const [loading, setLoading] = useState(false)

  const handle = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    try {
      await tagsApi.create(wsId, { name, color })
      queryClient.invalidateQueries({ queryKey: ['tags', wsId] })
      toast('Tag creato')
      onClose()
      setName(''); setColor('#6366f1')
    } catch (err: any) {
      toast(err.response?.data?.error ?? 'Errore', 'destructive')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Nuovo tag</DialogTitle></DialogHeader>
        <form onSubmit={handle} className="space-y-4">
          <div className="space-y-1.5">
            <Label>Nome</Label>
            <Input value={name} onChange={e => setName(e.target.value)} required placeholder="Es: Urgente" />
          </div>
          <div className="space-y-1.5">
            <Label>Colore</Label>
            <div className="flex items-center gap-3">
              <input type="color" value={color} onChange={e => setColor(e.target.value)} className="h-9 w-14 rounded-md cursor-pointer border border-input" />
              <span className="text-sm text-muted-foreground font-mono">{color}</span>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>Annulla</Button>
            <Button type="submit" disabled={loading}>{loading ? '...' : 'Crea'}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

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
    } catch (err: any) {
      toast(err.response?.data?.error ?? 'Errore', 'destructive')
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
            <DialogHeader><DialogTitle>Nuova API key</DialogTitle></DialogHeader>
            <form onSubmit={handle} className="space-y-4">
              <div className="space-y-1.5">
                <Label>Nome</Label>
                <Input value={name} onChange={e => setName(e.target.value)} required placeholder="Es: Bot Discord" autoFocus />
              </div>
              <div className="space-y-2">
                <Label>Permessi (scope)</Label>
                <div className="space-y-1.5 rounded-lg border p-3">
                  {SCOPE_OPTIONS.map(s => (
                    <label key={s.id} className="flex items-center gap-2.5 text-sm cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={scopes.has(s.id)}
                        onChange={() => toggleScope(s.id)}
                        className="h-4 w-4 rounded border-input"
                      />
                      <span className="flex-1">{s.label}</span>
                      <code className="text-[11px] text-muted-foreground">{s.id}</code>
                    </label>
                  ))}
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Scadenza</Label>
                <Select value={expiry} onValueChange={setExpiry}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="0">Nessuna scadenza</SelectItem>
                    <SelectItem value="30">30 giorni</SelectItem>
                    <SelectItem value="90">90 giorni</SelectItem>
                    <SelectItem value="365">1 anno</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={close}>Annulla</Button>
                <Button type="submit" disabled={loading || !name.trim() || scopes.size === 0}>
                  {loading ? 'Creazione...' : 'Crea chiave'}
                </Button>
              </div>
            </form>
          </>
        ) : (
          <>
            <DialogHeader><DialogTitle>API key creata</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-900/20 p-3 text-xs text-amber-800 dark:text-amber-200">
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                <span>Copia ora questa chiave: per sicurezza non sarà più mostrata. Conservala in un posto sicuro.</span>
              </div>
              <div className="flex items-center gap-2">
                <code className="flex-1 min-w-0 break-all rounded-md border bg-muted px-3 py-2 text-xs font-mono">
                  {created.secret}
                </code>
                <Button type="button" size="icon" variant="outline" className="shrink-0" onClick={copySecret} title="Copia">
                  {copied ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Usala nell'header HTTP: <code className="font-mono">Authorization: Bearer {created.key.prefix}…</code>
              </p>
              <div className="flex justify-end">
                <Button type="button" onClick={close}>Fatto</Button>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

// ─── AI Agent Settings Tab ────────────────────────────────────────────────────
function MdEditorBox({ label, hint, value, onChange }: {
  label: string; hint?: string; value: string; onChange: (v: string) => void
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      <div className="h-52 rounded-lg border overflow-hidden">
        <CodeEditor value={value} onChange={onChange} language="markdown" />
      </div>
    </div>
  )
}

function AiAgentTab({ wsId }: { wsId: string }) {
  const queryClient = useQueryClient()
  const { data: settings } = useQuery<AiSettings>({
    queryKey: ['ai-settings', wsId],
    queryFn: () => aiApi.getSettings(wsId),
    enabled: !!wsId,
  })
  const [form, setForm] = useState<AiSettings | null>(null)
  const [newKey, setNewKey] = useState('')
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)

  const { data: models = [] } = useQuery<{ id: string; name: string }[]>({
    queryKey: ['ai-models', wsId],
    queryFn: () => aiApi.listModels(wsId),
    enabled: !!wsId,
    staleTime: 1000 * 60 * 30,
    retry: false,
  })

  useEffect(() => { if (settings) setForm(settings) }, [settings])

  if (!form) return <p className="text-sm text-muted-foreground">Caricamento...</p>

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
      }
      if (newKey.trim()) payload.apiKey = newKey.trim()
      const updated: AiSettings = await aiApi.updateSettings(wsId, payload)
      queryClient.setQueryData(['ai-settings', wsId], updated)
      setForm(updated); setNewKey('')
      toast('Impostazioni salvate')
    } catch (err: any) {
      toast(err.response?.data?.error ?? 'Errore', 'destructive')
    } finally {
      setSaving(false)
    }
  }

  const test = async () => {
    setTesting(true)
    try {
      const res: AiTestResult = await aiApi.testConnection(wsId, newKey.trim() || undefined)
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
    <div className="space-y-6 max-w-2xl">
      <label className="flex items-center gap-2.5 text-sm cursor-pointer select-none">
        <input type="checkbox" checked={form.enabled} onChange={e => set({ enabled: e.target.checked })} className="h-4 w-4 rounded border-input" />
        <span className="font-medium">Abilita l'agente AI in questo workspace</span>
      </label>

      <Separator />

      {/* Connessione */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold">Connessione OpenRouter</h3>
        <div className="space-y-1.5">
          <Label>Chiave API OpenRouter</Label>
          <Input
            type="password"
            value={newKey}
            onChange={e => setNewKey(e.target.value)}
            placeholder={form.apiKeySet ? `Configurata (${form.apiKeyPreview}). Inserisci per sostituirla` : 'sk-or-...'}
          />
          <p className="text-xs text-muted-foreground">La chiave è salvata cifrata e non viene mai mostrata in chiaro.</p>
        </div>
        <div className="space-y-1.5">
          <Label>Modello</Label>
          <Input list="or-models" value={form.model} onChange={e => set({ model: e.target.value })} placeholder="openai/gpt-4o-mini" />
          <datalist id="or-models">
            {models.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
          </datalist>
          <p className="text-xs text-muted-foreground">
            {models.length > 0
              ? `${models.length} modelli disponibili — scrivi per filtrare o incolla uno slug.`
              : 'Inserisci lo slug del modello (es. openai/gpt-4o-mini).'}
          </p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={test} disabled={testing}>
          <Plug className="h-3.5 w-3.5 mr-1.5" /> {testing ? 'Test in corso...' : 'Testa connessione'}
        </Button>
      </div>

      <Separator />

      {/* Comportamento */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold">Comportamento</h3>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label>Autonomia</Label>
            <Select value={form.autonomy} onValueChange={v => set({ autonomy: v as AiAutonomy })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="READ_ONLY">Sola lettura + proposte</SelectItem>
                <SelectItem value="CONFIRM_DESTRUCTIVE">Conferma per eliminare</SelectItem>
                <SelectItem value="FULL">Pieno controllo</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Memoria</Label>
            <Select value={form.memoryMode} onValueChange={v => set({ memoryMode: v as AiMemoryMode })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="AUTO_AND_ADMIN">Auto-evolutiva + admin</SelectItem>
                <SelectItem value="ADMIN_ONLY">Solo admin</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <div className="space-y-1.5">
            <Label>Temperatura</Label>
            <Input type="number" step="0.1" min="0" max="2" value={form.temperature} onChange={e => set({ temperature: num(e.target.value, form.temperature) })} />
          </div>
          <div className="space-y-1.5">
            <Label>Max token risposta</Label>
            <Input type="number" min="1" value={form.maxTokens} onChange={e => set({ maxTokens: num(e.target.value, form.maxTokens) })} />
          </div>
          <div className="space-y-1.5">
            <Label>Finestra contesto</Label>
            <Input type="number" min="1000" value={form.contextWindowTokens} onChange={e => set({ contextWindowTokens: num(e.target.value, form.contextWindowTokens) })} />
          </div>
          <div className="space-y-1.5">
            <Label>Soglia compacting (%)</Label>
            <Input type="number" min="10" max="95" value={form.compactThresholdPct} onChange={e => set({ compactThresholdPct: num(e.target.value, form.compactThresholdPct) })} />
          </div>
          <div className="space-y-1.5">
            <Label>Max passi tool/turno</Label>
            <Input type="number" min="1" max="20" value={form.maxToolIterations} onChange={e => set({ maxToolIterations: num(e.target.value, form.maxToolIterations) })} />
          </div>
        </div>
      </div>

      <Separator />

      {/* File markdown */}
      <div className="space-y-4">
        <h3 className="text-sm font-semibold">File dell'agente</h3>
        <MdEditorBox label="Personalità (personality.md)" hint="Chi è l'agente e come si comporta. Supporta {{workspaceName}}, {{userName}}, {{today}}." value={form.personalityMd} onChange={v => set({ personalityMd: v })} />
        <MdEditorBox label="Memoria (memory.md)" hint="Fatti durevoli condivisi nel workspace. In modalità auto-evolutiva l'agente può aggiungerne." value={form.memoryMd} onChange={v => set({ memoryMd: v })} />
        <MdEditorBox label="Tool / policy (tools.md)" hint="Quali tool abilitare e regole d'uso (es. 'non creare epiche senza conferma')." value={form.toolsMd} onChange={v => set({ toolsMd: v })} />
      </div>

      <div className="flex justify-end">
        <Button onClick={save} disabled={saving}>
          <Save className="h-4 w-4 mr-1.5" /> {saving ? 'Salvataggio...' : 'Salva impostazioni'}
        </Button>
      </div>
    </div>
  )
}

// ─── Rooms (stanze) Tab ───────────────────────────────────────────────────────
function RoomDialog({ wsId, room, members, open, onClose }: {
  wsId: string; room: Channel | null; members: Member[]; open: boolean; onClose: () => void
}) {
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [isPrivate, setIsPrivate] = useState(false)
  const [voiceEnabled, setVoiceEnabled] = useState(false)
  const [screenShareEnabled, setScreenShareEnabled] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open) {
      setName(room?.name ?? '')
      setDescription(room?.description ?? '')
      setIsPrivate(room?.isPrivate ?? false)
      setVoiceEnabled(room?.voiceEnabled ?? false)
      setScreenShareEnabled(room?.screenShareEnabled ?? false)
      setSelected(new Set(room?.members.map(m => m.userId) ?? []))
    }
  }, [open, room])

  const toggle = (id: string) => setSelected(prev => {
    const next = new Set(prev)
    next.has(id) ? next.delete(id) : next.add(id)
    return next
  })

  const save = async () => {
    if (!name.trim() || saving) return
    setSaving(true)
    const data = { name: name.trim(), description: description.trim(), isPrivate, voiceEnabled, screenShareEnabled: voiceEnabled && screenShareEnabled, memberIds: isPrivate ? [...selected] : [] }
    try {
      if (room) await channelsApi.updateRoom(wsId, room.id, data)
      else await channelsApi.createRoom(wsId, data)
      queryClient.invalidateQueries({ queryKey: ['rooms', wsId] })
      queryClient.invalidateQueries({ queryKey: ['channels', wsId] })
      toast(room ? 'Stanza aggiornata' : 'Stanza creata')
      onClose()
    } catch (err: any) {
      toast(err.response?.data?.error ?? 'Errore', 'destructive')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={o => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>{room ? 'Modifica stanza' : 'Nuova stanza'}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Nome</Label>
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="Es: Generale" autoFocus />
          </div>
          <div className="space-y-1.5">
            <Label>Descrizione (opzionale)</Label>
            <Input value={description} onChange={e => setDescription(e.target.value)} placeholder="A cosa serve questa stanza" />
          </div>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" checked={isPrivate} onChange={e => setIsPrivate(e.target.checked)} className="h-4 w-4" />
            Stanza privata (solo i membri selezionati)
          </label>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" checked={voiceEnabled} onChange={e => setVoiceEnabled(e.target.checked)} className="h-4 w-4" />
            Voce abilitata (i membri possono entrare in chiamata)
          </label>
          <label className={cn('flex items-center gap-2 text-sm', voiceEnabled ? 'cursor-pointer' : 'opacity-50 cursor-not-allowed')}>
            <input type="checkbox" checked={voiceEnabled && screenShareEnabled} disabled={!voiceEnabled}
              onChange={e => setScreenShareEnabled(e.target.checked)} className="h-4 w-4" />
            Condivisione schermo (richiede la voce)
          </label>
          {isPrivate && (
            <div className="space-y-1.5">
              <Label>Membri</Label>
              <div className="max-h-52 overflow-y-auto space-y-0.5 rounded-md border p-1">
                {members.map(m => (
                  <button
                    key={m.userId}
                    onClick={() => toggle(m.userId)}
                    className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm hover:bg-accent/60 transition-colors text-left"
                  >
                    <UserAvatar name={m.displayName} avatar={m.avatar} className="h-6 w-6" />
                    <span className="flex-1 truncate">{m.displayName}</span>
                    {selected.has(m.userId) && <Check className="h-4 w-4 text-primary" />}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>Annulla</Button>
            <Button onClick={save} disabled={!name.trim() || saving}>{saving ? 'Salvataggio…' : 'Salva'}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function RoomsTab({ wsId, members }: { wsId: string; members: Member[] }) {
  const queryClient = useQueryClient()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<Channel | null>(null)

  const { data: rooms = [] } = useQuery<Channel[]>({
    queryKey: ['rooms', wsId],
    queryFn: () => channelsApi.listRooms(wsId),
  })

  const openNew = () => { setEditing(null); setDialogOpen(true) }
  const openEdit = (r: Channel) => { setEditing(r); setDialogOpen(true) }

  const remove = async (r: Channel) => {
    if (!confirm(`Eliminare la stanza "${r.name}"? Tutti i messaggi andranno persi.`)) return
    try {
      await channelsApi.deleteRoom(wsId, r.id)
      queryClient.invalidateQueries({ queryKey: ['rooms', wsId] })
      queryClient.invalidateQueries({ queryKey: ['channels', wsId] })
      toast('Stanza eliminata')
    } catch (err: any) {
      toast(err.response?.data?.error ?? 'Errore', 'destructive')
    }
  }

  return (
    <div className="max-w-2xl space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">Stanze persistenti del workspace. Le pubbliche sono accessibili a tutti i membri; le private solo ai membri selezionati.</p>
        <Button size="sm" onClick={openNew}><Plus className="h-4 w-4 mr-1.5" /> Nuova stanza</Button>
      </div>
      <div className="space-y-1.5">
        {rooms.map(r => (
          <div key={r.id} className="flex items-center gap-3 rounded-lg border px-3 py-2.5">
            {r.isPrivate ? <Lock className="h-4 w-4 shrink-0 text-muted-foreground" /> : <Hash className="h-4 w-4 shrink-0 text-muted-foreground" />}
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium truncate">{r.name}</p>
              <p className="text-xs text-muted-foreground truncate">
                {r.isPrivate ? `Privata · ${r.members.length} membri` : 'Pubblica'}{r.description ? ` · ${r.description}` : ''}
              </p>
            </div>
            <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => openEdit(r)}>
              <Edit2 className="h-3.5 w-3.5" />
            </Button>
            <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={() => remove(r)}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        ))}
        {rooms.length === 0 && (
          <p className="text-sm text-muted-foreground">Nessuna stanza. Creane una per dare al team un canale persistente.</p>
        )}
      </div>
      <RoomDialog wsId={wsId} room={editing} members={members} open={dialogOpen} onClose={() => setDialogOpen(false)} />
    </div>
  )
}

// ─── Backup / Import Tab ──────────────────────────────────────────────────────
const EXPORT_SECTIONS: { id: 'settings' | 'members' | 'tags' | 'elements' | 'chat' | 'ai'; label: string; hint: string }[] = [
  { id: 'settings', label: 'Impostazioni', hint: 'Card Kanban, automazioni email, avatar' },
  { id: 'members', label: 'Membri e ruoli', hint: 'Riagganciati per email in fase di import' },
  { id: 'tags', label: 'Tag', hint: 'Etichette del workspace' },
  { id: 'elements', label: 'Epiche · Storie · Task · Eventi', hint: 'Tutta la gerarchia, con tag e assegnatari' },
  { id: 'chat', label: 'Chat', hint: 'Canali, stanze e messaggi' },
  { id: 'ai', label: 'Agente AI', hint: 'Configurazione di Akari (senza chiave API)' },
]

interface ImportResult {
  workspaceName: string; members: number; tags: number; elements: number
  channels: number; messages: number; aiImported: boolean; warnings: string[]
}

function BackupTab({ wsId, wsName }: { wsId: string; wsName: string }) {
  const queryClient = useQueryClient()
  const me = useAuthStore(s => s.user)
  const fileRef = useRef<HTMLInputElement>(null)
  const [sel, setSel] = useState<Record<string, boolean>>(
    () => Object.fromEntries(EXPORT_SECTIONS.map(s => [s.id, true]))
  )
  const [exporting, setExporting] = useState(false)
  const [importing, setImporting] = useState(false)
  const [newName, setNewName] = useState('')
  const [result, setResult] = useState<ImportResult | null>(null)

  const toggle = (id: string) => setSel(s => ({ ...s, [id]: !s[id] }))

  const doExport = async () => {
    setExporting(true)
    try {
      const data = await workspacesApi.exportWorkspace(wsId, sel)
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      const stamp = new Date().toISOString().slice(0, 10)
      const slug = wsName.replace(/[^a-z0-9]+/gi, '-').toLowerCase().replace(/^-+|-+$/g, '') || 'workspace'
      a.href = url
      a.download = `worktogether-${slug}-${stamp}.json`
      a.click()
      URL.revokeObjectURL(url)
      toast('Export completato: file scaricato')
    } catch (err: any) {
      toast(err.response?.data?.error ?? 'Errore durante l\'export', 'destructive')
    } finally {
      setExporting(false)
    }
  }

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setImporting(true)
    setResult(null)
    try {
      const data = JSON.parse(await file.text())
      const res: ImportResult = await workspacesApi.importWorkspace(data, newName.trim() || undefined)
      setResult(res)
      queryClient.invalidateQueries({ queryKey: ['workspaces'] })
      toast(`Workspace "${res.workspaceName}" importata`)
    } catch (err: any) {
      const msg = err?.response?.data?.error
        ?? (err instanceof SyntaxError ? 'Il file non è un JSON valido' : 'Errore durante l\'import')
      toast(msg, 'destructive')
    } finally {
      setImporting(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const allOn = EXPORT_SECTIONS.every(s => sel[s.id])
  const noneOn = EXPORT_SECTIONS.every(s => !sel[s.id])

  return (
    <div className="max-w-2xl space-y-8">
      {/* Export */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold flex items-center gap-1.5">
          <Download className="h-4 w-4" /> Esporta (backup)
        </h3>
        <p className="text-xs text-muted-foreground">
          Scegli cosa includere. Ottieni un file JSON che è insieme backup, ripristino e trasporto della
          workspace. Esclusi: la chiave API dell'agente AI e i file binari del Drive.
        </p>
        <div className="space-y-1.5 rounded-lg border p-3">
          {EXPORT_SECTIONS.map(s => (
            <label key={s.id} className="flex items-center gap-2.5 text-sm cursor-pointer select-none">
              <input type="checkbox" checked={!!sel[s.id]} onChange={() => toggle(s.id)} className="h-4 w-4 rounded border-input" />
              <span className="flex-1">{s.label}</span>
              <span className="text-[11px] text-muted-foreground hidden sm:inline">{s.hint}</span>
            </label>
          ))}
          <div className="pt-1.5 mt-1.5 border-t">
            <button
              onClick={() => setSel(Object.fromEntries(EXPORT_SECTIONS.map(s => [s.id, !allOn])))}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              {allOn ? 'Deseleziona tutto' : 'Seleziona tutto'}
            </button>
          </div>
        </div>
        <Button onClick={doExport} disabled={exporting || noneOn}>
          <Download className="h-4 w-4 mr-1.5" /> {exporting ? 'Esportazione…' : 'Esporta JSON'}
        </Button>
      </div>

      <Separator />

      {/* Import */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold flex items-center gap-1.5">
          <Upload className="h-4 w-4" /> Importa (ripristino)
        </h3>
        <p className="text-xs text-muted-foreground">
          Carica un file esportato: viene creata una <strong>nuova</strong> workspace con dentro tutto ciò
          che il file contiene. Non sovrascrive nulla di esistente.
        </p>

        {!me?.systemAdmin ? (
          <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-900/20 p-3 text-xs text-amber-800 dark:text-amber-200">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
            <span>L'import crea una nuova workspace: serve un <strong>amministratore di sistema</strong>. Chiedi al proprietario dell'istanza.</span>
          </div>
        ) : (
          <>
            <div className="space-y-1.5">
              <Label>Nome della nuova workspace (opzionale)</Label>
              <Input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Lascia vuoto per usare il nome dal file" />
            </div>
            <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" onChange={onFile} />
            <Button variant="outline" onClick={() => fileRef.current?.click()} disabled={importing}>
              <Upload className="h-4 w-4 mr-1.5" /> {importing ? 'Importazione…' : 'Scegli file e importa'}
            </Button>
          </>
        )}

        {result && (
          <div className="rounded-lg border bg-muted/30 p-3 text-sm space-y-2">
            <p className="font-medium flex items-center gap-1.5">
              <Check className="h-4 w-4 text-green-600" /> "{result.workspaceName}" importata
            </p>
            <p className="text-xs text-muted-foreground">
              {result.members} membri · {result.tags} tag · {result.elements} elementi · {result.channels} canali · {result.messages} messaggi{result.aiImported ? ' · AI' : ''}
            </p>
            {result.warnings.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs font-medium text-amber-700 dark:text-amber-300 flex items-center gap-1.5">
                  <AlertTriangle className="h-3.5 w-3.5" /> {result.warnings.length} avvisi
                </p>
                <ul className="list-disc pl-5 text-[11px] text-muted-foreground space-y-0.5 max-h-40 overflow-y-auto">
                  {result.warnings.map((w, i) => <li key={i}>{w}</li>)}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Delete Workspace Dialog ───────────────────────────────────────────────────
function DeleteWorkspaceDialog({ wsId, wsName, open, onClose }: { wsId: string; wsName: string; open: boolean; onClose: () => void }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const setCurrentStore = useWorkspaceStore(s => s.setCurrent)
  const [confirmText, setConfirmText] = useState('')
  const [deleting, setDeleting] = useState(false)

  const close = () => { setConfirmText(''); onClose() }

  const doDelete = async () => {
    setDeleting(true)
    try {
      await workspacesApi.deleteWorkspace(wsId)
      setCurrentStore(null)
      queryClient.invalidateQueries({ queryKey: ['workspaces'] })
      toast(`Workspace "${wsName}" eliminata`)
      navigate('/', { replace: true })
    } catch (err: any) {
      toast(err.response?.data?.error ?? 'Errore durante l\'eliminazione', 'destructive')
      setDeleting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={v => !v && close()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Eliminare il workspace?</DialogTitle></DialogHeader>
        <div className="space-y-3 text-sm">
          <p>
            Questa azione è <strong>irreversibile</strong>: elimina definitivamente membri, canali,
            messaggi, task, tag, file del Drive e ogni altro dato di <strong>"{wsName}"</strong>.
          </p>
          <p className="text-xs text-muted-foreground">
            Per confermare, scrivi il nome del workspace qui sotto.
          </p>
          <Input
            value={confirmText}
            onChange={e => setConfirmText(e.target.value)}
            placeholder={wsName}
            autoFocus
          />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={close} disabled={deleting}>Annulla</Button>
          <Button
            variant="destructive"
            disabled={confirmText !== wsName || deleting}
            onClick={doDelete}
          >
            <Trash2 className="h-3.5 w-3.5 mr-1.5" /> {deleting ? 'Eliminazione…' : 'Elimina definitivamente'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ─── Main Admin Page ──────────────────────────────────────────────────────────
export default function AdminPage() {
  const { wsId } = useParams<{ wsId: string }>()
  const queryClient = useQueryClient()
  const { current: currentStore, setCurrent: setCurrentStore } = useWorkspaceStore()
  const wsAvatarRef = useRef<HTMLInputElement>(null)
  const [createUserOpen, setCreateUserOpen] = useState(false)
  const [inviteOpen, setInviteOpen] = useState(false)
  const [createTagOpen, setCreateTagOpen] = useState(false)
  const [createKeyOpen, setCreateKeyOpen] = useState(false)
  const [deleteWsOpen, setDeleteWsOpen] = useState(false)

  // Ruolo dell'utente in questo workspace: serve a bloccare l'accesso diretto via URL.
  const { data: workspaces = [], isLoading: wsLoading } = useQuery<Workspace[]>({
    queryKey: ['workspaces'],
    queryFn: workspacesApi.list,
  })
  const currentWs = workspaces.find(w => w.id === wsId)

  const { data: members = [] } = useQuery<Member[]>({
    queryKey: ['members', wsId],
    queryFn: () => workspacesApi.getMembers(wsId!),
    enabled: !!wsId,
  })

  const { data: invitations = [] } = useQuery<Invitation[]>({
    queryKey: ['invitations', wsId],
    queryFn: () => invitationsApi.list(wsId!),
    enabled: !!wsId,
  })

  const { data: tags = [] } = useQuery<Tag[]>({
    queryKey: ['tags', wsId],
    queryFn: () => tagsApi.list(wsId!),
    enabled: !!wsId,
  })

  const { data: apiKeys = [] } = useQuery<ApiKey[]>({
    queryKey: ['api-keys', wsId],
    queryFn: () => apiKeysApi.list(wsId!),
    enabled: !!wsId,
  })

  // Appena conosciamo il ruolo, se non sei ADMIN del workspace torni alla board.
  if (!wsLoading && currentWs && currentWs.myRole !== 'ADMIN') {
    return <Navigate to={`/workspace/${wsId}/kanban`} replace />
  }

  const changeRole = async (userId: string, role: WorkspaceRole) => {
    await workspacesApi.updateRole(wsId!, userId, role)
    queryClient.invalidateQueries({ queryKey: ['members', wsId] })
    toast('Ruolo aggiornato')
  }

  const removeMember = async (userId: string) => {
    if (!confirm('Rimuovere il membro dal workspace? Verrà tolto da task, canali e inviti pendenti.')) return
    try {
      await workspacesApi.removeMember(wsId!, userId)
      queryClient.invalidateQueries({ queryKey: ['members', wsId] })
      queryClient.invalidateQueries({ queryKey: ['invitations', wsId] })
      toast('Membro rimosso')
    } catch (err: any) {
      // Es. 409 quando si prova a rimuovere l'unico amministratore.
      toast(err.response?.data?.error ?? 'Impossibile rimuovere il membro', 'destructive')
    }
  }

  const revokeInvitation = async (id: string) => {
    if (!confirm('Revocare questo invito?')) return
    try {
      await invitationsApi.revoke(wsId!, id)
      queryClient.invalidateQueries({ queryKey: ['invitations', wsId] })
      toast('Invito revocato')
    } catch (err: any) {
      toast(err.response?.data?.error ?? 'Errore', 'destructive')
    }
  }

  const deleteTag = async (tagId: string) => {
    if (!confirm('Eliminare il tag? Verrà rimosso da tutti gli elementi.')) return
    await tagsApi.delete(wsId!, tagId)
    queryClient.invalidateQueries({ queryKey: ['tags', wsId] })
    toast('Tag eliminato')
  }

  const deleteApiKey = async (id: string) => {
    if (!confirm('Revocare questa API key? Le integrazioni che la usano smetteranno di funzionare.')) return
    await apiKeysApi.delete(wsId!, id)
    queryClient.invalidateQueries({ queryKey: ['api-keys', wsId] })
    toast('API key revocata')
  }

  const applyWsSettings = async (data: { avatar?: string; cardShowTags?: boolean; cardShowAssignees?: boolean; cardShowDueDate?: boolean; reminderDaysBefore?: number; eventRemindersEnabled?: boolean; weeklyRecapEnabled?: boolean; mondayDigestEnabled?: boolean; sprintEnabled?: boolean }, msg: string) => {
    try {
      const updated = await workspacesApi.updateSettings(wsId!, data)
      queryClient.invalidateQueries({ queryKey: ['workspaces'] })
      if (currentStore?.id === wsId) setCurrentStore(updated)
      toast(msg)
    } catch (err: any) {
      toast(err.response?.data?.error ?? 'Errore', 'destructive')
    }
  }

  const handleWsAvatar = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith('image/')) { toast("Seleziona un'immagine", 'destructive'); return }
    try {
      const dataUrl = await resizeImageToDataUrl(file, 256)
      await applyWsSettings({ avatar: dataUrl }, 'Immagine workspace aggiornata')
    } finally {
      if (wsAvatarRef.current) wsAvatarRef.current.value = ''
    }
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="px-6 py-4 border-b shrink-0">
        <h1 className="text-lg font-semibold">Admin</h1>
        <p className="text-xs text-muted-foreground">Gestione workspace, utenti e tag</p>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <Tabs defaultValue="members">
          <TabsList>
            <TabsTrigger value="members" className="gap-1.5">
              <Users className="h-3.5 w-3.5" /> Membri ({members.length})
            </TabsTrigger>
            <TabsTrigger value="tags" className="gap-1.5">
              <TagIcon className="h-3.5 w-3.5" /> Tag ({tags.length})
            </TabsTrigger>
            <TabsTrigger value="workspace" className="gap-1.5">
              <Building2 className="h-3.5 w-3.5" /> Workspace
            </TabsTrigger>
            <TabsTrigger value="integrations" className="gap-1.5">
              <KeyRound className="h-3.5 w-3.5" /> API key ({apiKeys.length})
            </TabsTrigger>
            <TabsTrigger value="rooms" className="gap-1.5">
              <Hash className="h-3.5 w-3.5" /> Stanze
            </TabsTrigger>
            <TabsTrigger value="ai" className="gap-1.5">
              <Bot className="h-3.5 w-3.5" /> Agente AI
            </TabsTrigger>
            <TabsTrigger value="backup" className="gap-1.5">
              <DatabaseBackup className="h-3.5 w-3.5" /> Backup
            </TabsTrigger>
          </TabsList>

          {/* Workspace tab */}
          <TabsContent value="workspace" className="mt-4 space-y-6 max-w-xl">
            <div className="space-y-3">
              <h3 className="text-sm font-semibold">Immagine del workspace</h3>
              <div className="flex items-center gap-4">
                {currentWs?.avatar ? (
                  <img src={currentWs.avatar} alt="" className="h-16 w-16 rounded-lg object-cover border" />
                ) : (
                  <div className="flex h-16 w-16 items-center justify-center rounded-lg bg-primary text-primary-foreground text-xl font-semibold">
                    {currentWs?.name?.[0]?.toUpperCase() ?? <Building2 className="h-6 w-6" />}
                  </div>
                )}
                <div className="flex flex-col gap-2">
                  <input ref={wsAvatarRef} type="file" accept="image/*" className="hidden" onChange={handleWsAvatar} />
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => wsAvatarRef.current?.click()}>
                      <Camera className="h-3.5 w-3.5 mr-1.5" /> Cambia immagine
                    </Button>
                    {currentWs?.avatar && (
                      <Button size="sm" variant="ghost" onClick={() => applyWsSettings({ avatar: '' }, 'Immagine rimossa')}>
                        <Trash2 className="h-3.5 w-3.5 mr-1.5" /> Rimuovi
                      </Button>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">Mostrata nello switcher dei workspace.</p>
                </div>
              </div>
            </div>

            <Separator />

            <div className="space-y-3">
              <h3 className="text-sm font-semibold flex items-center gap-1.5">
                <ImageIcon className="h-4 w-4" /> Card della Kanban
              </h3>
              <p className="text-xs text-muted-foreground">Scegli quali informazioni mostrare nelle card dei task.</p>
              <div className="space-y-2">
                {([
                  ['cardShowTags', 'Mostra i tag', currentWs?.cardShowTags ?? true],
                  ['cardShowAssignees', 'Mostra gli assegnatari', currentWs?.cardShowAssignees ?? true],
                  ['cardShowDueDate', 'Mostra la scadenza', currentWs?.cardShowDueDate ?? true],
                ] as const).map(([field, label, value]) => (
                  <label key={field} className="flex items-center gap-2.5 text-sm cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={value}
                      onChange={e => applyWsSettings({ [field]: e.target.checked } as any, 'Impostazione aggiornata')}
                      className="h-4 w-4 rounded border-input"
                    />
                    {label}
                  </label>
                ))}
              </div>
            </div>

            <Separator />

            {/* Funzionalità del workspace */}
            <div className="space-y-3">
              <h3 className="text-sm font-semibold">Funzionalità</h3>
              <p className="text-xs text-muted-foreground">Attiva o nascondi sezioni del workspace per tutti i membri.</p>
              <label className="flex items-center gap-2.5 text-sm cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={currentWs?.sprintEnabled ?? false}
                  onChange={e => applyWsSettings({ sprintEnabled: e.target.checked }, e.target.checked ? 'Sezione Sprint attivata' : 'Sezione Sprint nascosta')}
                  className="h-4 w-4 rounded border-input"
                />
                Mostra la sezione <strong>Sprint</strong> (gestione sprint)
              </label>
            </div>

            <Separator />

            {/* Automazioni email */}
            <div className="space-y-3">
              <h3 className="text-sm font-semibold flex items-center gap-1.5">
                <Mail className="h-4 w-4" /> Automazioni email
              </h3>
              <p className="text-xs text-muted-foreground">Email automatiche inviate ai membri del workspace.</p>
              <div className="space-y-2">
                {([
                  ['eventRemindersEnabled', 'Promemoria eventi in arrivo', currentWs?.eventRemindersEnabled ?? true],
                  ['weeklyRecapEnabled', 'Recap della settimana (venerdì, scritto da Akari)', currentWs?.weeklyRecapEnabled ?? false],
                  ['mondayDigestEnabled', 'Riepilogo "dove eravamo" (lunedì, scritto da Akari)', currentWs?.mondayDigestEnabled ?? false],
                ] as const).map(([field, label, value]) => (
                  <label key={field} className="flex items-center gap-2.5 text-sm cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={value}
                      onChange={e => applyWsSettings({ [field]: e.target.checked } as any, 'Impostazione aggiornata')}
                      className="h-4 w-4 rounded border-input"
                    />
                    {label}
                  </label>
                ))}
              </div>
              <div className="flex items-center gap-2 pt-1">
                <Label htmlFor="reminderDays" className="text-sm">Promemoria eventi:</Label>
                <Input
                  id="reminderDays"
                  type="number"
                  min={0}
                  max={30}
                  defaultValue={currentWs?.reminderDaysBefore ?? 1}
                  onBlur={e => {
                    const v = Math.max(0, Math.min(30, Number(e.target.value) || 0))
                    applyWsSettings({ reminderDaysBefore: v }, 'Impostazione aggiornata')
                  }}
                  className="h-8 w-20"
                />
                <span className="text-sm text-muted-foreground">giorni prima</span>
              </div>
              <p className="text-xs text-muted-foreground">
                I recap di Akari richiedono l'agente AI attivo e una chiave OpenRouter configurata.
              </p>
            </div>

            <Separator />

            {/* Danger zone */}
            <div className="space-y-3">
              <h3 className="text-sm font-semibold flex items-center gap-1.5 text-destructive">
                <AlertTriangle className="h-4 w-4" /> Zona pericolosa
              </h3>
              <p className="text-xs text-muted-foreground">
                Elimina definitivamente questo workspace e tutti i suoi dati: membri, canali, messaggi,
                task, tag e file del Drive. Non è recuperabile.
              </p>
              <Button variant="destructive" size="sm" onClick={() => setDeleteWsOpen(true)}>
                <Trash2 className="h-3.5 w-3.5 mr-1.5" /> Elimina workspace
              </Button>
            </div>
          </TabsContent>

          {/* Members tab */}
          <TabsContent value="members" className="mt-4">
            <div className="flex justify-between items-center mb-4">
              <p className="text-sm text-muted-foreground">Gestisci ruoli, invita o crea nuovi account.</p>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => setInviteOpen(true)}>
                  <Mail className="h-4 w-4 mr-1.5" /> Invita
                </Button>
                <Button size="sm" onClick={() => setCreateUserOpen(true)}>
                  <UserPlus className="h-4 w-4 mr-1.5" /> Nuovo utente
                </Button>
              </div>
            </div>
            <div className="rounded-xl border overflow-hidden">
              {members.map((m, i) => (
                <div key={m.userId} className={`flex items-center gap-3 px-4 py-3 ${i < members.length - 1 ? 'border-b' : ''} hover:bg-muted/30 transition-colors`}>
                  <UserAvatar name={m.displayName} avatar={m.avatar} className="h-8 w-8" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{m.displayName}</p>
                    <p className="text-xs text-muted-foreground truncate">{m.email}</p>
                  </div>
                  <Select value={m.role} onValueChange={v => changeRole(m.userId, v as WorkspaceRole)}>
                    <SelectTrigger className="h-7 w-36 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ADMIN" className="text-xs">Admin</SelectItem>
                      <SelectItem value="COLLABORATORE" className="text-xs">Collaboratore</SelectItem>
                      <SelectItem value="GUEST" className="text-xs">Guest</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-muted-foreground hover:text-destructive"
                    onClick={() => removeMember(m.userId)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
              {members.length === 0 && (
                <div className="px-4 py-8 text-center text-sm text-muted-foreground">Nessun membro</div>
              )}
            </div>

            {invitations.length > 0 && (
              <div className="mt-6">
                <h3 className="text-sm font-semibold mb-2">Inviti in sospeso ({invitations.length})</h3>
                <div className="rounded-xl border overflow-hidden">
                  {invitations.map((inv, i) => (
                    <div key={inv.id} className={`flex items-center gap-3 px-4 py-3 ${i < invitations.length - 1 ? 'border-b' : ''}`}>
                      <Mail className="h-4 w-4 text-muted-foreground shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{inv.displayName ?? inv.email}</p>
                        <p className="text-xs text-muted-foreground truncate">
                          {inv.email} · {ROLE_LABELS[inv.role]} · scade il {formatDate(inv.expiresAt)}
                        </p>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground hover:text-destructive"
                        onClick={() => revokeInvitation(inv.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </TabsContent>

          {/* Tags tab */}
          <TabsContent value="tags" className="mt-4">
            <div className="flex justify-between items-center mb-4">
              <p className="text-sm text-muted-foreground">Crea e gestisci i tag del workspace.</p>
              <Button size="sm" onClick={() => setCreateTagOpen(true)}>
                <Plus className="h-4 w-4 mr-1.5" /> Nuovo tag
              </Button>
            </div>
            <div className="flex flex-wrap gap-3">
              {(tags as Tag[]).map(tag => (
                <div
                  key={tag.id}
                  className="flex items-center gap-2 rounded-full px-3 py-1.5 border"
                  style={{ borderColor: tag.color + '44', backgroundColor: tag.color + '11' }}
                >
                  <span
                    className="h-2.5 w-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: tag.color }}
                  />
                  <span className="text-sm font-medium" style={{ color: tag.color }}>{tag.name}</span>
                  <button
                    onClick={() => deleteTag(tag.id)}
                    className="ml-1 text-muted-foreground hover:text-destructive transition-colors"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              ))}
              {tags.length === 0 && (
                <p className="text-sm text-muted-foreground">Nessun tag. Creane uno per iniziare.</p>
              )}
            </div>
          </TabsContent>

          {/* API keys tab */}
          <TabsContent value="integrations" className="mt-4 max-w-2xl">
            <div className="flex justify-between items-center mb-1">
              <p className="text-sm text-muted-foreground">Chiavi per collegare servizi esterni (es. un bot Discord) alle API del workspace.</p>
              <Button size="sm" onClick={() => setCreateKeyOpen(true)}>
                <Plus className="h-4 w-4 mr-1.5" /> Nuova API key
              </Button>
            </div>
            <p className="text-xs text-muted-foreground mb-4">
              Ogni chiave ha permessi limitati (scope) e agisce solo su questo workspace. Il segreto è mostrato una sola volta alla creazione.
            </p>
            <div className="space-y-2">
              {apiKeys.map(k => {
                const expired = !!k.expiresAt && new Date(k.expiresAt).getTime() < Date.now()
                return (
                  <div key={k.id} className="rounded-lg border p-3.5">
                    <div className="flex items-start gap-3">
                      <KeyRound className="h-4 w-4 mt-0.5 shrink-0 text-primary" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-medium">{k.name}</span>
                          <code className="text-[11px] text-muted-foreground font-mono">{k.prefix}…</code>
                          {expired && <span className="text-[11px] rounded bg-destructive/10 text-destructive px-1.5 py-0.5">Scaduta</span>}
                        </div>
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {k.scopes.map(s => (
                            <code key={s} className="text-[11px] rounded bg-muted px-1.5 py-0.5 font-mono">{s}</code>
                          ))}
                        </div>
                        <p className="mt-1.5 text-xs text-muted-foreground">
                          Ultimo uso: {k.lastUsedAt ? formatDate(k.lastUsedAt) : 'mai'}
                          {k.expiresAt && ` · Scade: ${formatDate(k.expiresAt)}`}
                        </p>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
                        onClick={() => deleteApiKey(k.id)}
                        title="Revoca"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                )
              })}
              {apiKeys.length === 0 && (
                <p className="text-sm text-muted-foreground">Nessuna API key. Creane una per collegare un servizio esterno.</p>
              )}
            </div>
          </TabsContent>

          {/* Rooms tab */}
          <TabsContent value="rooms" className="mt-4">
            <RoomsTab wsId={wsId!} members={members} />
          </TabsContent>

          {/* AI agent tab */}
          <TabsContent value="ai" className="mt-4">
            <AiAgentTab wsId={wsId!} />
          </TabsContent>

          {/* Backup / import tab */}
          <TabsContent value="backup" className="mt-4">
            <BackupTab wsId={wsId!} wsName={currentWs?.name ?? 'workspace'} />
          </TabsContent>
        </Tabs>
      </div>

      <CreateUserDialog wsId={wsId!} open={createUserOpen} onClose={() => setCreateUserOpen(false)} />
      <InviteMemberDialog wsId={wsId!} open={inviteOpen} onClose={() => setInviteOpen(false)} />
      <CreateTagDialog wsId={wsId!} open={createTagOpen} onClose={() => setCreateTagOpen(false)} />
      <CreateApiKeyDialog wsId={wsId!} open={createKeyOpen} onClose={() => setCreateKeyOpen(false)} />
      <DeleteWorkspaceDialog
        wsId={wsId!}
        wsName={currentWs?.name ?? ''}
        open={deleteWsOpen}
        onClose={() => setDeleteWsOpen(false)}
      />
    </div>
  )
}
