import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { aiApi, workspacesApi } from '@/lib/api'
import { AiConversation, AiMessage, AiConversationScope } from '@/types'
import { useWorkspaceStore } from '@/store/workspaceStore'
import { useAuthStore } from '@/store/authStore'
import { subscribeWorkspace } from '@/lib/websocket'
import { UserAvatar } from '@/components/UserAvatar'
import { markdownToHtml } from '@/lib/markdown'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { toast } from '@/components/ui/toast'
import { Bot, Plus, Send, Trash2, Lock, Users, Wrench, AlertTriangle, Terminal } from 'lucide-react'

interface PendingAction { id: string; tool: string; summary: string }

const HELP_TEXT = `**Comandi disponibili**
• \`/help\` — mostra questo elenco
• \`/new [titolo]\` — apre una nuova conversazione
• \`/context\` — stato del contesto (token, riassunto, soglia)
• \`/compact\` — riassume subito i messaggi vecchi
• \`/memory\` — mostra la memoria del workspace
• \`/model [slug]\` — mostra il modello; con argomento lo cambia (solo admin)
• \`/clear\` — svuota la conversazione corrente`

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

export default function AssistantPage() {
  const { wsId } = useParams<{ wsId: string }>()
  const queryClient = useQueryClient()
  const workspace = useWorkspaceStore(s => s.current)
  const me = useAuthStore(s => s.user)

  const { data: members = [] } = useQuery<{ userId: string; displayName: string; avatar?: string }[]>({
    queryKey: ['members', wsId],
    queryFn: () => workspacesApi.getMembers(wsId!),
    enabled: !!wsId,
  })

  // Risolve nome+foto dell'autore di un messaggio (dai membri, con fallback all'utente corrente).
  const authorOf = (userId?: string | null) => {
    const m = members.find(x => x.userId === userId)
    if (m) return { name: m.displayName, avatar: m.avatar }
    if (userId && me && userId === me.id) return { name: me.displayName, avatar: me.avatar }
    return { name: undefined, avatar: undefined }
  }

  const [scope, setScope] = useState<AiConversationScope>('PRIVATE')
  const [activeId, setActiveId] = useState<string | null>(null)
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [draftUser, setDraftUser] = useState<string | null>(null)
  const [draftAssistant, setDraftAssistant] = useState('')
  const [toolActivity, setToolActivity] = useState<string[]>([])
  const [pending, setPending] = useState<PendingAction[] | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // Adatta l'altezza della textarea al contenuto multilinea (fino al max definito in CSS).
  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 160) + 'px'
  }, [input])

  const { data: conversations = [] } = useQuery<AiConversation[]>({
    queryKey: ['ai-conversations', wsId, scope],
    queryFn: () => aiApi.listConversations(wsId!, scope),
    enabled: !!wsId,
  })

  const { data: messages = [] } = useQuery<AiMessage[]>({
    queryKey: ['ai-messages', wsId, activeId],
    queryFn: () => aiApi.getMessages(wsId!, activeId!),
    enabled: !!wsId && !!activeId,
  })

  // Quando si cambia ambito, deseleziona la conversazione attiva.
  useEffect(() => { setActiveId(null) }, [scope])

  // Realtime per le chat CONDIVISE: lo streaming SSE arriva solo a chi invia il
  // messaggio, quindi gli altri partecipanti vengono avvisati via WebSocket
  // (evento AI_MESSAGE) e ri-fetchano la conversazione. Chi sta inviando (sending)
  // ignora l'evento per non interferire con lo stream locale in corso.
  const sendingRef = useRef(sending)
  const activeIdRef = useRef(activeId)
  useEffect(() => { sendingRef.current = sending }, [sending])
  useEffect(() => { activeIdRef.current = activeId }, [activeId])
  useEffect(() => {
    if (!wsId) return
    return subscribeWorkspace(wsId, ev => {
      if (ev.type !== 'AI_MESSAGE') return
      // Aggiorna sempre la lista (titolo/ordine) delle conversazioni condivise.
      queryClient.invalidateQueries({ queryKey: ['ai-conversations', wsId, 'SHARED'] })
      const convId = ev.payload?.conversationId
      if (convId && convId === activeIdRef.current && !sendingRef.current) {
        queryClient.invalidateQueries({ queryKey: ['ai-messages', wsId, convId] })
      }
    })
  }, [wsId, queryClient])

  // Scroll automatico in fondo.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, draftAssistant, draftUser])

  const resetDraft = () => { setDraftUser(null); setDraftAssistant(''); setToolActivity([]); setPending(null); setNotice(null) }
  const newChat = () => { setActiveId(null); resetDraft(); inputRef.current?.focus() }

  // Gestione dei comandi slash. /help e /new sono lato client; gli altri passano dal backend.
  const handleCommand = async (raw: string) => {
    const parts = raw.slice(1).trim().split(/\s+/)
    const cmd = (parts.shift() || '').toLowerCase()
    const arg = parts.join(' ').trim()
    setInput('')

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
      setNotice(`Apri o avvia una conversazione per usare /${cmd}.`)
      return
    }
    try {
      const res = await aiApi.command(wsId, activeId, cmd, arg)
      setNotice(res.message)
      if (res.refreshMessages) queryClient.invalidateQueries({ queryKey: ['ai-messages', wsId, activeId] })
      if (res.refreshConversations) queryClient.invalidateQueries({ queryKey: ['ai-conversations', wsId, scope] })
    } catch (err: any) {
      toast(err.response?.data?.error ?? 'Comando non riuscito', 'destructive')
    }
  }

  const streamHandlers = (convId: string) => ({
    onToken: (t: string) => setDraftAssistant(p => p + t),
    onTool: (name: string) => setToolActivity(a => [...a, name]),
    onConfirm: (actions: PendingAction[]) => { setPending(actions); setSending(false) },
    onDone: async () => {
      await queryClient.invalidateQueries({ queryKey: ['ai-messages', wsId, convId] })
      queryClient.invalidateQueries({ queryKey: ['ai-conversations', wsId, scope] })
      setSending(false); resetDraft()
    },
    onError: async (m: string) => {
      toast(m, 'destructive')
      await queryClient.invalidateQueries({ queryKey: ['ai-messages', wsId, convId] })
      setSending(false); resetDraft()
    },
  })

  const resolve = async (confirm: boolean) => {
    if (!wsId || !activeId) return
    setPending(null); setToolActivity([]); setSending(true)
    await aiApi.confirmActions(wsId, activeId, confirm, streamHandlers(activeId))
  }

  const removeConversation = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    if (!wsId || !confirm('Eliminare questa conversazione?')) return
    try {
      await aiApi.deleteConversation(wsId, id)
      if (activeId === id) setActiveId(null)
      queryClient.invalidateQueries({ queryKey: ['ai-conversations', wsId, scope] })
    } catch (err: any) {
      toast(err.response?.data?.error ?? 'Errore', 'destructive')
    }
  }

  const send = async () => {
    const text = input.trim()
    if (!text || sending || !wsId) return

    // I comandi slash non vengono inviati al modello.
    if (text.startsWith('/')) { handleCommand(text); return }

    let convId = activeId
    if (!convId) {
      try {
        const conv: AiConversation = await aiApi.createConversation(wsId, { scope })
        convId = conv.id
        setActiveId(convId)
        queryClient.invalidateQueries({ queryKey: ['ai-conversations', wsId, scope] })
      } catch (err: any) {
        toast(err.response?.data?.error ?? 'Impossibile creare la conversazione', 'destructive')
        return
      }
    }

    setInput('')
    setDraftUser(text)
    setDraftAssistant('')
    setToolActivity([])
    setPending(null)
    setNotice(null)
    setSending(true)

    await aiApi.streamMessage(wsId, convId, text, streamHandlers(convId))
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
  }

  const ScopeBtn = ({ value, icon, label }: { value: AiConversationScope; icon: React.ReactNode; label: string }) => (
    <button
      onClick={() => setScope(value)}
      className={cn('flex-1 flex items-center justify-center gap-1.5 py-1.5 text-xs rounded-md transition-colors',
        scope === value ? 'bg-background shadow-sm font-medium' : 'text-muted-foreground hover:text-foreground')}
    >
      {icon} {label}
    </button>
  )

  return (
    <div className="flex h-full overflow-hidden">
      {/* Sidebar conversazioni */}
      <div className="w-64 shrink-0 border-r flex flex-col">
        <div className="p-3 border-b space-y-2">
          <div className="flex gap-1 p-0.5 rounded-lg bg-muted">
            <ScopeBtn value="PRIVATE" icon={<Lock className="h-3.5 w-3.5" />} label="Private" />
            <ScopeBtn value="SHARED" icon={<Users className="h-3.5 w-3.5" />} label="Condivise" />
          </div>
          <Button size="sm" className="w-full" onClick={newChat}>
            <Plus className="h-4 w-4 mr-1.5" /> Nuova chat
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
          {conversations.map(c => (
            <div
              key={c.id}
              onClick={() => { setActiveId(c.id); resetDraft() }}
              className={cn('group flex items-center gap-2 rounded-md px-2.5 py-2 text-sm cursor-pointer transition-colors',
                activeId === c.id ? 'bg-accent' : 'hover:bg-accent/50')}
            >
              <Bot className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="flex-1 truncate">{c.title || 'Nuova conversazione'}</span>
              <button
                onClick={e => removeConversation(c.id, e)}
                className="shrink-0 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
          {conversations.length === 0 && (
            <p className="px-2 py-3 text-xs text-muted-foreground text-center">Nessuna conversazione.</p>
          )}
        </div>
      </div>

      {/* Thread */}
      <div className="flex-1 flex flex-col min-w-0">
        <div className="px-6 py-3 border-b shrink-0">
          <h1 className="text-lg font-semibold flex items-center gap-2"><span className="text-xl leading-none">🌸</span> Akari</h1>
          <p className="text-xs text-muted-foreground">{workspace?.name} · {scope === 'PRIVATE' ? 'conversazione privata' : 'conversazione condivisa'}</p>
        </div>

        <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {messages.length === 0 && !draftUser && (
            <div className="flex flex-col items-center justify-center h-full text-center gap-2 text-muted-foreground">
              <div className="text-4xl leading-none opacity-80">🌸</div>
              <p className="text-sm">Ciao, sono Akari. Chiedimi qualcosa sul workspace.</p>
              <p className="text-xs">Posso rispondere a domande e creare o gestire task, eventi, storie, file e tag.</p>
            </div>
          )}

          {messages.map(m => {
            const a = m.role === 'USER' ? authorOf(m.authorUserId) : { name: undefined, avatar: undefined }
            return <MessageBubble key={m.id} role={m.role} content={m.content} name={a.name} avatar={a.avatar} />
          })}

          {draftUser && <MessageBubble role="USER" content={draftUser} name={me?.displayName} avatar={me?.avatar} />}
          {draftUser && toolActivity.length > 0 && (
            <div className="max-w-3xl mx-auto w-full flex flex-wrap gap-1.5 pl-10">
              {toolActivity.map((t, i) => (
                <span key={i} className="text-[11px] rounded-full bg-muted px-2 py-0.5 flex items-center gap-1 text-muted-foreground">
                  <Wrench className="h-3 w-3" /> {TOOL_LABELS[t] || t}
                </span>
              ))}
            </div>
          )}
          {draftUser && (draftAssistant || sending) && (
            <MessageBubble role="ASSISTANT" content={draftAssistant} streaming={sending && !draftAssistant} />
          )}

          {notice && (
            <div className="max-w-3xl mx-auto w-full ml-10 rounded-xl border bg-muted/50 p-3.5 relative">
              <button
                onClick={() => setNotice(null)}
                className="absolute top-2 right-2.5 text-muted-foreground hover:text-foreground text-xs"
                aria-label="Chiudi"
              >✕</button>
              <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground mb-1.5">
                <Terminal className="h-3.5 w-3.5" /> Comando
              </div>
              <div
                className="prose prose-sm dark:prose-invert max-w-none break-words"
                dangerouslySetInnerHTML={{ __html: markdownToHtml(notice) }}
              />
            </div>
          )}

          {pending && pending.length > 0 && (
            <div className="max-w-3xl mx-auto w-full ml-10 rounded-xl border border-amber-300 bg-amber-50 dark:bg-amber-900/20 p-3.5 space-y-2.5">
              <p className="text-sm font-medium flex items-center gap-1.5 text-amber-800 dark:text-amber-200">
                <AlertTriangle className="h-4 w-4" /> Conferma richiesta
              </p>
              <ul className="text-sm list-disc pl-5 space-y-0.5">
                {pending.map(a => <li key={a.id}>{a.summary || a.tool}</li>)}
              </ul>
              <div className="flex gap-2">
                <Button size="sm" variant="destructive" onClick={() => resolve(true)}>Conferma ed esegui</Button>
                <Button size="sm" variant="outline" onClick={() => resolve(false)}>Annulla</Button>
              </div>
            </div>
          )}
        </div>

        {/* Input */}
        <div className="border-t p-3 shrink-0">
          <div className="flex items-end gap-2 max-w-3xl mx-auto">
            <textarea
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              rows={1}
              placeholder="Scrivi un messaggio o un comando (/help)…  (Invio per inviare, Shift+Invio a capo)"
              className="flex-1 resize-none rounded-lg border bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring max-h-40"
            />
            <Button onClick={send} disabled={sending || !input.trim()} size="icon" className="h-10 w-10 shrink-0">
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

function MessageBubble({ role, content, streaming, name, avatar }: { role: string; content: string; streaming?: boolean; name?: string; avatar?: string }) {
  const isUser = role === 'USER'
  return (
    <div className={cn('flex gap-3 max-w-3xl mx-auto w-full', isUser && 'flex-row-reverse')}>
      {isUser ? (
        <UserAvatar name={name || 'U'} avatar={avatar} className="h-7 w-7 shrink-0" />
      ) : (
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted">
          <span className="text-sm leading-none">🌸</span>
        </div>
      )}
      <div className={cn('rounded-2xl px-4 py-2.5 text-sm min-w-0',
        isUser ? 'bg-primary text-primary-foreground' : 'bg-muted')}>
        {streaming ? (
          <span className="inline-flex gap-1 py-1">
            <span className="h-1.5 w-1.5 rounded-full bg-current opacity-40 animate-pulse" />
            <span className="h-1.5 w-1.5 rounded-full bg-current opacity-40 animate-pulse [animation-delay:0.2s]" />
            <span className="h-1.5 w-1.5 rounded-full bg-current opacity-40 animate-pulse [animation-delay:0.4s]" />
          </span>
        ) : isUser ? (
          <p className="whitespace-pre-wrap break-words">{content}</p>
        ) : (
          <div
            className="prose prose-sm dark:prose-invert max-w-none break-words"
            dangerouslySetInnerHTML={{ __html: markdownToHtml(content) }}
          />
        )}
      </div>
    </div>
  )
}
