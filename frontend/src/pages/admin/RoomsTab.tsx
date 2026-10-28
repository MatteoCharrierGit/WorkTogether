import { useCallback, useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Edit2, Hash, Lock, Mic, MonitorUp, Plus, Trash2 } from 'lucide-react'
import { channelsApi, workspacesApi } from '@/lib/api'
import type { Channel, Member } from '@/types'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { toast } from '@/components/ui/toast'
import { QueryState, UserAvatar, useConfirm } from '@/components/shared'
import { SettingRow, SettingsSection, apiError } from './shared'

// ─── Room Dialog ──────────────────────────────────────────────────────────────
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

  const save = async (e?: React.FormEvent) => {
    e?.preventDefault()
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
    } catch (err) {
      toast(apiError(err), 'destructive')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>{room ? 'Modifica stanza' : 'Nuova stanza'}</DialogTitle></DialogHeader>
        <form onSubmit={save} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="room-name">Nome</Label>
            <Input id="room-name" value={name} onChange={e => setName(e.target.value)} placeholder="Es: Generale" autoFocus />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="room-desc">Descrizione <span className="font-normal text-muted-foreground">(opzionale)</span></Label>
            <Input id="room-desc" value={description} onChange={e => setDescription(e.target.value)} placeholder="A cosa serve questa stanza" />
          </div>
          <div className="divide-y rounded-md border px-3 py-1">
            <SettingRow htmlFor="room-private" label="Stanza privata" description="Visibile solo ai membri selezionati." className="py-2.5 first:pt-2.5 last:pb-2.5">
              <Switch id="room-private" checked={isPrivate} onCheckedChange={setIsPrivate} />
            </SettingRow>
            <SettingRow htmlFor="room-voice" label="Voce abilitata" description="I membri possono entrare in chiamata." className="py-2.5 first:pt-2.5 last:pb-2.5">
              <Switch id="room-voice" checked={voiceEnabled} onCheckedChange={setVoiceEnabled} />
            </SettingRow>
            <SettingRow
              htmlFor="room-screen"
              label="Condivisione schermo"
              description="Richiede la voce."
              className={voiceEnabled ? 'py-2.5 first:pt-2.5 last:pb-2.5' : 'py-2.5 opacity-50 first:pt-2.5 last:pb-2.5'}
            >
              <Switch
                id="room-screen"
                checked={voiceEnabled && screenShareEnabled}
                disabled={!voiceEnabled}
                onCheckedChange={setScreenShareEnabled}
              />
            </SettingRow>
          </div>
          {isPrivate && (
            <div className="space-y-1.5">
              <Label>Membri <span className="font-normal text-muted-foreground">({selected.size} selezionati)</span></Label>
              <div className="max-h-52 space-y-0.5 overflow-y-auto rounded-md border p-1">
                {members.map(m => (
                  <label
                    key={m.userId}
                    htmlFor={`room-m-${m.userId}`}
                    className="flex w-full cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm transition-colors hover:bg-accent/60"
                  >
                    <Checkbox id={`room-m-${m.userId}`} checked={selected.has(m.userId)} onCheckedChange={() => toggle(m.userId)} />
                    <UserAvatar name={m.displayName} avatar={m.avatar} size="sm" />
                    <span className="flex-1 truncate">{m.displayName}</span>
                  </label>
                ))}
              </div>
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Annulla</Button>
            <Button type="submit" loading={saving} disabled={!name.trim()}>Salva</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function RoomsTab({ wsId }: { wsId: string }) {
  const queryClient = useQueryClient()
  const confirm = useConfirm()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<Channel | null>(null)

  const roomsQuery = useQuery<Channel[]>({
    queryKey: ['rooms', wsId],
    queryFn: () => channelsApi.listRooms(wsId),
  })
  const { data: members = [] } = useQuery<Member[]>({
    queryKey: ['members', wsId],
    queryFn: () => workspacesApi.getMembers(wsId),
    enabled: !!wsId,
  })

  const openNew = () => { setEditing(null); setDialogOpen(true) }
  const openEdit = (r: Channel) => { setEditing(r); setDialogOpen(true) }

  const remove = useCallback(async (r: Channel) => {
    const ok = await confirm({
      title: `Eliminare la stanza "${r.name}"?`,
      description: 'Tutti i messaggi andranno persi.',
      confirmLabel: 'Elimina',
      destructive: true,
    })
    if (!ok) return
    try {
      await channelsApi.deleteRoom(wsId, r.id)
      queryClient.invalidateQueries({ queryKey: ['rooms', wsId] })
      queryClient.invalidateQueries({ queryKey: ['channels', wsId] })
      toast('Stanza eliminata')
    } catch (err) {
      toast(apiError(err), 'destructive')
    }
  }, [wsId, queryClient, confirm])

  return (
    <SettingsSection
      icon={Hash}
      title="Stanze"
      description="Stanze persistenti del workspace. Le pubbliche sono accessibili a tutti i membri; le private solo ai membri selezionati."
      actions={
        <Button size="sm" onClick={openNew}>
          <Plus className="h-3.5 w-3.5" /> Nuova stanza
        </Button>
      }
    >
      <QueryState
        query={roomsQuery}
        skeleton="list"
        rows={3}
        empty={{
          icon: Hash,
          title: 'Nessuna stanza',
          description: 'Creane una per dare al team un canale persistente.',
          size: 'sm',
          bordered: true,
        }}
      >
        {(rooms: Channel[]) => (
          <ul className="divide-y overflow-hidden rounded-md border">
            {rooms.map(r => (
              <li key={r.id} className="flex items-center gap-3 px-3 py-2.5 transition-colors hover:bg-accent/40 md:px-4">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-surface-2 text-muted-foreground">
                  {r.isPrivate ? <Lock className="h-4 w-4" /> : <Hash className="h-4 w-4" />}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="truncate text-sm font-medium">{r.name}</span>
                    <Badge variant={r.isPrivate ? 'outline' : 'muted'} size="sm">
                      {r.isPrivate ? `Privata · ${r.members.length} membri` : 'Pubblica'}
                    </Badge>
                    {r.voiceEnabled && (
                      <Badge variant="muted" size="sm"><Mic className="h-3 w-3" /> Voce</Badge>
                    )}
                    {r.voiceEnabled && r.screenShareEnabled && (
                      <Badge variant="muted" size="sm"><MonitorUp className="h-3 w-3" /> Schermo</Badge>
                    )}
                  </div>
                  {r.description && <p className="truncate text-caption text-muted-foreground">{r.description}</p>}
                </div>
                <div className="flex shrink-0 items-center">
                  <IconButton size="xs" label={`Modifica ${r.name}`} icon={<Edit2 />} onClick={() => openEdit(r)} />
                  <IconButton size="xs" label={`Elimina ${r.name}`} icon={<Trash2 />} className="hover:text-destructive" onClick={() => remove(r)} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </QueryState>
      <RoomDialog wsId={wsId} room={editing} members={members} open={dialogOpen} onClose={() => setDialogOpen(false)} />
    </SettingsSection>
  )
}
