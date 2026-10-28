import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { aiApi, aiAdminApi, workspacesApi } from '@/lib/api'
import { aiStream, type AiStreamErrorInfo } from '@/lib/aiStream'
import { AiConversation, AiMessage, AiConversationScope, AiMe } from '@/types'
import { useWorkspaceStore } from '@/store/workspaceStore'
import { useAuthStore } from '@/store/authStore'
import { useWorkspaceEvents } from '@/lib/websocket'
import { markdownToHtml } from '@/lib/markdown'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { toast } from '@/components/ui/toast'
import { Callout, UserAvatar, useConfirm } from '@/components/shared'
import { ChatComposer, type ChatComposerHandle } from '@/components/chat/ChatComposer'
import {
  Flower2, SquarePen, Trash2, Lock, Users, Wrench, Terminal, X, PanelLeft, MessageSquareText, Cpu, Timer,
} from 'lucide-react'

interface PendingAction { id: string; tool: string; summary: string }

const HELP_TEXT = `**Comandi disponibili**
- \`/help\` — mostra questo elenco
- \`/new [titolo]\` — apre una nuova conversazione
- \`/context\` — stato del contesto (token, riassunto, soglia)
- \`/compact\` — riassume subito i messaggi vecchi
- \`/memory\` — mostra la memoria del workspace
- \`/model\` — mostra il modello che usi (lo assegna l'amministratore)
- \`/clear\` — svuota la conversazione corrente`

const TOOL_LABELS: Record<string, string> = {
  list_elements: 'Leggo gli elementi',
  get_element: 'Leggo un elemento',
  list_files: 'Leggo i file',
  read_file: 'Leggo un file',
  list_tags: 'Leggo i tag',
  list_members: 'Leggo i membri',
  create_element: 'Creo un elemento',
  update_element: 'Aggiorno un elemento',
  create_tag: 'Creo un tag',
  create_text_file: 'Creo un file',
  write_file: 'Scrivo un file',
  move_file: 'Sposto un file',
  rename_file: 'Rinomino un file',
  create_folder: 'Creo una cartella',
  rename_folder: 'Rinomino una cartella',
  move_folder: 'Sposto una cartella',
  send_email: 'Invio una email',
  remember: 'Aggiorno la memoria',
  delete_element: 'Elimino un elemento',
  delete_file: 'Elimino un file',
  delete_tag: 'Elimino un tag',
  delete_folder: 'Elimino una cartella',
}

const SUGGESTIONS = [
  'Quali task sono in ritardo?',
  'Riassumi le attività della settimana',
  'Crea un task per preparare la demo di venerdì',
]

export default function AssistantPage() {
  const { wsId } = useParams<{ wsId: string }>()
  const queryClient = useQueryClient()
  const confirm = useConfirm()
  const workspaceName = useWorkspaceStore(s => s.current?.name)
  const me = useAuthStore(s => s.user)

  const { data: members = [] } = useQuery<{ userId: string; displayName: string; avatar?: string }[]>({
    queryKey: ['members', wsId],
    queryFn: () => workspacesApi.getMembers(wsId!),
    enabled: !!wsId,
  })

  // Risolve nome+foto dell'autore di un messaggio (dai membri, con fallback all'utente corrente).
  const authorOf = useCallback((userId?: string | null) => {
    const m = members.find(x => x.userId === userId)
    if (m) return { name: m.displayName, avatar: m.avatar }
    if (userId && me && userId === me.id) return { name: me.displayName, avatar: me.avatar }
    return { name: undefined, avatar: undefined }
  }, [members, me])

  const [scope, setScope] = useState<AiConversationScope>('PRIVATE')
  const [activeId, setActiveId] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [draftUser, setDraftUser] = useState<string | null>(null)
  const [draftAssistant, setDraftAssistant] = useState('')
  const [toolActivity, setToolActivity] = useState<string[]>([])
  const [pending, setPending] = useState<PendingAction[] | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [listOpen, setListOpen] = useState(false)
  // Limiti d'uso (429): messaggio + istante fino a cui l'invio resta bloccato.
  const [limit, setLimit] = useState<{ message: string; until: number } | null>(null)
  const [now, setNow] = useState(() => Date.now())

  // Modello effettivo dell'utente: deciso dall'admin, qui solo in lettura.
  const meQuery = useQuery<AiMe>({
    queryKey: ['ai-me', wsId],
    queryFn: () => aiAdminApi.me(wsId!),
    enabled: !!wsId,
    staleTime: 60_000,
  })
  const aiMe = meQuery.data

  useEffect(() => {
    if (!limit) return
    if (limit.until <= Date.now()) { setLimit(null); return }
    const t = window.setInterval(() => {
      const n = Date.now()
      setNow(n)
      if (n >= limit.until) setLimit(null)
    }, 1000)
    return () => window.clearInterval(t)
  }, [limit])
  const cooldownSec = limit ? Math.max(0, Math.ceil((limit.until - now) / 1000)) : 0
  const cooldown = cooldownSec > 0

  const scrollRef = useRef<HTMLDivElement>(null)
  const composerRef = useRef<ChatComposerHandle>(null)

  const conversationsQuery = useQuery<AiConversation[]>({
    queryKey: ['ai-conversations', wsId, scope],
    queryFn: () => aiApi.listConversations(wsId!, scope),
    enabled: !!wsId,
  })
  const conversations = conversationsQuery.data ?? []

  const messagesQuery = useQuery<AiMessage[]>({
    queryKey: ['ai-messages', wsId, activeId],
    queryFn: () => aiApi.getMessages(wsId!, activeId!),
    enabled: !!wsId && !!activeId,
  })
  const messages = useMemo(() => messagesQuery.data ?? [], [messagesQuery.data])

  const active = conversations.find(c => c.id === activeId)

  // Quando si cambia ambito, deseleziona la conversazione attiva.
  useEffect(() => { setActiveId(null) }, [scope])

  // Realtime per le chat CONDIVISE: lo streaming SSE arriva solo a chi invia il
  // messaggio, quindi gli altri partecipanti vengono avvisati via WebSocket
  // (evento AI_MESSAGE) e ri-fetchano la conversazione. Chi sta inviando (sending)
  // ignora l'evento per non interferire con lo stream locale in corso.
  const sendingRef = useRef(sending)
  const activeIdRef = useRef(activeId)
  sendingRef.current = sending
  activeIdRef.current = activeId
  useWorkspaceEvents(wsId, ev => {
    if (ev.type !== 'AI_MESSAGE') return
    // Aggiorna sempre la lista (titolo/ordine) delle conversazioni condivise.
    queryClient.invalidateQueries({ queryKey: ['ai-conversations', wsId, 'SHARED'] })
    const convId = ev.payload?.conversationId
    if (convId && convId === activeIdRef.current && !sendingRef.current) {
      queryClient.invalidateQueries({ queryKey: ['ai-messages', wsId, convId] })
    }
  })

  // Scroll automatico in fondo.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, draftAssistant, draftUser, pending, notice, toolActivity.length])

  const resetDraft = () => { setDraftUser(null); setDraftAssistant(''); setToolActivity([]); setPending(null); setNotice(null) }
  const newChat = () => { setActiveId(null); resetDraft(); setListOpen(false); composerRef.current?.focus() }
  const openConversation = (id: string) => { setActiveId(id); resetDraft(); setListOpen(false) }

  // Gestione dei comandi slash. /help e /new sono lato client; gli altri passano dal backend.
  const handleCommand = async (raw: string) => {
    const parts = raw.slice(1).trim().split(/\s+/)
    const cmd = (parts.shift() || '').toLowerCase()
    const arg = parts.join(' ').trim()

    if (cmd === '' || cmd === 'help') { setNotice(HELP_TEXT); return }
    if (cmd === 'new') {
      if (!wsId) return
      if (arg) {
        try {
          const c: AiConversation = await aiApi.createConversation(wsId, { scope, title: arg })
          resetDraft(); setActiveId(c.id)
          queryClient.invalidateQueries({ queryKey: ['ai-conversations', wsId, scope] })
        } catch (err: any) {
          toast(err.response?.data?.error ?? 'Impossibile creare la conversazione', 'destructive')
        }
      } else {
        newChat()
      }
      return
    }

    if (!wsId || !activeId) {
      setNotice(`Apri o avvia una conversazione per usare \`/${cmd}\`.`)
      return
    }
    try {
      const res = await aiApi.command(wsId, activeId, cmd, arg)
      setNotice(res.message)
      if (res.refreshMessages) queryClient.invalidateQueries({ queryKey: ['ai-messages', wsId, activeId] })
      if (res.refreshConversations) queryClient.invalidateQueries({ queryKey: ['ai-conversations', wsId, scope] })
      if (cmd === 'model' || cmd === 'compact') queryClient.invalidateQueries({ queryKey: ['ai-me', wsId] })
    } catch (err: any) {
      const data = err.response?.data
      const msg = data?.error ?? 'Comando non riuscito'
      if (!handleLimit(msg, { status: err.response?.status, retryAfter: data?.retryAfter, code: data?.code })) {
        toast(msg, 'destructive')
      }
    }
  }

  // Errori di limite d'uso (429/503 con Retry-After): Callout con conto alla rovescia invece del toast.
  const handleLimit = (m: string, info: AiStreamErrorInfo) => {
    if ((info.status === 429 || info.status === 503) && info.retryAfter) {
      const n = Date.now()
      setNow(n)
      setLimit({ message: m, until: n + info.retryAfter * 1000 })
      return true
    }
    return false
  }

  const streamHandlers = (convId: string) => ({
    onToken: (t: string) => setDraftAssistant(p => p + t),
    onTool: (name: string) => setToolActivity(a => [...a, name]),
    onConfirm: (actions: PendingAction[]) => { setPending(actions); setSending(false) },
    onDone: async () => {
      await queryClient.invalidateQueries({ queryKey: ['ai-messages', wsId, convId] })
      queryClient.invalidateQueries({ queryKey: ['ai-conversations', wsId, scope] })
      queryClient.invalidateQueries({ queryKey: ['ai-me', wsId] })
      setSending(false); resetDraft()
    },
    onError: async (m: string, info: AiStreamErrorInfo) => {
      if (!handleLimit(m, info)) toast(m, 'destructive')
      await queryClient.invalidateQueries({ queryKey: ['ai-messages', wsId, convId] })
      setSending(false); resetDraft()
    },
  })

  const resolve = async (ok: boolean) => {
    if (!wsId || !activeId) return
    const prev = pending
    setPending(null); setToolActivity([]); setSending(true)
    await aiStream(`/workspaces/${wsId}/ai/conversations/${activeId}/confirm`, { confirm: ok }, {
      ...streamHandlers(activeId),
      // Se la conferma viene bloccata dai limiti, le azioni restano in attesa: ripropone il riquadro.
      onError: async (m: string, info: AiStreamErrorInfo) => {
        if (!handleLimit(m, info)) toast(m, 'destructive')
        setSending(false)
        if (info.status === 429 || info.status === 503) setPending(prev)
        else await queryClient.invalidateQueries({ queryKey: ['ai-messages', wsId, activeId] })
      },
    })
  }

  const removeConversation = async (c: AiConversation) => {
    if (!wsId) return
    const ok = await confirm({
      title: 'Eliminare la conversazione?',
      description: `“${c.title || 'Nuova conversazione'}” verrà eliminata definitivamente.`,
      confirmLabel: 'Elimina',
      destructive: true,
    })
    if (!ok) return
    try {
      await aiApi.deleteConversation(wsId, c.id)
      if (activeId === c.id) setActiveId(null)
      queryClient.invalidateQueries({ queryKey: ['ai-conversations', wsId, scope] })
    } catch (err: any) {
      toast(err.response?.data?.error ?? 'Impossibile eliminare la conversazione', 'destructive')
    }
  }

  const send = async (text: string) => {
    if (sending || cooldown || !wsId) return false

    // I comandi slash non vengono inviati al modello.
    if (text.startsWith('/')) { await handleCommand(text); return }

    let convId = activeId
    if (!convId) {
      try {
        const conv: AiConversation = await aiApi.createConversation(wsId, { scope })
        convId = conv.id
        setActiveId(convId)
        queryClient.invalidateQueries({ queryKey: ['ai-conversations', wsId, scope] })
      } catch (err: any) {
        toast(err.response?.data?.error ?? 'Impossibile creare la conversazione', 'destructive')
        return false
      }
    }

    setDraftUser(text)
    setDraftAssistant('')
    setToolActivity([])
    setPending(null)
    setNotice(null)
    setLimit(null)
    setSending(true)

    const id = convId
    await aiStream(`/workspaces/${wsId}/ai/conversations/${id}/messages`, { text }, {
      ...streamHandlers(id),
      onError: async (m: string, info: AiStreamErrorInfo) => {
        if (handleLimit(m, info)) {
          // Rifiutato prima di salvare: il testo resta visibile solo come bozza annullata.
          setSending(false); resetDraft()
          return
        }
        toast(m, 'destructive')
        await queryClient.invalidateQueries({ queryKey: ['ai-messages', wsId, id] })
        setSending(false); resetDraft()
      },
    })
  }

  const conversationList = (
    <ConversationList
      scope={scope}
      onScope={setScope}
      conversations={conversations}
      isLoading={conversationsQuery.isLoading}
      isError={conversationsQuery.isError}
      onRetry={() => conversationsQuery.refetch()}
      activeId={activeId}
      onOpen={openConversation}
      onNew={newChat}
      onDelete={removeConversation}
    />
  )

  const isEmpty = !activeId ? !draftUser : messages.length === 0 && !draftUser && !messagesQuery.isLoading && !messagesQuery.isError

  return (
    <div className="flex h-full overflow-hidden bg-background">
      {/* Conversazioni: colonna fissa da md in su, Sheet su mobile */}
      <aside className="hidden w-64 shrink-0 flex-col border-r bg-surface-2 md:flex lg:w-72" aria-label="Conversazioni con Akari">
        {conversationList}
      </aside>
      <Sheet open={listOpen} onOpenChange={setListOpen}>
        <SheetContent side="left" className="p-0" hideClose>
          <SheetHeader className="sr-only"><SheetTitle>Conversazioni con Akari</SheetTitle></SheetHeader>
          {conversationList}
        </SheetContent>
      </Sheet>

      <section className="flex min-w-0 flex-1 flex-col" aria-label="Conversazione con Akari">
        <header className="flex h-14 shrink-0 items-center gap-2 border-b px-2 sm:px-4">
          <IconButton label="Conversazioni" icon={<PanelLeft />} className="md:hidden" onClick={() => setListOpen(true)} />
          <AkariAvatar />
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-body font-semibold leading-tight">{active?.title || 'Akari'}</h1>
            <p className="flex items-center gap-1 truncate text-2xs text-muted-foreground">
              {scope === 'PRIVATE' ? <Lock className="h-3 w-3" /> : <Users className="h-3 w-3" />}
              {scope === 'PRIVATE' ? 'Conversazione personale' : 'Conversazione condivisa'}
              {workspaceName && <> · {workspaceName}</>}
            </p>
          </div>
          {aiMe?.model && (
            <Badge
              variant="muted"
              size="sm"
              className="hidden max-w-[40%] gap-1 sm:inline-flex"
              title={aiMe.modelSource === 'USER' ? 'Modello assegnato dall\'amministratore' : 'Modello predefinito del workspace'}
            >
              <Cpu className="h-3 w-3 shrink-0" />
              <span className="truncate">
                Modello: {aiMe.model}
                {aiMe.modelSource === 'USER' ? ' (assegnato dall\'amministratore)' : ''}
              </span>
            </Badge>
          )}
          <IconButton label="Nuova chat" icon={<SquarePen />} className="md:hidden" onClick={newChat} />
        </header>

        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto" role="log" aria-live="polite" aria-label="Messaggi">
          <div className="mx-auto w-full max-w-3xl space-y-5 px-3 py-6 sm:px-6">
            {activeId && messagesQuery.isLoading && <MessagesSkeleton />}
            {activeId && messagesQuery.isError && (
              <Callout
                variant="destructive"
                title="Impossibile caricare la conversazione"
                action={<Button size="sm" variant="outline" onClick={() => messagesQuery.refetch()}>Riprova</Button>}
              />
            )}

            {isEmpty && (
              <div className="flex flex-col items-center py-10 text-center">
                <AkariAvatar size="lg" />
                <h2 className="mt-4 text-title">Ciao, sono Akari</h2>
                <p className="mt-1 max-w-md text-body text-muted-foreground">
                  Chiedimi qualcosa sul workspace: posso rispondere a domande e creare o gestire task, eventi, storie, file e tag.
                </p>
                <div className="mt-6 flex flex-wrap justify-center gap-2">
                  {SUGGESTIONS.map(s => (
                    <Button key={s} size="sm" variant="outline" className="font-normal" onClick={() => send(s)} disabled={sending || cooldown}>
                      {s}
                    </Button>
                  ))}
                </div>
                <p className="mt-4 text-caption text-muted-foreground">
                  Scrivi <code className="rounded-sm bg-muted px-1 font-mono">/help</code> per i comandi.
                </p>
                {aiMe?.model && (
                  <p className="mt-1 text-caption text-muted-foreground">
                    Modello: <span className="font-mono">{aiMe.model}</span>
                    {aiMe.modelSource === 'USER' ? ' (assegnato dall\'amministratore)' : ' (predefinito del workspace)'}
                    {' · '}{aiMe.usageToday.requests}/{aiMe.limits.perDay} richieste oggi
                  </p>
                )}
              </div>
            )}

            {messages.map(m => {
              const a = m.role === 'USER' ? authorOf(m.authorUserId) : undefined
              return <MessageBubble key={m.id} role={m.role} content={m.content} name={a?.name} avatar={a?.avatar} />
            })}

            {draftUser && <MessageBubble role="USER" content={draftUser} name={me?.displayName} avatar={me?.avatar} />}
            {draftUser && toolActivity.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pl-10" aria-label="Azioni di Akari">
                {toolActivity.map((t, i) => (
                  <Badge key={i} variant="muted" size="sm" className="gap-1">
                    <Wrench className="h-3 w-3" /> {TOOL_LABELS[t] || t}
                  </Badge>
                ))}
              </div>
            )}
            {draftUser && (draftAssistant || sending) && (
              <MessageBubble role="ASSISTANT" content={draftAssistant} streaming={sending} />
            )}

            {notice && (
              <Callout
                variant="neutral"
                icon={Terminal}
                title="Comando"
                className="ml-10"
                action={<IconButton label="Chiudi" icon={<X />} size="xs" onClick={() => setNotice(null)} />}
              >
                <div
                  className="prose prose-sm max-w-none break-words dark:prose-invert"
                  dangerouslySetInnerHTML={{ __html: markdownToHtml(notice) }}
                />
              </Callout>
            )}

            {limit && (
              <Callout
                variant="warning"
                icon={Timer}
                title={cooldown && cooldownSec <= 120 ? `Limite raggiunto · riprova tra ${cooldownSec}s` : 'Limite di utilizzo raggiunto'}
                className="ml-10"
                action={<IconButton label="Chiudi" icon={<X />} size="xs" onClick={() => setLimit(null)} />}
              >
                <p className="text-body text-muted-foreground">{limit.message}</p>
              </Callout>
            )}

            {pending && pending.length > 0 && (
              <Callout variant="warning" title="Conferma richiesta" className="ml-10">
                <p className="text-body text-muted-foreground">Akari vuole eseguire queste azioni:</p>
                <ul className="mt-1.5 list-disc space-y-0.5 pl-5 text-body text-foreground">
                  {pending.map(a => <li key={a.id}>{a.summary || TOOL_LABELS[a.tool] || a.tool}</li>)}
                </ul>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button size="sm" variant="destructive" onClick={() => resolve(true)}>Conferma ed esegui</Button>
                  <Button size="sm" variant="outline" onClick={() => resolve(false)}>Annulla</Button>
                </div>
              </Callout>
            )}
          </div>
        </div>

        <ChatComposer
          ref={composerRef}
          onSend={send}
          busy={sending || cooldown}
          resetKey={activeId ?? `new-${scope}`}
          innerClassName="mx-auto w-full max-w-3xl"
          placeholder={sending ? 'Akari sta rispondendo…' : cooldown ? 'Limite raggiunto: attendi prima di inviare' : 'Scrivi ad Akari o un comando (/help)'}
          aria-label="Messaggio per Akari"
        />
      </section>
    </div>
  )
}

function AkariAvatar({ size = 'sm' }: { size?: 'sm' | 'lg' }) {
  return (
    <span
      className={cn(
        'flex shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary',
        size === 'lg' ? 'h-14 w-14' : 'h-7 w-7',
      )}
      aria-hidden
    >
      <Flower2 className={size === 'lg' ? 'h-7 w-7' : 'h-4 w-4'} />
    </span>
  )
}

function ConversationList({
  scope, onScope, conversations, isLoading, isError, onRetry, activeId, onOpen, onNew, onDelete,
}: {
  scope: AiConversationScope
  onScope: (s: AiConversationScope) => void
  conversations: AiConversation[]
  isLoading: boolean
  isError: boolean
  onRetry: () => void
  activeId: string | null
  onOpen: (id: string) => void
  onNew: () => void
  onDelete: (c: AiConversation) => void
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-14 shrink-0 items-center gap-2 border-b px-3">
        <h2 className="flex-1 text-heading">Akari</h2>
        <Button size="sm" variant="outline" onClick={onNew}>
          <SquarePen className="h-4 w-4" /> Nuova chat
        </Button>
      </div>
      <div className="shrink-0 px-2 pt-2">
        <Tabs value={scope} onValueChange={v => onScope(v as AiConversationScope)}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="PRIVATE"><Lock className="h-3.5 w-3.5" /> Personali</TabsTrigger>
            <TabsTrigger value="SHARED"><Users className="h-3.5 w-3.5" /> Condivise</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>
      <nav className="min-h-0 flex-1 space-y-0.5 overflow-y-auto p-2">
        {isLoading ? (
          [0, 1, 2, 3].map(i => <Skeleton key={i} className="h-8 w-full" />)
        ) : isError ? (
          <div className="flex flex-col items-center gap-2 p-4 text-center">
            <p className="text-caption text-muted-foreground">Impossibile caricare le conversazioni.</p>
            <Button size="sm" variant="outline" onClick={onRetry}>Riprova</Button>
          </div>
        ) : conversations.length === 0 ? (
          <div className="flex flex-col items-center gap-1 px-3 py-8 text-center">
            <MessageSquareText className="h-6 w-6 text-muted-foreground/60" />
            <p className="text-caption text-muted-foreground">
              {scope === 'PRIVATE' ? 'Nessuna conversazione personale.' : 'Nessuna conversazione condivisa.'}
            </p>
          </div>
        ) : (
          conversations.map(c => (
            <div
              key={c.id}
              className={cn(
                'group flex h-8 items-center gap-1 rounded-md pr-0.5 text-body transition-colors',
                activeId === c.id ? 'bg-sidebar-accent font-medium text-foreground' : 'text-muted-foreground hover:bg-accent hover:text-foreground',
              )}
            >
              <button
                type="button"
                onClick={() => onOpen(c.id)}
                aria-current={activeId === c.id ? 'page' : undefined}
                className="focus-ring flex h-full min-w-0 flex-1 items-center rounded-md px-2 text-left"
              >
                <span className="truncate">{c.title || 'Nuova conversazione'}</span>
              </button>
              <IconButton
                label="Elimina conversazione"
                icon={<Trash2 />}
                size="xs"
                className="shrink-0 opacity-100 hover:text-destructive md:opacity-0 md:focus-visible:opacity-100 md:group-hover:opacity-100"
                onClick={() => onDelete(c)}
              />
            </div>
          ))
        )}
      </nav>
    </div>
  )
}

function MessagesSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Caricamento conversazione">
      <div className="flex justify-end"><Skeleton className="h-9 w-1/2 rounded-lg" /></div>
      <div className="flex gap-3">
        <Skeleton className="h-7 w-7 shrink-0 rounded-full" />
        <div className="flex-1 space-y-2"><Skeleton className="h-3 w-5/6" /><Skeleton className="h-3 w-2/3" /><Skeleton className="h-3 w-3/4" /></div>
      </div>
    </div>
  )
}

const MessageBubble = memo(function MessageBubble({ role, content, streaming, name, avatar }: {
  role: string; content: string; streaming?: boolean; name?: string; avatar?: string
}) {
  const isUser = role === 'USER'
  const html = useMemo(() => (isUser || !content ? '' : markdownToHtml(content)), [isUser, content])

  if (isUser) {
    return (
      <div className="flex justify-end gap-2.5">
        <div className="min-w-0 max-w-[85%] rounded-lg rounded-br-sm bg-primary/10 px-3.5 py-2 text-body text-foreground">
          <p className="whitespace-pre-wrap break-words">{content}</p>
        </div>
        <UserAvatar name={name || 'Utente'} avatar={avatar} size="sm" className="mt-0.5 hidden sm:inline-flex" />
      </div>
    )
  }

  return (
    <div className="flex gap-3">
      <AkariAvatar />
      <div className="min-w-0 flex-1 pt-0.5">
        {streaming && !content ? (
          <span className="inline-flex items-center gap-1 py-2 text-muted-foreground" role="status" aria-label="Akari sta pensando">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current [animation-delay:0.2s]" />
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current [animation-delay:0.4s]" />
          </span>
        ) : (
          <div
            className="prose prose-sm max-w-none break-words dark:prose-invert"
            aria-busy={streaming || undefined}
            dangerouslySetInnerHTML={{ __html: html }}
          />
        )}
      </div>
    </div>
  )
})
