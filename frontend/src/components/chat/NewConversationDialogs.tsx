import * as React from 'react'
import { Search } from 'lucide-react'
import { Channel } from '@/types'
import { channelsApi } from '@/lib/api'
import { UserAvatar } from '@/components/shared'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { toast } from '@/components/ui/toast'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { useIsOnline } from '@/store/presenceStore'
import { cn } from '@/lib/utils'

export interface ChatMember { userId: string; displayName: string; email: string; avatar?: string }

function useFiltered(members: ChatMember[], q: string) {
  const s = q.trim().toLowerCase()
  return s ? members.filter(m => m.displayName.toLowerCase().includes(s) || m.email?.toLowerCase().includes(s)) : members
}

function MemberSearch({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
      <Input value={value} onChange={e => onChange(e.target.value)} placeholder="Cerca membri" aria-label="Cerca membri" className="pl-8" />
    </div>
  )
}

/** Riga membro con presenza (selettore per singolo utente). */
function MemberLine({ m, right }: { m: ChatMember; right?: React.ReactNode }) {
  const online = useIsOnline(m.userId)
  return (
    <>
      <UserAvatar name={m.displayName} avatar={m.avatar} size="sm" presence={online ? 'online' : 'offline'} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-body">{m.displayName}</span>
        {m.email && <span className="block truncate text-2xs text-muted-foreground">{m.email}</span>}
      </span>
      {right}
    </>
  )
}

export function NewDmDialog({ wsId, members, onClose, onCreated }: {
  wsId: string; members: ChatMember[]; onClose: () => void; onCreated: (c: Channel) => void
}) {
  const [busy, setBusy] = React.useState<string | null>(null)
  const [q, setQ] = React.useState('')
  const list = useFiltered(members, q)
  const create = async (userId: string) => {
    if (busy) return
    setBusy(userId)
    try {
      onCreated(await channelsApi.createDm(wsId, userId))
    } catch (err: any) {
      toast(err.response?.data?.error ?? 'Impossibile aprire la conversazione', 'destructive')
      setBusy(null)
    }
  }
  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Nuovo messaggio diretto</DialogTitle>
          <DialogDescription>Scegli con chi vuoi parlare.</DialogDescription>
        </DialogHeader>
        <MemberSearch value={q} onChange={setQ} />
        <div className="-mx-1 max-h-80 space-y-0.5 overflow-y-auto">
          {list.map(m => (
            <button
              key={m.userId}
              type="button"
              onClick={() => create(m.userId)}
              disabled={!!busy}
              className="focus-ring flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent disabled:opacity-60"
            >
              <MemberLine m={m} right={busy === m.userId ? <span className="text-2xs text-muted-foreground">Apro…</span> : null} />
            </button>
          ))}
          {list.length === 0 && (
            <p className="py-6 text-center text-body text-muted-foreground">
              {members.length === 0 ? 'Nessun altro membro nel workspace.' : 'Nessun membro trovato.'}
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

export function NewGroupDialog({ wsId, members, onClose, onCreated }: {
  wsId: string; members: ChatMember[]; onClose: () => void; onCreated: (c: Channel) => void
}) {
  const [name, setName] = React.useState('')
  const [q, setQ] = React.useState('')
  const [selected, setSelected] = React.useState<Set<string>>(new Set())
  const [busy, setBusy] = React.useState(false)
  const list = useFiltered(members, q)

  const toggle = (id: string) => setSelected(prev => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })

  const create = async (e?: React.FormEvent) => {
    e?.preventDefault()
    if (!name.trim() || busy) return
    setBusy(true)
    try {
      onCreated(await channelsApi.createGroup(wsId, { name: name.trim(), memberIds: [...selected] }))
    } catch (err: any) {
      toast(err.response?.data?.error ?? 'Impossibile creare il gruppo', 'destructive')
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={create} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Nuovo gruppo</DialogTitle>
            <DialogDescription>Una conversazione privata tra più membri.</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="group-name">Nome del gruppo</Label>
            <Input id="group-name" value={name} onChange={e => setName(e.target.value)} placeholder="Es. Team backend" autoFocus />
          </div>
          <div className="space-y-1.5">
            <div className="flex items-baseline justify-between">
              <Label>Membri</Label>
              <span className="text-2xs text-muted-foreground">{selected.size} selezionati</span>
            </div>
            <MemberSearch value={q} onChange={setQ} />
            <div className="max-h-60 space-y-0.5 overflow-y-auto rounded-md border p-1">
              {list.map(m => {
                const on = selected.has(m.userId)
                return (
                  <label
                    key={m.userId}
                    className={cn('flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 transition-colors hover:bg-accent', on && 'bg-primary/5')}
                  >
                    <Checkbox checked={on} onCheckedChange={() => toggle(m.userId)} aria-label={m.displayName} />
                    <MemberLine m={m} />
                  </label>
                )
              })}
              {list.length === 0 && <p className="py-4 text-center text-caption text-muted-foreground">Nessun membro trovato.</p>}
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Annulla</Button>
            <Button type="submit" disabled={!name.trim()} loading={busy}>Crea gruppo</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
