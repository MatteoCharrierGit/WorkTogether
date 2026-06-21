import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { channelsApi, workspacesApi } from '@/lib/api'
import { Channel, ChatMessage, WsEvent } from '@/types'
import { useWorkspaceStore } from '@/store/workspaceStore'
import { useAuthStore } from '@/store/authStore'
import { usePresenceStore } from '@/store/presenceStore'
import { subscribeWorkspace } from '@/lib/websocket'
import { setActiveChatChannel } from '@/lib/notifications'
import { UserAvatar } from '@/components/UserAvatar'
import { RoomVoicePanel } from '@/components/voice/RoomVoicePanel'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { toast } from '@/components/ui/toast'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Hash, Lock, MessageCircle, Users, Plus, Send, Check, UserPlus, UsersRound, ArrowLeft, Volume2,
} from 'lucide-react'

interface Member { userId: string; displayName: string; email: string; avatar?: string }

function channelIcon(c: Channel) {
  if (c.type === 'DM') return <MessageCircle className="h-3.5 w-3.5 shrink-0" />
  if (c.type === 'GROUP') return <Users className="h-3.5 w-3.5 shrink-0" />
  return c.isPrivate ? <Lock className="h-3.5 w-3.5 shrink-0" /> : <Hash className="h-3.5 w-3.5 shrink-0" />
}

export default function ChatPage() {
  const { wsId } = useParams<{ wsId: string }>()
  const [searchParams, setSearchParams] = useSearchParams()
  const queryClient = useQueryClient()
  const workspace = useWorkspaceStore(s => s.current)
  const me = useAuthStore(s => s.user)

  const [activeId, setActiveId] = useState<string | null>(null)
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [dialog, setDialog] = useState<'dm' | 'group' | null>(null)
  const [typingNames, setTypingNames] = useState<Record<string, number>>({}) // name -> expiry ts

  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const lastTypingSent = useRef(0)
  const activeIdRef = useRef<string | null>(null)
  activeIdRef.current = activeId

  const { data: channels = [] } = useQuery<Channel[]>({
    queryKey: ['channels', wsId],
    queryFn: () => channelsApi.list(wsId!),
    enabled: !!wsId,
  })

  const { data: members = [] } = useQuery<Member[]>({
    queryKey: ['members', wsId],
    queryFn: () => workspacesApi.getMembers(wsId!),
    enabled: !!wsId,
  })

  const { data: messages = [] } = useQuery<ChatMessage[]>({
    queryKey: ['messages', wsId, activeId],
    queryFn: () => channelsApi.getMessages(wsId!, activeId!),
    enabled: !!wsId && !!activeId,
  })

  const active = channels.find(c => c.id === activeId) || null

  // Deep-link dalle notifiche: ?c=<channelId> apre quel canale (una volta caricati).
  useEffect(() => {
    const target = searchParams.get('c')
    if (!target) return
    if (channels.some(c => c.id === target)) {
      setActiveId(target)
      setSearchParams(prev => { prev.delete('c'); return prev }, { replace: true })
    }
  }, [searchParams, channels, setSearchParams])

  // Segnala al sistema di notifiche quale canale è aperto (per non notificare ciò che si legge).
  useEffect(() => {
    setActiveChatChannel(activeId)
    return () => setActiveChatChannel(null)
  }, [activeId])

  // Auto-resize della textarea (stesso pattern della chat Akari).
  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 160) + 'px'
  }, [input])

  // Scroll in fondo all'arrivo di nuovi messaggi.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, activeId])

  // Segna come letto quando si apre un canale (e quando arrivano nuovi messaggi mentre è aperto).
  useEffect(() => {
    if (!wsId || !activeId) return
    channelsApi.markRead(wsId, activeId)
      .then(() => queryClient.invalidateQueries({ queryKey: ['channels', wsId] }))
      .catch(() => {})
  }, [wsId, activeId, messages.length, queryClient])

  // Realtime: un solo handler per il workspace (coesiste con quello di Layout).
  useEffect(() => {
    if (!wsId) return
    const unsub = subscribeWorkspace(wsId, (ev: WsEvent) => {
      const p = ev.payload || {}
      switch (ev.type) {
        case 'MESSAGE_CREATED':
          queryClient.invalidateQueries({ queryKey: ['channels', wsId] })
          if (p.channelId && p.channelId === activeIdRef.current) {
            queryClient.invalidateQueries({ queryKey: ['messages', wsId, p.channelId] })
          }
          break
        case 'CHANNEL_CREATED':
        case 'CHANNEL_UPDATED':
        case 'CHANNEL_DELETED':
        case 'CHANNEL_READ':
          queryClient.invalidateQueries({ queryKey: ['channels', wsId] })
          break
        case 'TYPING':
          if (p.channelId === activeIdRef.current && p.userId !== me?.id && p.userName) {
            setTypingNames(prev => ({ ...prev, [p.userName]: Date.now() + 4000 }))
          }
          break
      }
    })
    return unsub
  }, [wsId, queryClient, me?.id])

  // Pulisce gli indicatori "sta scrivendo" scaduti.
  useEffect(() => {
    const t = setInterval(() => {
      setTypingNames(prev => {
        const now = Date.now()
        const next: Record<string, number> = {}
        let changed = false
        for (const [name, exp] of Object.entries(prev)) {
          if (exp > now) next[name] = exp
          else changed = true
        }
        return changed ? next : prev
      })
    }, 1500)
    return () => clearInterval(t)
  }, [])

  // Azzera typing quando si cambia canale.
  useEffect(() => { setTypingNames({}) }, [activeId])

  const onInputChange = (v: string) => {
    setInput(v)
    if (!wsId || !activeId) return
    const now = Date.now()
    if (now - lastTypingSent.current > 2000) {
      lastTypingSent.current = now
      channelsApi.typing(wsId, activeId).catch(() => {})
    }
  }

  const send = async () => {
    const text = input.trim()
    if (!text || sending || !wsId || !activeId) return
    setInput('')
    setSending(true)
    try {
      await channelsApi.sendMessage(wsId, activeId, text)
      await queryClient.invalidateQueries({ queryKey: ['messages', wsId, activeId] })
      queryClient.invalidateQueries({ queryKey: ['channels', wsId] })
    } catch (err: any) {
      toast(err.response?.data?.error ?? 'Invio non riuscito', 'destructive')
      setInput(text)
    } finally {
      setSending(false)
    }
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
  }

  const openChannel = (c: Channel) => { setActiveId(c.id) }

  const onCreated = (c: Channel) => {
    setDialog(null)
    queryClient.invalidateQueries({ queryKey: ['channels', wsId] })
    setActiveId(c.id)
  }

  const rooms = channels.filter(c => c.type === 'ROOM')
  const dms = channels.filter(c => c.type === 'DM')
  const groups = channels.filter(c => c.type === 'GROUP')

  const typingLabel = useMemo(() => {
    const names = Object.keys(typingNames)
    if (names.length === 0) return null
    if (names.length === 1) return `${names[0]} sta scrivendo…`
    return `${names.length} persone stanno scrivendo…`
  }, [typingNames])

  return (
    <div className="flex h-full overflow-hidden">
      {/* Lista conversazioni (a tutta larghezza su mobile; affianca il thread da md in su) */}
      <div className={cn('w-full md:w-64 shrink-0 border-r flex-col', activeId ? 'hidden md:flex' : 'flex')}>
        <div className="p-3 border-b flex items-center justify-between">
          <h2 className="text-sm font-semibold">Chat</h2>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="icon" variant="ghost" className="h-7 w-7">
                <Plus className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setDialog('dm')}>
                <UserPlus className="h-4 w-4" /> Nuovo messaggio diretto
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setDialog('group')}>
                <UsersRound className="h-4 w-4" /> Nuovo gruppo
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-3">
          <ChannelSection title="Stanze" channels={rooms} activeId={activeId} onOpen={openChannel} meId={me?.id} />
          <ChannelSection title="Gruppi" channels={groups} activeId={activeId} onOpen={openChannel} meId={me?.id} />
          <ChannelSection title="Messaggi diretti" channels={dms} activeId={activeId} onOpen={openChannel} meId={me?.id} />
          {channels.length === 0 && (
            <p className="px-2 py-3 text-xs text-muted-foreground text-center">
              Nessuna conversazione. Avviane una con il pulsante +.
            </p>
          )}
        </div>
      </div>

      {/* Thread (a tutta larghezza su mobile quando un canale è aperto) */}
      <div className={cn('flex-1 flex-col min-w-0', activeId ? 'flex' : 'hidden md:flex')}>
        {active ? (
          <>
            <div className="px-6 py-3 border-b shrink-0">
              <h1 className="text-base font-semibold flex items-center gap-2">
                <Button
                  size="icon" variant="ghost"
                  className="h-7 w-7 -ml-1.5 md:hidden shrink-0"
                  onClick={() => setActiveId(null)}
                  aria-label="Torna alla lista"
                >
                  <ArrowLeft className="h-4 w-4" />
                </Button>
                {channelIcon(active)} {active.name}
              </h1>
              <p className="text-xs text-muted-foreground">
                {active.type === 'DM'
                  ? 'Messaggio diretto'
                  : `${active.members.length} membri${active.type === 'ROOM' ? (active.isPrivate ? ' · privata' : ' · pubblica') : ''}`}
              </p>
              {active.type === 'ROOM' && active.voiceEnabled && (
                <div className="mt-2.5">
                  <RoomVoicePanel
                    wsId={wsId!}
                    channelId={active.id}
                    channelName={active.name}
                    screenShareEnabled={active.screenShareEnabled}
                  />
                </div>
              )}
            </div>

            <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
              {messages.length === 0 && (
                <div className="flex flex-col items-center justify-center h-full text-center gap-2 text-muted-foreground">
                  <MessageCircle className="h-8 w-8 opacity-50" />
                  <p className="text-sm">Nessun messaggio. Scrivi il primo!</p>
                </div>
              )}
              {messages.map((m, i) => {
                const prev = messages[i - 1]
                const grouped = prev && prev.authorId === m.authorId &&
                  new Date(m.createdAt).getTime() - new Date(prev.createdAt).getTime() < 5 * 60 * 1000
                return (
                  <MessageRow key={m.id} msg={m} mine={m.authorId === me?.id} grouped={!!grouped} />
                )
              })}
            </div>

            <div className="border-t px-3 pt-1 pb-3 shrink-0">
              <div className="h-4 px-2 text-[11px] text-muted-foreground italic">
                {typingLabel}
              </div>
              <div className="flex items-end gap-2">
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={e => onInputChange(e.target.value)}
                  onKeyDown={onKeyDown}
                  rows={1}
                  placeholder="Scrivi un messaggio…  (Invio per inviare, Shift+Invio a capo)"
                  className="flex-1 resize-none rounded-lg border bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring max-h-40"
                />
                <Button onClick={send} disabled={sending || !input.trim()} size="icon" className="h-10 w-10 shrink-0">
                  <Send className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-center gap-2 text-muted-foreground">
            <MessageCircle className="h-10 w-10 opacity-50" />
            <p className="text-sm">Seleziona una conversazione o avviane una nuova.</p>
            <p className="text-xs">{workspace?.name}</p>
          </div>
        )}
      </div>

      {dialog === 'dm' && (
        <DmDialog
          wsId={wsId!}
          members={members.filter(m => m.userId !== me?.id)}
          onClose={() => setDialog(null)}
          onCreated={onCreated}
        />
      )}
      {dialog === 'group' && (
        <GroupDialog
          wsId={wsId!}
          members={members.filter(m => m.userId !== me?.id)}
          onClose={() => setDialog(null)}
          onCreated={onCreated}
        />
      )}
    </div>
  )
}

function ChannelSection({ title, channels, activeId, onOpen, meId }: {
  title: string; channels: Channel[]; activeId: string | null; onOpen: (c: Channel) => void; meId?: string
}) {
  const online = usePresenceStore(s => s.online)
  if (channels.length === 0) return null
  return (
    <div>
      <p className="px-2 py-1 text-[11px] font-medium text-muted-foreground uppercase tracking-wide">{title}</p>
      <div className="space-y-0.5">
        {channels.map(c => {
          // DM: stato online dell'altro partecipante. ROOM: quanti sono in chiamata qui.
          const otherId = c.type === 'DM' ? c.members.find(m => m.userId !== meId)?.userId : undefined
          const dmOnline = otherId ? !!online[otherId] : false
          const roomInCall = c.type === 'ROOM'
            ? Object.values(online).filter(e => e.inCallChannelId === c.id).length : 0
          return (
            <button
              key={c.id}
              onClick={() => onOpen(c)}
              className={cn(
                'group flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-sm transition-colors text-left',
                activeId === c.id ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50',
              )}
            >
              <span className="relative flex shrink-0">
                {channelIcon(c)}
                {dmOnline && (
                  <span className="absolute -bottom-1 -right-1 h-2 w-2 rounded-full bg-green-500 ring-2 ring-background" />
                )}
              </span>
              <span className="flex-1 truncate">{c.name}</span>
              {roomInCall > 0 && (
                <span className="shrink-0 inline-flex items-center gap-0.5 rounded-full bg-green-500/15 text-green-600 text-[10px] font-semibold px-1.5 h-[18px]">
                  <Volume2 className="h-3 w-3" />{roomInCall}
                </span>
              )}
              {c.unreadCount > 0 && (
                <span className="shrink-0 rounded-full bg-primary text-primary-foreground text-[10px] font-semibold min-w-[18px] h-[18px] px-1 flex items-center justify-center">
                  {c.unreadCount > 99 ? '99+' : c.unreadCount}
                </span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function MessageRow({ msg, mine, grouped }: { msg: ChatMessage; mine: boolean; grouped: boolean }) {
  const time = new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  return (
    <div className={cn('flex gap-3', grouped && 'mt-0.5')}>
      <div className="w-8 shrink-0">
        {!grouped && <UserAvatar name={msg.authorName} avatar={msg.authorAvatar} className="h-8 w-8" />}
      </div>
      <div className="min-w-0 flex-1">
        {!grouped && (
          <div className="flex items-baseline gap-2">
            <span className="text-sm font-medium">{mine ? 'Tu' : msg.authorName}</span>
            <span className="text-[11px] text-muted-foreground">{time}</span>
          </div>
        )}
        <p className="text-sm whitespace-pre-wrap break-words">{msg.content}</p>
      </div>
    </div>
  )
}

function DmDialog({ wsId, members, onClose, onCreated }: {
  wsId: string; members: Member[]; onClose: () => void; onCreated: (c: Channel) => void
}) {
  const online = usePresenceStore(s => s.online)
  const [busy, setBusy] = useState(false)
  const create = async (userId: string) => {
    if (busy) return
    setBusy(true)
    try {
      const c = await channelsApi.createDm(wsId, userId)
      onCreated(c)
    } catch (err: any) {
      toast(err.response?.data?.error ?? 'Errore', 'destructive')
      setBusy(false)
    }
  }
  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Nuovo messaggio diretto</DialogTitle></DialogHeader>
        <div className="max-h-80 overflow-y-auto space-y-0.5">
          {members.map(m => (
            <button
              key={m.userId}
              onClick={() => create(m.userId)}
              disabled={busy}
              className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-sm hover:bg-accent/60 transition-colors text-left"
            >
              <span className="relative shrink-0">
                <UserAvatar name={m.displayName} avatar={m.avatar} className="h-7 w-7" />
                {online[m.userId] && (
                  <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-green-500 ring-2 ring-background" />
                )}
              </span>
              <span className="flex-1 truncate">{m.displayName}</span>
            </button>
          ))}
          {members.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-4">Nessun altro membro nel workspace.</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function GroupDialog({ wsId, members, onClose, onCreated }: {
  wsId: string; members: Member[]; onClose: () => void; onCreated: (c: Channel) => void
}) {
  const [name, setName] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)

  const toggle = (id: string) => setSelected(prev => {
    const next = new Set(prev)
    next.has(id) ? next.delete(id) : next.add(id)
    return next
  })

  const create = async () => {
    if (!name.trim() || busy) return
    setBusy(true)
    try {
      const c = await channelsApi.createGroup(wsId, { name: name.trim(), memberIds: [...selected] })
      onCreated(c)
    } catch (err: any) {
      toast(err.response?.data?.error ?? 'Errore', 'destructive')
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Nuovo gruppo</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Nome del gruppo</Label>
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="Es: Team backend" autoFocus />
          </div>
          <div className="space-y-1.5">
            <Label>Membri</Label>
            <div className="max-h-60 overflow-y-auto space-y-0.5 rounded-md border p-1">
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
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>Annulla</Button>
            <Button onClick={create} disabled={!name.trim() || busy}>Crea</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
