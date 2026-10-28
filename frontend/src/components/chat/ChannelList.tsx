import * as React from 'react'
import { Hash, Lock, Users, Volume2, Search, SquarePen, UserPlus, UsersRound, MessagesSquare } from 'lucide-react'
import { Channel } from '@/types'
import { UserAvatar, EmptyState } from '@/components/shared'
import { IconButton } from '@/components/ui/icon-button'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useIsOnline, usePresenceStore } from '@/store/presenceStore'
import { cn } from '@/lib/utils'

export function channelIcon(c: Pick<Channel, 'type' | 'isPrivate'>, className = 'h-4 w-4') {
  if (c.type === 'GROUP') return <Users className={cn('shrink-0', className)} />
  return c.isPrivate ? <Lock className={cn('shrink-0', className)} /> : <Hash className={cn('shrink-0', className)} />
}

/** Per i DM: l'altro partecipante. */
export function dmPeer(c: Channel, meId?: string) {
  return c.type === 'DM' ? c.members.find(m => m.userId !== meId) ?? c.members[0] : undefined
}

/** Numero di persone in chiamata nella stanza (selettore primitivo: niente re-render inutili). */
export function useRoomCallCount(channelId: string | null | undefined, enabled = true) {
  return usePresenceStore(s => {
    if (!enabled || !channelId) return 0
    let n = 0
    for (const k in s.online) if (s.online[k].inCallChannelId === channelId) n++
    return n
  })
}

interface RowProps {
  channel: Channel
  active: boolean
  meId?: string
  onOpen: (id: string) => void
}

const ChannelRow = React.memo(function ChannelRow({ channel: c, active, meId, onOpen }: RowProps) {
  const peer = dmPeer(c, meId)
  const peerOnline = useIsOnline(peer?.userId)
  const inCall = useRoomCallCount(c.id, c.type === 'ROOM' && c.voiceEnabled)
  const unread = !active && c.unreadCount > 0

  return (
    <button
      type="button"
      onClick={() => onOpen(c.id)}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'focus-ring group flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-body transition-colors',
        active
          ? 'bg-sidebar-accent font-medium text-foreground'
          : unread
            ? 'font-semibold text-foreground hover:bg-accent'
            : 'text-muted-foreground hover:bg-accent hover:text-foreground',
      )}
    >
      {c.type === 'DM' ? (
        <UserAvatar name={peer?.displayName ?? c.name} avatar={peer?.avatar} size="xs" presence={peerOnline ? 'online' : 'offline'} />
      ) : (
        <span className="flex w-5 justify-center text-muted-foreground">{channelIcon(c)}</span>
      )}
      <span className="min-w-0 flex-1 truncate">{c.name}</span>
      {c.type === 'ROOM' && c.voiceEnabled && (
        inCall > 0 ? (
          <span
            className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-success-subtle px-1.5 text-2xs font-semibold text-success"
            aria-label={`${inCall} in chiamata`}
            title={`${inCall} in chiamata`}
          >
            <Volume2 className="h-3 w-3" /> {inCall}
          </span>
        ) : (
          <Volume2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" aria-label="Stanza vocale" />
        )
      )}
      {unread && (
        <span
          className="flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-primary px-1 text-2xs font-semibold leading-none text-primary-foreground tabular-nums"
          aria-label={`${c.unreadCount} non letti`}
        >
          {c.unreadCount > 99 ? '99+' : c.unreadCount}
        </span>
      )}
    </button>
  )
})

function Section({ title, children, count }: { title: string; children: React.ReactNode; count: number }) {
  if (count === 0) return null
  return (
    <section className="mt-4 space-y-0.5 first:mt-0">
      <h3 className="px-2 pb-1 text-2xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      {children}
    </section>
  )
}

export interface ChannelListProps {
  channels: Channel[]
  isLoading: boolean
  isError: boolean
  onRetry: () => void
  activeId: string | null
  meId?: string
  workspaceName?: string
  onOpen: (id: string) => void
  onNewDm: () => void
  onNewGroup: () => void
  className?: string
}

export function ChannelList({
  channels, isLoading, isError, onRetry, activeId, meId, workspaceName, onOpen, onNewDm, onNewGroup, className,
}: ChannelListProps) {
  const [filter, setFilter] = React.useState('')
  const q = filter.trim().toLowerCase()
  const visible = q ? channels.filter(c => c.name.toLowerCase().includes(q)) : channels
  const rooms = visible.filter(c => c.type === 'ROOM')
  const groups = visible.filter(c => c.type === 'GROUP')
  const dms = visible.filter(c => c.type === 'DM')

  const renderRows = (list: Channel[]) =>
    list.map(c => <ChannelRow key={c.id} channel={c} active={c.id === activeId} meId={meId} onOpen={onOpen} />)

  return (
    <aside className={cn('flex min-h-0 flex-col bg-surface-2', className)} aria-label="Conversazioni">
      <div className="flex h-14 shrink-0 items-center gap-2 border-b px-3">
        {/* Sotto md il titolo di sezione è già nella barra superiore mobile. */}
        <div className="min-w-0 flex-1">
          <h2 className="hidden text-heading leading-tight md:block">Chat</h2>
          {workspaceName && <p className="truncate text-caption text-muted-foreground md:text-2xs">{workspaceName}</p>}
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton label="Nuova conversazione" icon={<SquarePen />} />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={onNewDm}>
              <UserPlus className="h-4 w-4" /> Nuovo messaggio diretto
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onNewGroup}>
              <UsersRound className="h-4 w-4" /> Nuovo gruppo
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="shrink-0 px-2 pt-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={filter}
            onChange={e => setFilter(e.target.value)}
            placeholder="Cerca conversazione"
            aria-label="Cerca conversazione"
            className="h-8 bg-background pl-8 text-body"
          />
        </div>
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto p-2">
        {isLoading ? (
          <div className="space-y-2 p-1" aria-busy="true">
            {[0, 1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-6 w-full" />)}
          </div>
        ) : isError ? (
          <div className="flex flex-col items-center gap-2 p-4 text-center">
            <p className="text-caption text-muted-foreground">Impossibile caricare le conversazioni.</p>
            <Button size="sm" variant="outline" onClick={onRetry}>Riprova</Button>
          </div>
        ) : channels.length === 0 ? (
          <EmptyState
            size="sm"
            icon={MessagesSquare}
            title="Nessuna conversazione"
            description="Avvia un messaggio diretto o crea un gruppo."
            action={<Button size="sm" onClick={onNewDm}><UserPlus className="h-4 w-4" /> Nuovo messaggio</Button>}
          />
        ) : visible.length === 0 ? (
          <p className="px-2 py-4 text-center text-caption text-muted-foreground">Nessun risultato per “{filter}”.</p>
        ) : (
          <>
            <Section title="Stanze" count={rooms.length}>{renderRows(rooms)}</Section>
            <Section title="Gruppi" count={groups.length}>{renderRows(groups)}</Section>
            <Section title="Messaggi diretti" count={dms.length}>{renderRows(dms)}</Section>
          </>
        )}
      </nav>
    </aside>
  )
}
