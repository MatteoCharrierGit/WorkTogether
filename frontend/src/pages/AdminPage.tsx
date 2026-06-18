import { useRef, useState } from 'react'
import { Navigate, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { workspacesApi, tagsApi, usersApi } from '@/lib/api'
import { Member, Tag, Workspace, WorkspaceRole } from '@/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { UserAvatar } from '@/components/UserAvatar'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { getInitials, resizeImageToDataUrl } from '@/lib/utils'
import { toast } from '@/components/ui/toast'
import { useWorkspaceStore } from '@/store/workspaceStore'
import { Plus, Trash2, Edit2, Users, Tag as TagIcon, UserPlus, Building2, Image as ImageIcon, Camera } from 'lucide-react'

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

// ─── Main Admin Page ──────────────────────────────────────────────────────────
export default function AdminPage() {
  const { wsId } = useParams<{ wsId: string }>()
  const queryClient = useQueryClient()
  const { current: currentStore, setCurrent: setCurrentStore } = useWorkspaceStore()
  const wsAvatarRef = useRef<HTMLInputElement>(null)
  const [createUserOpen, setCreateUserOpen] = useState(false)
  const [createTagOpen, setCreateTagOpen] = useState(false)

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
        </Tabs>
      </div>

      <CreateUserDialog wsId={wsId!} open={createUserOpen} onClose={() => setCreateUserOpen(false)} />
      <CreateTagDialog wsId={wsId!} open={createTagOpen} onClose={() => setCreateTagOpen(false)} />
    </div>
  )
}
