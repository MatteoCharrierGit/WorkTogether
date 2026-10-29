import { useCallback, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { EyeOff, Mail, Search, Trash2, UserPlus, Users } from 'lucide-react'
import { workspacesApi, invitationsApi, visibilityApi, adminUsersApi } from '@/lib/api'
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
import { Callout, EmptyState, PasswordInput, QueryState, SettingRow, UserAvatar, useConfirm } from '@/components/shared'
import { useAuthStore } from '@/store/authStore'
import { formatDate } from '@/lib/utils'
import { ListHeader, ROLE_LABELS, RoleSelectItems, SettingsSection, apiError } from './shared'

// ─── Create User Dialog ───────────────────────────────────────────────────────
// Solo admin di sistema: l'account nasce in Authentik (password iniziale + gruppo dell'app) e
// viene subito aggiunto a questo workspace. Niente registrazione pubblica. Con «Invia invito per
// email» l'utente riceve le credenziali e deve scegliere una nuova password al primo accesso.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function CreateUserDialog({ wsId, open, onClose }: { wsId: string; open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient()
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<WorkspaceRole>('COLLABORATORE')
  const [sendInvite, setSendInvite] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  // Account creato ma email non partita: il dialog resta aperto con l'avviso (niente nuovo invio del form).
  const [inviteFailure, setInviteFailure] = useState<{ username: string; email: string; reason: string } | null>(null)

  const emailValid = EMAIL_RE.test(email.trim())
  const inviteActive = sendInvite && emailValid

  const reset = () => {
    setUsername(''); setEmail(''); setName(''); setPassword(''); setRole('COLLABORATORE')
    setSendInvite(false); setError(''); setInviteFailure(null)
  }

  const close = () => { onClose(); reset() }

  const handle = async (e: React.FormEvent) => {
    e.preventDefault()
    if (password.length < 8) { setError('La password iniziale deve avere almeno 8 caratteri'); return }
    setError('')
    setLoading(true)
    try {
      const created = await adminUsersApi.create({
        username: username.trim(),
        email: email.trim(),
        name: name.trim() || undefined,
        password,
        workspaceId: wsId,
        role,
        sendInvite: inviteActive,
      })
      queryClient.invalidateQueries({ queryKey: ['members', wsId] })
      if (!inviteActive) {
        toast('Account creato. Comunica username e password iniziale: potrà cambiarla dal suo account.', 'success')
        close()
      } else if (created.inviteSent) {
        toast(`Account creato e invito inviato a ${email.trim()}.`, 'success')
        close()
      } else {
        setInviteFailure({
          username: username.trim(),
          email: email.trim(),
          reason: created.inviteError || 'motivo sconosciuto',
        })
      }
    } catch (err) {
      setError(apiError(err, 'Impossibile creare l\'account'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) close() }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Nuovo utente</DialogTitle>
          <DialogDescription>Crea l&apos;account di accesso (Authentik) e aggiungilo a questo workspace.</DialogDescription>
        </DialogHeader>
        {inviteFailure ? (
          <div className="space-y-4">
            <Callout variant="warning" title="Account creato, ma l'email non è partita">
              <p>Motivo: {inviteFailure.reason}.</p>
              <p className="mt-1.5">
                L&apos;account <strong>{inviteFailure.username}</strong> esiste già: comunica tu username e password
                iniziale a {inviteFailure.email}. Al primo accesso dovrà comunque sceglierne una nuova.
              </p>
            </Callout>
            <DialogFooter>
              <Button type="button" onClick={close} autoFocus>Chiudi</Button>
            </DialogFooter>
          </div>
        ) : (
        <form onSubmit={handle} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="cu-username">Username</Label>
            <Input id="cu-username" value={username} onChange={e => setUsername(e.target.value)} required placeholder="mario.rossi" autoComplete="off" autoCapitalize="none" pattern="[A-Za-z0-9._@+\-]+" />
            <p className="text-caption text-muted-foreground">Serve per accedere. Lettere, numeri e . _ @ + -</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cu-email">Email</Label>
            <Input id="cu-email" type="email" value={email} onChange={e => setEmail(e.target.value)} required placeholder="mario@esempio.it" autoComplete="off" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cu-name">Nome</Label>
            <Input id="cu-name" value={name} onChange={e => setName(e.target.value)} placeholder="Mario Rossi" autoComplete="off" />
            <p className="text-caption text-muted-foreground">Come lo vedranno gli altri. Se vuoto si usa lo username.</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cu-pw">Password iniziale</Label>
            <PasswordInput id="cu-pw" value={password} onChange={e => setPassword(e.target.value)} required minLength={8} placeholder="Min. 8 caratteri" autoComplete="new-password" />
          </div>
          <div className="space-y-1.5">
            <Label>Ruolo nel workspace</Label>
            <Select value={role} onValueChange={v => setRole(v as WorkspaceRole)}>
              <SelectTrigger aria-label="Ruolo"><SelectValue /></SelectTrigger>
              <SelectContent><RoleSelectItems /></SelectContent>
            </Select>
          </div>
          <div className="flex items-start gap-2.5">
            <Checkbox
              id="cu-invite"
              className="mt-0.5"
              checked={inviteActive}
              disabled={!emailValid}
              onCheckedChange={v => setSendInvite(v === true)}
              aria-describedby="cu-invite-help"
            />
            <div className="min-w-0 space-y-0.5">
              <Label htmlFor="cu-invite" className={emailValid ? 'cursor-pointer' : 'cursor-not-allowed opacity-60'}>
                Invia invito per email
              </Label>
              <p id="cu-invite-help" className="text-caption text-muted-foreground">
                {emailValid
                  ? 'L\'utente riceve username e password temporanea e dovrà sceglierne una nuova al primo accesso.'
                  : 'Inserisci un\'email valida per poter inviare l\'invito.'}
              </p>
            </div>
          </div>
          {error && <Callout variant="destructive">{error}</Callout>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={close}>Annulla</Button>
            <Button type="submit" loading={loading}>{inviteActive ? 'Crea e invia invito' : 'Crea utente'}</Button>
          </DialogFooter>
        </form>
        )}
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
  const isSystemAdmin = useAuthStore(s => !!s.user?.systemAdmin)
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
        description={isSystemAdmin ? "Gestisci i ruoli, invita persone o crea nuovi account." : "Gestisci i ruoli e invita persone che hanno già un account."}
        actions={
          <>
            <Button size="sm" variant="outline" onClick={() => setInviteOpen(true)}>
              <Mail className="h-3.5 w-3.5" /> Invita
            </Button>
            {/* Creare account è riservato all'admin di sistema (gli account vivono in Authentik). */}
            {isSystemAdmin && (
              <Button size="sm" onClick={() => setCreateUserOpen(true)}>
                <UserPlus className="h-3.5 w-3.5" /> Nuovo utente
              </Button>
            )}
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

      {isSystemAdmin && <CreateUserDialog wsId={wsId} open={createUserOpen} onClose={() => setCreateUserOpen(false)} />}
      <InviteMemberDialog wsId={wsId} open={inviteOpen} onClose={() => setInviteOpen(false)} />
    </div>
  )
}

