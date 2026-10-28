import { useCallback, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { EyeOff, Mail, Search, Trash2, UserPlus, Users } from 'lucide-react'
import { workspacesApi, invitationsApi, visibilityApi } from '@/lib/api'
import type { Invitation, Member, WorkspaceRole } from '@/types'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { toast } from '@/components/ui/toast'
import { Callout, EmptyState, QueryState, SettingRow, UserAvatar, useConfirm } from '@/components/shared'
import { useAuthStore } from '@/store/authStore'
import { formatDate } from '@/lib/utils'
import { ListHeader, ROLE_LABELS, RoleSelectItems, SettingsSection, apiError } from './shared'

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
    } catch (err) {
      toast(apiError(err), 'destructive')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Nuovo utente</DialogTitle>
          <DialogDescription>Crea un account e aggiungilo direttamente al workspace.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handle} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="cu-name">Username</Label>
            <Input id="cu-name" value={displayName} onChange={e => setDisplayName(e.target.value)} required placeholder="mario.rossi" autoComplete="off" />
            <p className="text-caption text-muted-foreground">
              È l&apos;identificativo di accesso. L&apos;utente completerà email e password al primo login.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label>Ruolo</Label>
            <Select value={role} onValueChange={v => setRole(v as WorkspaceRole)}>
              <SelectTrigger aria-label="Ruolo"><SelectValue /></SelectTrigger>
              <SelectContent><RoleSelectItems /></SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2.5">
            <Checkbox id="cu-manual" checked={manualCreds} onCheckedChange={v => setManualCreds(v === true)} />
            <Label htmlFor="cu-manual" className="cursor-pointer font-normal">
              Imposta manualmente email e password temporanea
            </Label>
          </div>
          {manualCreds && (
            <div className="space-y-3 rounded-md border bg-surface-2 p-3">
              <div className="space-y-1.5">
                <Label htmlFor="cu-email">Email</Label>
                <Input id="cu-email" type="email" value={email} onChange={e => setEmail(e.target.value)} required={manualCreds} placeholder="mario@esempio.it" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cu-pw">Password temporanea</Label>
                <Input id="cu-pw" type="password" value={password} onChange={e => setPassword(e.target.value)} required={manualCreds} minLength={8} placeholder="Min. 8 caratteri" autoComplete="new-password" />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Annulla</Button>
            <Button type="submit" loading={loading}>Crea utente</Button>
          </DialogFooter>
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
    } catch (err) {
      toast(apiError(err), 'destructive')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Invita un utente</DialogTitle>
          <DialogDescription>Riceverà un&apos;email con un link per accettare l&apos;invito.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handle} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="inv-id">Username o email</Label>
            <Input id="inv-id" value={identifier} onChange={e => setIdentifier(e.target.value)} required placeholder="mario.rossi o mario@esempio.it" autoComplete="off" />
          </div>
          <div className="space-y-1.5">
            <Label>Ruolo</Label>
            <Select value={role} onValueChange={v => setRole(v as WorkspaceRole)}>
              <SelectTrigger aria-label="Ruolo"><SelectValue /></SelectTrigger>
              <SelectContent><RoleSelectItems /></SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Annulla</Button>
            <Button type="submit" loading={loading}>Invia invito</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ─── La tua visibilità (modalità invisibile, solo admin) ───────────────────────
function VisibilityCard({ wsId, me }: { wsId: string; me: Member }) {
  const queryClient = useQueryClient()
  const [busy, setBusy] = useState(false)
  const hidden = !!me.hidden

  const toggle = async (next: boolean) => {
    setBusy(true)
    // Ottimistico: la lista membri dell'admin riflette subito il nuovo stato.
    queryClient.setQueryData<Member[]>(['members', wsId], old =>
      old?.map(m => (m.userId === me.userId ? { ...m, hidden: next } : m)))
    try {
      await visibilityApi.setHidden(wsId, next)
      toast(next ? 'Modalità invisibile attiva' : 'Ora sei di nuovo visibile')
    } catch (err) {
      toast(apiError(err, 'Impossibile cambiare la visibilità'), 'destructive')
    } finally {
      setBusy(false)
      queryClient.invalidateQueries({ queryKey: ['members', wsId] })
      queryClient.invalidateQueries({ queryKey: ['channels', wsId] })
    }
  }

  return (
    <SettingsSection
      icon={EyeOff}
      title="La tua visibilità"
      description="Resta nel workspace senza comparire agli altri utenti."
      actions={hidden ? <Badge variant="warning" size="sm"><EyeOff className="h-3 w-3" /> Sei invisibile</Badge> : undefined}
      contentClassName="space-y-3"
    >
      <SettingRow
        htmlFor="vis-hidden"
        label="Modalità invisibile"
        description="I collaboratori e gli ospiti non ti vedranno negli elenchi dei membri, nei selettori (assegnatari, messaggi diretti), nelle stanze e tra gli utenti online o in chiamata; non vedranno quando stai scrivendo. Gli altri amministratori continuano a vederti qui con l'etichetta «Invisibile»."
      >
        <Switch id="vis-hidden" checked={hidden} disabled={busy} onCheckedChange={v => void toggle(v)} />
      </SettingRow>
      {hidden && (
        <Callout variant="info">
          Ciò che crei resta firmato col tuo nome: messaggi, commenti ed elementi mostrano l&apos;autore, e i task assegnati a te
          continuano a mostrarti come assegnatario. Se entri in una chiamata vocale, gli altri partecipanti alla chiamata ti vedono.
        </Callout>
      )}
    </SettingsSection>
  )
}

// ─── Members Tab ──────────────────────────────────────────────────────────────
const COLS = 'md:grid-cols-[minmax(0,1fr)_11rem_2rem]'

export function MembersTab({ wsId }: { wsId: string }) {
  const queryClient = useQueryClient()
  const confirm = useConfirm()
  const meId = useAuthStore(s => s.user?.id)
  const [createUserOpen, setCreateUserOpen] = useState(false)
  const [inviteOpen, setInviteOpen] = useState(false)
  const [filter, setFilter] = useState('')

  const membersQuery = useQuery<Member[]>({
    queryKey: ['members', wsId],
    queryFn: () => workspacesApi.getMembers(wsId),
    enabled: !!wsId,
  })
  const { data: invitations = [] } = useQuery<Invitation[]>({
    queryKey: ['invitations', wsId],
    queryFn: () => invitationsApi.list(wsId),
    enabled: !!wsId,
  })

  const members = membersQuery.data
  const filtered = useMemo(() => {
    const list = members ?? []
    const q = filter.trim().toLowerCase()
    if (!q) return list
    return list.filter(m => m.displayName.toLowerCase().includes(q) || (m.email ?? '').toLowerCase().includes(q))
  }, [members, filter])

  const changeRole = useCallback(async (userId: string, role: WorkspaceRole) => {
    try {
      await workspacesApi.updateRole(wsId, userId, role)
      queryClient.invalidateQueries({ queryKey: ['members', wsId] })
      toast('Ruolo aggiornato')
    } catch (err) {
      toast(apiError(err, 'Impossibile aggiornare il ruolo'), 'destructive')
    }
  }, [wsId, queryClient])

  const removeMember = useCallback(async (m: Member) => {
    const ok = await confirm({
      title: `Rimuovere ${m.displayName}?`,
      description: 'Verrà tolto dal workspace, da task, canali e inviti pendenti.',
      confirmLabel: 'Rimuovi',
      destructive: true,
    })
    if (!ok) return
    try {
      await workspacesApi.removeMember(wsId, m.userId)
      queryClient.invalidateQueries({ queryKey: ['members', wsId] })
      queryClient.invalidateQueries({ queryKey: ['invitations', wsId] })
      toast('Membro rimosso')
    } catch (err) {
      // Es. 409 quando si prova a rimuovere l'unico amministratore.
      toast(apiError(err, 'Impossibile rimuovere il membro'), 'destructive')
    }
  }, [wsId, queryClient, confirm])

  const revokeInvitation = useCallback(async (inv: Invitation) => {
    const ok = await confirm({
      title: 'Revocare questo invito?',
      description: `Il link inviato a ${inv.email} smetterà di funzionare.`,
      confirmLabel: 'Revoca',
      destructive: true,
    })
    if (!ok) return
    try {
      await invitationsApi.revoke(wsId, inv.id)
      queryClient.invalidateQueries({ queryKey: ['invitations', wsId] })
      toast('Invito revocato')
    } catch (err) {
      toast(apiError(err), 'destructive')
    }
  }, [wsId, queryClient, confirm])

  const me = members?.find(m => m.userId === meId)

  return (
    <div className="space-y-6">
      {me?.role === 'ADMIN' && <VisibilityCard wsId={wsId} me={me} />}

      <SettingsSection
        icon={Users}
        title="Membri"
        description="Gestisci i ruoli, invita persone o crea nuovi account."
        actions={
          <>
            <Button size="sm" variant="outline" onClick={() => setInviteOpen(true)}>
              <Mail className="h-3.5 w-3.5" /> Invita
            </Button>
            <Button size="sm" onClick={() => setCreateUserOpen(true)}>
              <UserPlus className="h-3.5 w-3.5" /> Nuovo utente
            </Button>
          </>
        }
        contentClassName="space-y-3"
      >
        {(members?.length ?? 0) > 5 && (
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={filter}
              onChange={e => setFilter(e.target.value)}
              placeholder="Cerca per nome o email"
              aria-label="Cerca membri"
              className="h-8 pl-8"
            />
          </div>
        )}
        <QueryState
          query={membersQuery}
          skeleton="list"
          rows={4}
          empty={{ icon: Users, title: 'Nessun membro', size: 'sm', bordered: true }}
        >
          <div role="table" aria-label="Membri" className="overflow-hidden rounded-md border">
            <ListHeader className={COLS}>
              <span>Membro</span>
              <span>Ruolo</span>
              <span className="sr-only">Azioni</span>
            </ListHeader>
            <div className="divide-y">
              {filtered.map(m => (
                <div
                  key={m.userId}
                  role="row"
                  className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 px-3 py-2.5 transition-colors hover:bg-accent/40 md:gap-4 md:px-4 ${COLS}`}
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <UserAvatar name={m.displayName} avatarUrl={m.avatarUrl} avatar={m.avatar} size="md" />
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 truncate text-sm font-medium">
                        <span className="truncate">{m.displayName}</span>
                        {m.userId === meId && <Badge variant="muted" size="sm">Tu</Badge>}
                        {m.hidden && (
                          <Badge variant="warning" size="sm" title="Non visibile ai collaboratori e agli ospiti">
                            <EyeOff className="h-3 w-3" /> Invisibile
                          </Badge>
                        )}
                      </div>
                      <p className="truncate text-caption text-muted-foreground">{m.email}</p>
                    </div>
                  </div>
                  <div className="col-span-2 row-start-2 md:col-span-1 md:row-start-auto">
                    <Select value={m.role} onValueChange={v => changeRole(m.userId, v as WorkspaceRole)}>
                      <SelectTrigger className="h-8 text-xs" aria-label={`Ruolo di ${m.displayName}`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent><RoleSelectItems guestHint={false} /></SelectContent>
                    </Select>
                  </div>
                  <div className="col-start-2 row-start-1 md:col-start-auto md:row-start-auto">
                    <IconButton
                      size="xs"
                      label={`Rimuovi ${m.displayName}`}
                      icon={<Trash2 />}
                      className="hover:text-destructive"
                      onClick={() => removeMember(m)}
                    />
                  </div>
                </div>
              ))}
              {filtered.length === 0 && (
                <p className="px-4 py-6 text-center text-sm text-muted-foreground">Nessun membro corrisponde alla ricerca.</p>
              )}
            </div>
          </div>
        </QueryState>
      </SettingsSection>

      <SettingsSection
        icon={Mail}
        title={`Inviti in sospeso${invitations.length ? ` (${invitations.length})` : ''}`}
        description="Inviti inviati via email e non ancora accettati."
      >
        {invitations.length === 0 ? (
          <EmptyState size="sm" bordered icon={Mail} title="Nessun invito in sospeso" />
        ) : (
          <div className="divide-y overflow-hidden rounded-md border">
            {invitations.map(inv => (
              <div key={inv.id} className="flex items-center gap-3 px-3 py-2.5 md:px-4">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-2 text-muted-foreground">
                  <Mail className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{inv.displayName ?? inv.email}</p>
                  <p className="truncate text-caption text-muted-foreground">
                    {inv.email} · scade il {formatDate(inv.expiresAt)}
                  </p>
                </div>
                <Badge variant="outline" size="sm" className="hidden sm:inline-flex">{ROLE_LABELS[inv.role]}</Badge>
                <IconButton
                  size="xs"
                  label="Revoca invito"
                  icon={<Trash2 />}
                  className="hover:text-destructive"
                  onClick={() => revokeInvitation(inv)}
                />
              </div>
            ))}
          </div>
        )}
      </SettingsSection>

      <CreateUserDialog wsId={wsId} open={createUserOpen} onClose={() => setCreateUserOpen(false)} />
      <InviteMemberDialog wsId={wsId} open={inviteOpen} onClose={() => setInviteOpen(false)} />
    </div>
  )
}

