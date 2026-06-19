import { useEffect, useRef, useState } from 'react'
import { Navigate, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { workspacesApi, tagsApi, usersApi, apiKeysApi, aiApi } from '@/lib/api'
import { Member, Tag, Workspace, WorkspaceRole, ApiKey, CreatedApiKey, ApiScope, AiSettings, AiAutonomy, AiMemoryMode, AiTestResult } from '@/types'
import { CodeEditor } from '@/components/editor/CodeEditor'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { UserAvatar } from '@/components/UserAvatar'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { getInitials, resizeImageToDataUrl, formatDate } from '@/lib/utils'
import { toast } from '@/components/ui/toast'
import { useWorkspaceStore } from '@/store/workspaceStore'
import { Plus, Trash2, Edit2, Users, Tag as TagIcon, UserPlus, Building2, Image as ImageIcon, Camera, KeyRound, Copy, Check, AlertTriangle, Bot, Save, Plug } from 'lucide-react'

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
  const [email, setEmail] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<WorkspaceRole>('COLLABORATORE')
  const [loading, setLoading] = useState(false)

  const handle = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    try {
      await workspacesApi.createUser(wsId, { email, displayName, temporaryPassword: password, role })
      queryClient.invalidateQueries({ queryKey: ['members', wsId] })
      toast('Utente creato. Dovrà cambiare la password al primo accesso.')
      onClose()
      setEmail(''); setDisplayName(''); setPassword(''); setRole('COLLABORATORE')
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
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Email</Label>
              <Input type="email" value={email} onChange={e => setEmail(e.target.value)} required placeholder="mario@esempio.it" />
            </div>
            <div className="space-y-1.5">
              <Label>Nome</Label>
              <Input value={displayName} onChange={e => setDisplayName(e.target.value)} required placeholder="Mario Rossi" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Password temporanea</Label>
            <Input type="password" value={password} onChange={e => setPassword(e.target.value)} required minLength={8} placeholder="Min. 8 caratteri" />
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
            <Button type="submit" disabled={loading}>{loading ? 'Creazione...' : 'Crea utente'}</Button>
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
          <Input value={form.model} onChange={e => set({ model: e.target.value })} placeholder="openai/gpt-4o-mini" />
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

// ─── Main Admin Page ──────────────────────────────────────────────────────────
export default function AdminPage() {
  const { wsId } = useParams<{ wsId: string }>()
  const queryClient = useQueryClient()
  const { current: currentStore, setCurrent: setCurrentStore } = useWorkspaceStore()
  const wsAvatarRef = useRef<HTMLInputElement>(null)
  const [createUserOpen, setCreateUserOpen] = useState(false)
  const [createTagOpen, setCreateTagOpen] = useState(false)
  const [createKeyOpen, setCreateKeyOpen] = useState(false)

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
    if (!confirm('Rimuovere il membro dal workspace?')) return
    await workspacesApi.removeMember(wsId!, userId)
    queryClient.invalidateQueries({ queryKey: ['members', wsId] })
    toast('Membro rimosso')
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

  const applyWsSettings = async (data: { avatar?: string; cardShowTags?: boolean; cardShowAssignees?: boolean; cardShowDueDate?: boolean }, msg: string) => {
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
            <TabsTrigger value="ai" className="gap-1.5">
              <Bot className="h-3.5 w-3.5" /> Agente AI
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
          </TabsContent>

          {/* Members tab */}
          <TabsContent value="members" className="mt-4">
            <div className="flex justify-between items-center mb-4">
              <p className="text-sm text-muted-foreground">Gestisci ruoli e crea nuovi account.</p>
              <Button size="sm" onClick={() => setCreateUserOpen(true)}>
                <UserPlus className="h-4 w-4 mr-1.5" /> Nuovo utente
              </Button>
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

          {/* AI agent tab */}
          <TabsContent value="ai" className="mt-4">
            <AiAgentTab wsId={wsId!} />
          </TabsContent>
        </Tabs>
      </div>

      <CreateUserDialog wsId={wsId!} open={createUserOpen} onClose={() => setCreateUserOpen(false)} />
      <CreateTagDialog wsId={wsId!} open={createTagOpen} onClose={() => setCreateTagOpen(false)} />
      <CreateApiKeyDialog wsId={wsId!} open={createKeyOpen} onClose={() => setCreateKeyOpen(false)} />
    </div>
  )
}
