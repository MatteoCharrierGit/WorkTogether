import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Users, MessagesSquare } from 'lucide-react'
import { channelsApi, workspacesApi } from '@/lib/api'
import { Channel } from '@/types'
import { useWorkspaceStore } from '@/store/workspaceStore'
import { useAuthStore } from '@/store/authStore'
import { useIsOnline } from '@/store/presenceStore'
import { useWorkspaceEvents, onWSConnect } from '@/lib/websocket'
import { setActiveChatChannel } from '@/lib/notifications'
import { RoomVoicePanel } from '@/components/voice/RoomVoicePanel'
import { EmptyState, UserAvatar } from '@/components/shared'
import { IconButton } from '@/components/ui/icon-button'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { toast } from '@/components/ui/toast'
import { cn } from '@/lib/utils'
import { ChatComposer } from '@/components/chat/ChatComposer'
import { ChannelList, channelIcon, dmPeer } from '@/components/chat/ChannelList'
import { MessageList } from '@/components/chat/MessageList'
import { TypingIndicator } from '@/components/chat/TypingIndicator'
import { NewDmDialog, NewGroupDialog, type ChatMember } from '@/components/chat/NewConversationDialogs'
import {
  useChannelMessages, appendMessages, removeMessage, syncLatestMessages, messagesKey, type UiMessage,
} from '@/components/chat/useChannelMessages'

const READ_DEBOUNCE_MS = 500

export default function ChatPage() {
  const { wsId } = useParams<{ wsId: string }>()
  const [searchParams, setSearchParams] = useSearchParams()
  const queryClient = useQueryClient()
  const workspaceName = useWorkspaceStore(s => s.current?.name)
  const me = useAuthStore(s => s.user)

  const [activeId, setActiveId] = useState<string | null>(null)
  const [dialog, setDialog] = useState<'dm' | 'group' | null>(null)
  const activeIdRef = useRef<string | null>(null)
  activeIdRef.current = activeId

  const channelsQuery = useQuery<Channel[]>({
    queryKey: ['channels', wsId],
    queryFn: () => channelsApi.list(wsId!),
    enabled: !!wsId,
  })
  const channels = useMemo(() => channelsQuery.data ?? [], [channelsQuery.data])

  const { data: members = [] } = useQuery<ChatMember[]>({
    queryKey: ['members', wsId],
    queryFn: () => workspacesApi.getMembers(wsId!),
    enabled: !!wsId,
  })

  const { query: messagesQuery, messages } = useChannelMessages(wsId, activeId)
  const active = channels.find(c => c.id === activeId) || null

  // ---------------------------------------------------------------- apertura canale

  // Non letti al momento dell'apertura → separatore "Nuovi" sul primo messaggio non letto.
  const unreadAtOpen = useRef<{ id: string; count: number } | null>(null)
  const [firstUnread, setFirstUnread] = useState<{ channelId: string; msgId: string } | null>(null)

  const openChannel = useCallback((id: string | null) => {
    if (id) {
      const c = queryClient.getQueryData<Channel[]>(['channels', wsId])?.find(x => x.id === id)
      unreadAtOpen.current = { id, count: c?.unreadCount ?? 0 }
    }
    setFirstUnread(null)
    setActiveId(id)
  }, [queryClient, wsId])

  useEffect(() => {
    const u = unreadAtOpen.current
    if (!u || u.id !== activeId || messagesQuery.isLoading || !messagesQuery.data) return
    unreadAtOpen.current = null
    const settled = messages.filter(m => !m.pending)
    if (u.count > 0 && u.count <= settled.length) {
      setFirstUnread({ channelId: u.id, msgId: settled[settled.length - u.count].id })
    }
  }, [activeId, messages, messagesQuery.isLoading, messagesQuery.data])

  // Deep-link dalle notifiche: ?c=<channelId> apre quel canale (una volta caricati).
  useEffect(() => {
    const target = searchParams.get('c')
    if (!target) return
    if (channels.some(c => c.id === target)) {
      openChannel(target)
      setSearchParams(prev => { prev.delete('c'); return prev }, { replace: true })
    }
  }, [searchParams, channels, setSearchParams, openChannel])

  // Segnala al sistema di notifiche quale canale è aperto (per non notificare ciò che si legge).
  useEffect(() => {
    setActiveChatChannel(activeId)
    return () => setActiveChatChannel(null)
  }, [activeId])

  // ---------------------------------------------------------------- segna come letto (debounce)

  const atBottomRef = useRef(true)
  const readPending = useRef(false)
  const readTimer = useRef<ReturnType<typeof setTimeout>>()

  const requestRead = useCallback(() => {
    readPending.current = true
    clearTimeout(readTimer.current)
    readTimer.current = setTimeout(() => {
      const id = activeIdRef.current
      if (!wsId || !id || !readPending.current) return
      if (document.visibilityState !== 'visible' || !atBottomRef.current) return // riprova quando torna visibile/in fondo
      readPending.current = false
      // Badge azzerato subito in cache; CHANNEL_READ (coda personale) lo conferma via Layout.
      queryClient.setQueryData<Channel[]>(['channels', wsId], old => {
        if (!old) return old
        const i = old.findIndex(c => c.id === id)
        if (i < 0 || !old[i].unreadCount) return old
        const next = old.slice()
        next[i] = { ...old[i], unreadCount: 0 }
        return next
      })
      channelsApi.markRead(wsId, id).catch(() => { readPending.current = true })
    }, READ_DEBOUNCE_MS)
  }, [wsId, queryClient])

  useEffect(() => {
    if (!activeId) return
    atBottomRef.current = true
    requestRead()
  }, [activeId, requestRead])

  useEffect(() => {
    const onVis = () => { if (document.visibilityState === 'visible' && readPending.current) requestRead() }
    document.addEventListener('visibilitychange', onVis)
    return () => {
      document.removeEventListener('visibilitychange', onVis)
      clearTimeout(readTimer.current)
    }
  }, [requestRead])

  const onAtBottomChange = useCallback((atBottom: boolean) => {
    atBottomRef.current = atBottom
    if (atBottom && readPending.current) requestRead()
  }, [requestRead])

  // ---------------------------------------------------------------- realtime

  useWorkspaceEvents(wsId, ev => {
    if (ev.type !== 'MESSAGE_CREATED' || !wsId) return
    const p = ev.payload || {}
    if (!p.channelId) return
    const own = p.authorId === me?.id
    // Canali non aperti: la cache viene riallineata alla riapertura (useChannelMessages).
    if (p.channelId !== activeIdRef.current) return
    // Messaggio già in cache (es. inviato da questa scheda, risposta della POST): niente sync.
    // I miei messaggi da un'altra scheda/dispositivo invece si sincronizzano.
    if (p.messageId && queryClient.getQueryData<{ pages: UiMessage[][] }>(messagesKey(wsId, p.channelId))
      ?.pages.some(pg => pg.some(m => m.id === p.messageId))) return
    void syncLatestMessages(queryClient, wsId, p.channelId)
    if (!own) requestRead()
  })

  // Dopo una caduta della connessione: riallinea il canale aperto, le altre cache sono vecchie.
  useEffect(() => onWSConnect(({ reconnect }) => {
    if (!reconnect || !wsId) return
    queryClient.removeQueries({
      queryKey: ['messages', wsId],
      predicate: q => q.queryKey[2] !== activeIdRef.current,
    })
    if (activeIdRef.current) void syncLatestMessages(queryClient, wsId, activeIdRef.current)
  }), [wsId, queryClient])

  // ---------------------------------------------------------------- invio

  const lastTypingSent = useRef(0)
  const onTyping = useCallback(() => {
    const id = activeIdRef.current
    if (!wsId || !id) return
    const now = Date.now()
    if (now - lastTypingSent.current > 2000) {
      lastTypingSent.current = now
      channelsApi.typing(wsId, id).catch(() => {})
    }
  }, [wsId])

  const send = useCallback(async (text: string) => {
    const channelId = activeIdRef.current
    if (!wsId || !channelId || !me) return false
    lastTypingSent.current = 0
    const tmp: UiMessage = {
      id: `tmp-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      channelId,
      authorId: me.id,
      authorName: me.displayName,
      authorAvatar: me.avatarUrl ?? me.avatar,
      content: text,
      createdAt: new Date().toISOString(),
      pending: true,
    }
    appendMessages(queryClient, wsId, channelId, [tmp])
    try {
      const real: UiMessage = await channelsApi.sendMessage(wsId, channelId, text)
      appendMessages(queryClient, wsId, channelId, [real], tmp.id)
    } catch (err: any) {
      removeMessage(queryClient, wsId, channelId, tmp.id)
      toast(err.response?.data?.error ?? 'Invio non riuscito', 'destructive')
      return activeIdRef.current === channelId ? false : undefined
    }
  }, [wsId, me, queryClient])

  const onCreated = (c: Channel) => {
    setDialog(null)
    queryClient.invalidateQueries({ queryKey: ['channels', wsId] })
    openChannel(c.id)
  }

  const otherMembers = useMemo(() => members.filter(m => m.userId !== me?.id), [members, me?.id])

  return (
    <div className="flex h-full overflow-hidden bg-background">
      <ChannelList
        className={cn('w-full border-r md:w-64 lg:w-72', activeId ? 'hidden md:flex' : 'flex')}
        channels={channels}
        isLoading={channelsQuery.isLoading}
        isError={channelsQuery.isError}
        onRetry={() => channelsQuery.refetch()}
        activeId={activeId}
        meId={me?.id}
        workspaceName={workspaceName}
        onOpen={openChannel}
        onNewDm={() => setDialog('dm')}
        onNewGroup={() => setDialog('group')}
      />

      <section className={cn('min-w-0 flex-1 flex-col', activeId ? 'flex' : 'hidden md:flex')} aria-label="Conversazione">
        {active && wsId ? (
          <>
            <ChannelHeader channel={active} meId={me?.id} onBack={() => openChannel(null)} />
            {active.type === 'ROOM' && active.voiceEnabled && (
              <div className="shrink-0 border-b px-3 py-2 sm:px-4">
                <RoomVoicePanel
                  wsId={wsId}
                  channelId={active.id}
                  channelName={active.name}
                  screenShareEnabled={active.screenShareEnabled}
                />
              </div>
            )}
            <MessageList
              channelId={active.id}
              messages={messages}
              meId={me?.id}
              isLoading={messagesQuery.isLoading}
              isError={messagesQuery.isError}
              onRetry={() => messagesQuery.refetch()}
              hasOlder={!!messagesQuery.hasNextPage}
              isFetchingOlder={messagesQuery.isFetchingNextPage}
              fetchOlder={messagesQuery.fetchNextPage}
              firstUnreadId={firstUnread?.channelId === active.id ? firstUnread.msgId : null}
              onAtBottomChange={onAtBottomChange}
              header={<ConversationStart channel={active} meId={me?.id} />}
              empty={<ConversationStart channel={active} meId={me?.id} standalone />}
            />
            <ChatComposer
              resetKey={active.id}
              onSend={send}
              onTyping={onTyping}
              placeholder={active.type === 'DM' ? `Scrivi a ${active.name}` : `Scrivi in ${active.type === 'ROOM' ? '#' : ''}${active.name}`}
              top={<TypingIndicator wsId={wsId} channelId={active.id} meId={me?.id} />}
            />
          </>
        ) : activeId && channelsQuery.isLoading ? null : (
          <EmptyState
            className="m-auto"
            icon={MessagesSquare}
            title="Seleziona una conversazione"
            description={workspaceName ? `Stanze, gruppi e messaggi diretti di ${workspaceName}.` : 'Oppure avviane una nuova.'}
            action={<Button size="sm" variant="outline" onClick={() => setDialog('dm')}>Nuovo messaggio</Button>}
          />
        )}
      </section>

      {dialog === 'dm' && wsId && (
        <NewDmDialog wsId={wsId} members={otherMembers} onClose={() => setDialog(null)} onCreated={onCreated} />
      )}
      {dialog === 'group' && wsId && (
        <NewGroupDialog wsId={wsId} members={otherMembers} onClose={() => setDialog(null)} onCreated={onCreated} />
      )}
    </div>
  )
}

function ChannelHeader({ channel: c, meId, onBack }: { channel: Channel; meId?: string; onBack: () => void }) {
  const peer = dmPeer(c, meId)
  const peerOnline = useIsOnline(peer?.userId)
  const subtitle = c.type === 'DM'
    ? (peerOnline ? 'Online' : 'Offline')
    : c.description || `${c.members.length} membri${c.type === 'ROOM' ? (c.isPrivate ? ' · stanza privata' : ' · stanza pubblica') : ' · gruppo'}`

  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b px-2 sm:px-4">
      <IconButton label="Torna alle conversazioni" icon={<ArrowLeft />} className="md:hidden" onClick={onBack} />
      {c.type === 'DM' ? (
        <UserAvatar name={peer?.displayName ?? c.name} avatarUrl={peer?.avatarUrl} avatar={peer?.avatar} size="sm" presence={peerOnline ? 'online' : 'offline'} />
      ) : (
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">{channelIcon(c)}</span>
      )}
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-body font-semibold leading-tight">{c.name}</h1>
        <p className="truncate text-2xs text-muted-foreground">{subtitle}</p>
      </div>
      {c.type !== 'DM' && <MembersPopover channel={c} />}
    </header>
  )
}

function MembersPopover({ channel: c }: { channel: Channel }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-1.5 px-2 text-muted-foreground" aria-label={`Membri (${c.members.length})`}>
          <Users className="h-4 w-4" />
          <span className="text-caption tabular-nums text-muted-foreground">{c.members.length}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 p-1">
        <p className="px-2 py-1.5 text-2xs font-semibold uppercase tracking-wide text-muted-foreground">Membri · {c.members.length}</p>
        <div className="max-h-72 overflow-y-auto">
          {c.members.map(m => <MemberItem key={m.userId} m={m} />)}
        </div>
      </PopoverContent>
    </Popover>
  )
}

function MemberItem({ m }: { m: Channel['members'][number] }) {
  const online = useIsOnline(m.userId)
  return (
    <div className="flex items-center gap-2 rounded-md px-2 py-1.5">
      <UserAvatar name={m.displayName} avatarUrl={m.avatarUrl} avatar={m.avatar} size="sm" presence={online ? 'online' : 'offline'} />
      <span className={cn('min-w-0 flex-1 truncate text-body', !online && 'text-muted-foreground')}>{m.displayName}</span>
    </div>
  )
}

/** Intestazione all'inizio della conversazione (o stato vuoto). */
function ConversationStart({ channel: c, meId, standalone }: { channel: Channel; meId?: string; standalone?: boolean }) {
  const peer = dmPeer(c, meId)
  return (
    <div className={cn('px-4 pb-2 pt-8', standalone && 'flex h-full flex-col justify-end')}>
      {c.type === 'DM' ? (
        <UserAvatar name={peer?.displayName ?? c.name} avatarUrl={peer?.avatarUrl} avatar={peer?.avatar} size="xl" />
      ) : (
        <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-muted text-muted-foreground">{channelIcon(c, 'h-6 w-6')}</span>
      )}
      <h2 className="mt-3 text-title">{c.type === 'DM' ? c.name : c.type === 'ROOM' ? `Benvenuto in #${c.name}` : c.name}</h2>
      <p className="mt-1 text-body text-muted-foreground">
        {c.type === 'DM'
          ? <>Questo è l’inizio della tua conversazione con <span className="font-medium text-foreground">{c.name}</span>.</>
          : c.description || 'Questo è l’inizio della conversazione.'}
      </p>
    </div>
  )
}
