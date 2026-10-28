import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type InfiniteData, type QueryClient } from '@tanstack/react-query'
import { notificationsApi } from '@/lib/api'
import type { AppNotification } from '@/types'

/** Chiavi react-query delle notifiche in-app (trasversali ai workspace, per utente). */
export const NOTIFICATIONS_KEY = ['notifications'] as const
export const NOTIFICATIONS_UNREAD_KEY = ['notifications-unread'] as const

export const NOTIFICATIONS_PAGE_SIZE = 30

export type NotificationPages = InfiniteData<AppNotification[], string | undefined>

/** Lista paginata a cursore (createdAt dell'ultima ricevuta). */
export function useNotificationsList(enabled = true) {
  return useInfiniteQuery({
    queryKey: NOTIFICATIONS_KEY,
    queryFn: ({ pageParam }) => notificationsApi.list({ limit: NOTIFICATIONS_PAGE_SIZE, before: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: last =>
      last.length < NOTIFICATIONS_PAGE_SIZE ? undefined : last[last.length - 1]?.createdAt,
    enabled,
  })
}

export function useUnreadNotificationsCount(enabled = true) {
  return useQuery({
    queryKey: NOTIFICATIONS_UNREAD_KEY,
    queryFn: notificationsApi.unreadCount,
    enabled,
    // Aggiornato in tempo reale dalla coda personale; refetch periodico solo come rete di sicurezza.
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
  })
}

/** Applica una trasformazione a ogni notifica in cache. */
function mapCached(qc: QueryClient, fn: (n: AppNotification) => AppNotification) {
  qc.setQueryData<NotificationPages>(NOTIFICATIONS_KEY, old =>
    old ? { ...old, pages: old.pages.map(p => p.map(fn)) } : old
  )
}

/** Nuova notifica dal realtime: in testa alla prima pagina + contatore, senza refetch. */
export function prependNotification(qc: QueryClient, n: AppNotification) {
  let added = true
  qc.setQueryData<NotificationPages>(NOTIFICATIONS_KEY, old => {
    if (!old) return old
    if (old.pages.some(p => p.some(x => x.id === n.id))) {
      added = false
      return old
    }
    const [first = [], ...rest] = old.pages
    return { ...old, pages: [[n, ...first], ...rest] }
  })
  if (added && !n.readAt) {
    qc.setQueryData<number>(NOTIFICATIONS_UNREAD_KEY, c => (c === undefined ? c : c + 1))
  }
}

/** Lettura avvenuta altrove (altra scheda/dispositivo): allinea la cache. */
export function applyRemoteRead(qc: QueryClient, payload: { ids?: string[]; all?: boolean }) {
  const now = new Date().toISOString()
  if (payload.all) {
    mapCached(qc, n => (n.readAt ? n : { ...n, readAt: now }))
    qc.setQueryData<number>(NOTIFICATIONS_UNREAD_KEY, 0)
    return
  }
  const ids = new Set(payload.ids ?? [])
  if (ids.size === 0) return
  mapCached(qc, n => (ids.has(n.id) && !n.readAt ? { ...n, readAt: now } : n))
  // Il contatore potrebbe già essere stato decrementato in modo ottimistico: lo si rilegge.
  void qc.invalidateQueries({ queryKey: NOTIFICATIONS_UNREAD_KEY })
}

export function useMarkNotificationRead() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => notificationsApi.markRead(id),
    onMutate: (id: string) => {
      const now = new Date().toISOString()
      let wasUnread = false
      mapCached(qc, n => {
        if (n.id !== id || n.readAt) return n
        wasUnread = true
        return { ...n, readAt: now }
      })
      if (wasUnread) qc.setQueryData<number>(NOTIFICATIONS_UNREAD_KEY, c => (c ? c - 1 : c))
    },
    onError: () => {
      void qc.invalidateQueries({ queryKey: NOTIFICATIONS_KEY })
      void qc.invalidateQueries({ queryKey: NOTIFICATIONS_UNREAD_KEY })
    },
  })
}

export function useMarkAllNotificationsRead() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => notificationsApi.markAllRead(),
    onMutate: () => applyRemoteRead(qc, { all: true }),
    onError: () => {
      void qc.invalidateQueries({ queryKey: NOTIFICATIONS_KEY })
      void qc.invalidateQueries({ queryKey: NOTIFICATIONS_UNREAD_KEY })
    },
  })
}
