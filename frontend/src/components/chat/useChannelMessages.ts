import { useEffect, useMemo } from 'react'
import { InfiniteData, QueryClient, useInfiniteQuery, useQueryClient } from '@tanstack/react-query'
import { channelsApi } from '@/lib/api'
import { ChatMessage } from '@/types'

export const PAGE_SIZE = 50

/** Messaggio in UI: `pending` = invio ottimistico non ancora confermato dal server. */
export type UiMessage = ChatMessage & { pending?: boolean }

/** pages[0] = pagina più recente; pages[n] = più vecchie. Ogni pagina è in ordine cronologico. */
export type MessagePages = InfiniteData<UiMessage[], string | undefined>

export const messagesKey = (wsId: string | undefined, channelId: string | null | undefined) =>
  ['messages', wsId, channelId] as const

const fetchPage = (wsId: string, channelId: string, before?: string) =>
  channelsApi.getMessages(wsId, channelId, before ? { limit: PAGE_SIZE, before } : { limit: PAGE_SIZE }) as Promise<UiMessage[]>

const sig = (m: UiMessage) => `${m.authorId}\u0000${m.content}`

/**
 * Aggiunge (o sostituisce) messaggi in coda alla pagina più recente, deduplicando per id.
 * `replaceId`: copia ottimistica da togliere (es. sostituita dal messaggio reale).
 */
export function appendMessages(
  qc: QueryClient, wsId: string, channelId: string, incoming: UiMessage[], replaceId?: string,
) {
  qc.setQueryData<MessagePages>(messagesKey(wsId, channelId), d => {
    if (!d || d.pages.length === 0) return d
    const seen = new Set<string>()
    d.pages.forEach(p => p.forEach(m => seen.add(m.id)))
    const [first, ...rest] = d.pages
    let latest = replaceId ? first.filter(m => m.id !== replaceId) : first
    const fresh = incoming.filter(m => !seen.has(m.id))
    if (fresh.length === 0 && latest === first) return d
    // Un messaggio reale rende superflua la copia ottimistica con lo stesso autore e testo.
    const confirmed = new Set(fresh.filter(m => !m.pending).map(sig))
    if (confirmed.size) latest = latest.filter(m => !(m.pending && confirmed.has(sig(m))))
    // Le copie ottimistiche restano in fondo finché non vengono confermate.
    const settled = latest.filter(m => !m.pending)
    const pending = latest.filter(m => m.pending)
    const merged = [...settled, ...fresh.filter(m => !m.pending), ...pending, ...fresh.filter(m => m.pending)]
    return { ...d, pages: [merged, ...rest] }
  })
}

export function removeMessage(qc: QueryClient, wsId: string, channelId: string, id: string) {
  qc.setQueryData<MessagePages>(messagesKey(wsId, channelId), d =>
    d ? { ...d, pages: d.pages.map(p => p.filter(m => m.id !== id)) } : d)
}

// Sincronizzazioni in corso per canale: le richieste ravvicinate si accodano in una sola.
const syncing = new Map<string, { running: boolean; again: boolean }>()

/**
 * Riallinea la coda della conversazione dopo un MESSAGE_CREATED (l'evento non porta il
 * contenuto): scarica SOLO l'ultima pagina e la fonde nella cache, senza rifare il fetch
 * delle pagine più vecchie.
 */
export async function syncLatestMessages(qc: QueryClient, wsId: string, channelId: string) {
  const k = `${wsId}/${channelId}`
  let st = syncing.get(k)
  if (!st) { st = { running: false, again: false }; syncing.set(k, st) }
  if (st.running) { st.again = true; return }
  st.running = true
  try {
    do {
      st.again = false
      const current = qc.getQueryData<MessagePages>(messagesKey(wsId, channelId))
      if (!current) return // nessuna cache: al prossimo montaggio si carica da zero
      const latest = await fetchPage(wsId, channelId)
      const known = new Set<string>()
      qc.getQueryData<MessagePages>(messagesKey(wsId, channelId))?.pages.forEach(p => p.forEach(m => m.pending || known.add(m.id)))
      const overlaps = latest.some(m => known.has(m.id))
      if (!overlaps && latest.length >= PAGE_SIZE && known.size > 0) {
        // Buco troppo grande da ricucire: si riparte dall'ultima pagina.
        qc.setQueryData<MessagePages>(messagesKey(wsId, channelId), { pages: [latest], pageParams: [undefined] })
      } else {
        appendMessages(qc, wsId, channelId, latest)
      }
    } while (st.again)
  } catch {
    /* rete: il prossimo evento o la riconnessione riproveranno */
  } finally {
    st.running = false
  }
}

/**
 * Messaggi di un canale con paginazione all'indietro: cursore `before` = createdAt del messaggio
 * più vecchio, passato come stringa esattamente come arriva dal server (axios lo codifica nell'URL).
 * Gli aggiornamenti arrivano via WebSocket → niente refetch automatici. Aprendo un canale che ha
 * già una cache (es. ritorno in chat entro gcTime, o riconnessione WS a pagina smontata) si
 * riallinea una volta l'ultima pagina: gli eventi arrivati nel frattempo non sono stati visti.
 */
export function useChannelMessages(wsId: string | undefined, channelId: string | null) {
  const qc = useQueryClient()
  useEffect(() => {
    if (!wsId || !channelId) return
    if (qc.getQueryData(messagesKey(wsId, channelId))) void syncLatestMessages(qc, wsId, channelId)
  }, [qc, wsId, channelId])

  const query = useInfiniteQuery({
    queryKey: messagesKey(wsId, channelId),
    queryFn: ({ pageParam }) => fetchPage(wsId!, channelId!, pageParam),
    initialPageParam: undefined as string | undefined,
    // Meno di PAGE_SIZE risultati = inizio della conversazione.
    getNextPageParam: lastPage => (lastPage.length < PAGE_SIZE ? undefined : lastPage.find(m => !m.pending)?.createdAt),
    enabled: !!wsId && !!channelId,
    staleTime: Infinity,
    gcTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })

  const messages = useMemo<UiMessage[]>(() => {
    const pages = query.data?.pages
    if (!pages) return []
    if (pages.length === 1) return pages[0]
    const out: UiMessage[] = []
    for (let i = pages.length - 1; i >= 0; i--) out.push(...pages[i])
    return out
  }, [query.data])

  return { query, messages }
}
