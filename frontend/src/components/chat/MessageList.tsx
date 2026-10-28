import * as React from 'react'
import { ArrowDown, Copy, MessageCircle } from 'lucide-react'
import { UserAvatar } from '@/components/shared'
import { IconButton } from '@/components/ui/icon-button'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { Skeleton } from '@/components/ui/skeleton'
import { toast } from '@/components/ui/toast'
import { cn } from '@/lib/utils'
import type { UiMessage } from './useChannelMessages'

const GROUP_WINDOW_MS = 5 * 60 * 1000
const NEAR_BOTTOM_PX = 140
const LOAD_OLDER_PX = 240

const timeFmt = new Intl.DateTimeFormat('it-IT', { hour: '2-digit', minute: '2-digit' })
const fullFmt = new Intl.DateTimeFormat('it-IT', { dateStyle: 'full', timeStyle: 'short' })
const dayFmt = new Intl.DateTimeFormat('it-IT', { weekday: 'long', day: 'numeric', month: 'long' })
const dayYearFmt = new Intl.DateTimeFormat('it-IT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })

function dayKey(d: Date) {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}

function dayLabel(d: Date) {
  const today = new Date()
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1)
  if (dayKey(d) === dayKey(today)) return 'Oggi'
  if (dayKey(d) === dayKey(yesterday)) return 'Ieri'
  const s = (d.getFullYear() === today.getFullYear() ? dayFmt : dayYearFmt).format(d)
  return s.charAt(0).toUpperCase() + s.slice(1)
}

const URL_RE = /(https?:\/\/[^\s<]+[^\s<.,;:!?)\]'"])/g

/** Testo del messaggio con i link http(s) cliccabili (niente HTML grezzo). */
function MessageText({ text }: { text: string }) {
  const parts = text.split(URL_RE)
  return (
    <>
      {parts.map((p, i) =>
        i % 2 === 1 ? (
          <a key={i} href={p} target="_blank" rel="noopener noreferrer" className="text-primary underline-offset-2 hover:underline break-all">
            {p}
          </a>
        ) : (
          <React.Fragment key={i}>{p}</React.Fragment>
        ),
      )}
    </>
  )
}

interface RowProps {
  msg: UiMessage
  mine: boolean
  grouped: boolean
}

/** Riga messaggio memoizzata: si ri-renderizza solo se cambia il proprio messaggio. */
const MessageRow = React.memo(function MessageRow({ msg, mine, grouped }: RowProps) {
  const date = new Date(msg.createdAt)
  const copy = () => {
    navigator.clipboard?.writeText(msg.content).then(
      () => toast('Testo copiato', 'success'),
      () => toast('Impossibile copiare', 'destructive'),
    )
  }
  return (
    <div
      className={cn(
        'group relative flex gap-3 px-3 py-0.5 transition-colors hover:bg-surface-2 focus-within:bg-surface-2 sm:px-4',
        !grouped && 'mt-3 pt-1',
        msg.pending && 'opacity-60',
      )}
    >
      <div className="w-8 shrink-0">
        {grouped ? (
          <time
            dateTime={msg.createdAt}
            title={fullFmt.format(date)}
            className="block pt-0.5 text-right text-2xs leading-5 text-muted-foreground opacity-0 tabular-nums group-hover:opacity-100 group-focus-within:opacity-100"
          >
            {timeFmt.format(date)}
          </time>
        ) : (
          <UserAvatar name={msg.authorName} avatar={msg.authorAvatar} size="md" className="mt-0.5" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        {!grouped && (
          <div className="flex items-baseline gap-2">
            <span className={cn('truncate text-body font-semibold', mine && 'text-primary')}>{msg.authorName}</span>
            <time dateTime={msg.createdAt} title={fullFmt.format(date)} className="shrink-0 text-2xs text-muted-foreground tabular-nums">
              {timeFmt.format(date)}
            </time>
          </div>
        )}
        <p className="whitespace-pre-wrap break-words text-body leading-relaxed text-foreground">
          <MessageText text={msg.content} />
          {msg.editedAt && <span className="ml-1 text-2xs text-muted-foreground">(modificato)</span>}
        </p>
        {msg.pending && <span className="text-2xs text-muted-foreground">Invio…</span>}
      </div>
      {!msg.pending && (
        <div className="absolute -top-3 right-3 hidden rounded-md border bg-popover p-0.5 shadow-sm group-hover:flex group-focus-within:flex">
          <IconButton label="Copia testo" icon={<Copy />} size="xs" onClick={copy} />
        </div>
      )}
    </div>
  )
})

function DaySeparator({ label }: { label: string }) {
  return (
    <div role="separator" aria-label={label} className="relative mx-3 my-4 flex items-center sm:mx-4">
      <div className="h-px flex-1 bg-border" />
      <span className="px-2 text-2xs font-medium text-muted-foreground">{label}</span>
      <div className="h-px flex-1 bg-border" />
    </div>
  )
}

function UnreadSeparator() {
  return (
    <div role="separator" aria-label="Nuovi messaggi" className="relative mx-3 my-2 flex items-center sm:mx-4">
      <div className="h-px flex-1 bg-destructive/60" />
      <span className="rounded-sm bg-destructive px-1.5 text-2xs font-semibold uppercase text-destructive-foreground">Nuovi</span>
    </div>
  )
}

export interface MessageListProps {
  /** Identifica la conversazione: al cambio si torna in fondo. */
  channelId: string
  messages: UiMessage[]
  meId?: string
  isLoading: boolean
  isError: boolean
  onRetry: () => void
  hasOlder: boolean
  isFetchingOlder: boolean
  fetchOlder: () => unknown
  /** Primo messaggio non letto all'apertura (separatore "Nuovi"). */
  firstUnreadId?: string | null
  /** Notifica se l'utente è in fondo alla lista (per segnare come letto). */
  onAtBottomChange?: (atBottom: boolean) => void
  empty?: React.ReactNode
  header?: React.ReactNode
}

export function MessageList({
  channelId, messages, meId, isLoading, isError, onRetry, hasOlder, isFetchingOlder, fetchOlder,
  firstUnreadId, onAtBottomChange, empty, header,
}: MessageListProps) {
  const scrollRef = React.useRef<HTMLDivElement>(null)
  const atBottomRef = React.useRef(true)
  const [showJump, setShowJump] = React.useState(false)
  const prev = React.useRef<{ channelId: string; first?: string; last?: string; height: number; top: number }>({
    channelId: '', height: 0, top: 0,
  })

  const firstId = messages[0]?.id
  const lastMsg = messages[messages.length - 1]

  const scrollToBottom = (smooth = false) => {
    const el = scrollRef.current
    if (!el) return
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' })
  }

  // Gestione posizione: in fondo all'apertura; mantenuta quando si caricano messaggi più vecchi;
  // segue i nuovi messaggi solo se si è già in fondo (o se il messaggio è mio).
  React.useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const p = prev.current
    if (p.channelId !== channelId || !p.last) {
      if (messages.length > 0) {
        el.scrollTop = el.scrollHeight
        atBottomRef.current = true
        // Font/emoji possono cambiare l'altezza dopo il primo layout: riallinea al frame successivo.
        requestAnimationFrame(() => { if (atBottomRef.current) el.scrollTop = el.scrollHeight })
      }
    } else if (firstId !== p.first && lastMsg?.id === p.last) {
      // Pagina più vecchia aggiunta in cima: compensa l'altezza inserita.
      el.scrollTop = p.top + (el.scrollHeight - p.height)
    } else if (lastMsg && lastMsg.id !== p.last) {
      if (atBottomRef.current || lastMsg.authorId === meId) {
        scrollToBottom(true)
      } else {
        setShowJump(true)
      }
    }
    prev.current = { channelId, first: firstId, last: lastMsg?.id, height: el.scrollHeight, top: el.scrollTop }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelId, firstId, lastMsg?.id, messages.length])

  React.useEffect(() => { setShowJump(false) }, [channelId])

  // Se la prima pagina non riempie lo schermo, carica subito la precedente.
  React.useEffect(() => {
    const el = scrollRef.current
    if (!el || isLoading || isFetchingOlder || !hasOlder) return
    if (el.scrollHeight <= el.clientHeight + LOAD_OLDER_PX) fetchOlder()
  }, [messages.length, hasOlder, isFetchingOlder, isLoading, fetchOlder])

  const onScroll = () => {
    const el = scrollRef.current
    if (!el) return
    prev.current.top = el.scrollTop
    prev.current.height = el.scrollHeight
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX
    if (atBottom !== atBottomRef.current) {
      atBottomRef.current = atBottom
      onAtBottomChange?.(atBottom)
    }
    if (atBottom) setShowJump(false)
    if (el.scrollTop < LOAD_OLDER_PX && hasOlder && !isFetchingOlder) fetchOlder()
  }

  const rows = React.useMemo(() => {
    const out: React.ReactNode[] = []
    let prevMsg: UiMessage | undefined
    let prevDay = ''
    for (const m of messages) {
      const d = new Date(m.createdAt)
      const dk = dayKey(d)
      let breakGroup = false
      if (dk !== prevDay) {
        out.push(<DaySeparator key={`day-${dk}`} label={dayLabel(d)} />)
        prevDay = dk
        breakGroup = true
      }
      if (firstUnreadId && m.id === firstUnreadId) {
        out.push(<UnreadSeparator key="unread" />)
        breakGroup = true
      }
      const grouped = !breakGroup && !!prevMsg && prevMsg.authorId === m.authorId &&
        d.getTime() - new Date(prevMsg.createdAt).getTime() < GROUP_WINDOW_MS
      out.push(<MessageRow key={m.id} msg={m} mine={m.authorId === meId} grouped={grouped} />)
      prevMsg = m
    }
    return out
  }, [messages, meId, firstUnreadId])

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        ref={scrollRef}
        onScroll={onScroll}
        role="log"
        aria-live="polite"
        aria-relevant="additions"
        aria-label="Messaggi"
        style={{ overflowAnchor: 'none' }}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-3"
      >
        {isLoading ? (
          <MessagesSkeleton />
        ) : isError ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
            <p className="text-body text-muted-foreground">Impossibile caricare i messaggi.</p>
            <Button size="sm" variant="outline" onClick={onRetry}>Riprova</Button>
          </div>
        ) : messages.length === 0 ? (
          empty ?? (
            <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-muted-foreground">
              <MessageCircle className="h-8 w-8 opacity-50" />
              <p className="text-body">Nessun messaggio. Scrivi il primo!</p>
            </div>
          )
        ) : (
          <>
            {hasOlder ? (
              <div className="flex h-10 items-center justify-center">
                {isFetchingOlder && <Spinner size="sm" label="Carico i messaggi precedenti…" />}
              </div>
            ) : (
              header
            )}
            {rows}
          </>
        )}
      </div>
      {showJump && (
        <Button
          size="sm"
          variant="secondary"
          className="absolute bottom-3 left-1/2 z-sticky -translate-x-1/2 rounded-full shadow-md"
          onClick={() => { scrollToBottom(true); setShowJump(false) }}
        >
          <ArrowDown className="h-3.5 w-3.5" /> Nuovi messaggi
        </Button>
      )}
    </div>
  )
}

function MessagesSkeleton() {
  return (
    <div className="space-y-5 px-4 py-6" aria-busy="true" aria-label="Caricamento messaggi">
      {[0, 1, 2, 3, 4].map(i => (
        <div key={i} className="flex gap-3">
          <Skeleton className="h-8 w-8 shrink-0 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3 w-32" />
            <Skeleton className={cn('h-3', i % 2 ? 'w-2/3' : 'w-5/6')} />
          </div>
        </div>
      ))}
    </div>
  )
}
