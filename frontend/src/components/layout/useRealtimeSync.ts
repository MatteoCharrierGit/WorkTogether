import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { QueryClient, QueryKey, useQueryClient } from '@tanstack/react-query'
import type { AppNotification, Channel, NotificationWsEventType, Workspace, WsEvent, WsEventType } from '@/types'
import { useWorkspaceEvents, useUserEvents, onWSConnect } from '@/lib/websocket'
import { appIsForeground, getActiveChatChannel, showChatNotification } from '@/lib/notifications'
import { applyRemoteRead, prependNotification } from '@/components/notifications/useNotifications'
import { useWorkspaceStore } from '@/store/workspaceStore'
import { toast } from '@/components/ui/toast'

/**
 * Sincronizzazione realtime centralizzata (montata una volta nel Layout).
 *
 * Ogni evento invalida SOLO le query che lo riguardano, sempre con il wsId nel prefisso, e le
 * invalidazioni sono raggruppate (100 ms) così una raffica di eventi (es. chiusura sprint che
 * aggiorna decine di task) produce un solo refetch per chiave. `cancelRefetch: false` evita di
 * annullare un refetch già partito (es. da una pagina che invalida la stessa chiave).
 *
 * Non tocca mai ['messages', …]: la lista messaggi è gestita dalla ChatPage.
 */

type KeysFor = (wsId: string, ev: WsEvent) => QueryKey[]

const elementKeys: KeysFor = wsId => [
  ['elements', wsId],
  ['element', wsId],
  ['my-tasks'],
  // Le transizioni dei task (stato/blocco/sprint) si riflettono nelle viste sprint.
  ['sprints', wsId],
  ['sprint-active', wsId],
  // Dashboard: KPI, throughput, carico e sprint dipendono dai task.
  ['dashboard', wsId],
]

const channelKeys: KeysFor = wsId => [['channels', wsId], ['rooms', wsId]]

/** Evento → chiavi da invalidare. Gli eventi assenti non invalidano nulla. */
const INVALIDATIONS: Partial<Record<WsEventType, KeysFor>> = {
  ELEMENT_CREATED: elementKeys,
  ELEMENT_UPDATED: (wsId, ev) => [...elementKeys(wsId, ev), ['attachments', wsId]],
  ELEMENT_DELETED: elementKeys,
  TAG_CHANGED: wsId => [['tags', wsId], ['elements', wsId], ['element', wsId], ['my-tasks']],
  SPRINT_CHANGED: wsId => [['sprints', wsId], ['sprint-active', wsId], ['dashboard', wsId]],
  DRIVE_CHANGED: wsId => [['drive-folders', wsId], ['drive-files', wsId]],
  CHANNEL_CREATED: channelKeys,
  CHANNEL_UPDATED: channelKeys,
  CHANNEL_DELETED: channelKeys,
  MEMBER_ADDED: wsId => [['members', wsId], ['channels', wsId], ['dashboard', wsId]],
  // MESSAGE_CREATED: aggiornato in cache con setQueryData (vedi sotto), nessun refetch.
  // TYPING / PRESENCE / AI_MESSAGE: gestiti da ChatPage / PresenceManager / AssistantPage.
}

/** Chiavi da riallineare dopo una riconnessione (eventi persi mentre si era offline). */
const RECONNECT_KEYS = (wsId: string): QueryKey[] => [
  ['elements', wsId], ['element', wsId], ['my-tasks'], ['channels', wsId], ['tags', wsId],
  ['sprints', wsId], ['sprint-active', wsId], ['drive-folders', wsId], ['drive-files', wsId],
  ['members', wsId], ['workspaces'], ['dashboard', wsId],
  // Notifiche personali arrivate mentre si era offline.
  ['notifications'], ['notifications-unread'],
]

/** Coda di invalidazioni con flush ritardato e deduplica per chiave. */
function createInvalidationBatcher(queryClient: QueryClient, delay = 100) {
  const pending = new Map<string, QueryKey>()
  let timer: ReturnType<typeof setTimeout> | null = null
  const flush = () => {
    timer = null
    const keys = Array.from(pending.values())
    pending.clear()
    for (const queryKey of keys) {
      void queryClient.invalidateQueries({ queryKey }, { cancelRefetch: false })
    }
  }
  return {
    add(keys: QueryKey[]) {
      for (const k of keys) pending.set(JSON.stringify(k), k)
      if (!timer) timer = setTimeout(flush, delay)
    },
    dispose() {
      if (timer) clearTimeout(timer)
      timer = null
      pending.clear()
    },
  }
}

interface Options {
  workspaceId: string | undefined
  meId: string | undefined
  /** Chiamato per ogni MESSAGE_CREATED (notifiche). */
  onMessage?: (payload: any) => void
}

export function useRealtimeSync({ workspaceId, meId, onMessage }: Options) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const setCurrentWorkspace = useWorkspaceStore(s => s.setCurrent)

  const batcherRef = useRef<ReturnType<typeof createInvalidationBatcher> | null>(null)
  if (!batcherRef.current) batcherRef.current = createInvalidationBatcher(queryClient)
  useEffect(() => () => batcherRef.current?.dispose(), [])

  const onMessageRef = useRef(onMessage)
  onMessageRef.current = onMessage

  useWorkspaceEvents(workspaceId, ev => {
    if (!workspaceId) return
    const batcher = batcherRef.current!
    const p = ev.payload || {}

    switch (ev.type) {
      case 'WORKSPACE_DELETED':
      case 'MEMBER_REMOVED': {
        const kicked = ev.type === 'WORKSPACE_DELETED' || p.userId === meId
        if (!kicked) {
          batcher.add([['members', workspaceId], ['channels', workspaceId], ['dashboard', workspaceId]])
          return
        }
        const id = (ev.type === 'WORKSPACE_DELETED' && p.workspaceId) || workspaceId
        setCurrentWorkspace(null)
        // Rimozione immediata dalla cache (switcher aggiornato subito), poi riconciliazione.
        queryClient.setQueryData<Workspace[]>(['workspaces'], old => old?.filter(w => w.id !== id))
        void queryClient.invalidateQueries({ queryKey: ['workspaces'] })
        toast(ev.type === 'WORKSPACE_DELETED' ? 'Questo workspace è stato eliminato' : 'Sei stato rimosso da questo workspace')
        navigate('/', { replace: true })
        return
      }
      case 'MEMBER_ROLE_CHANGED':
      case 'WORKSPACE_UPDATED': {
        batcher.add(ev.type === 'WORKSPACE_UPDATED'
          ? [['sprints', workspaceId], ['sprint-active', workspaceId]]
          : [['members', workspaceId]])
        // Il proprio ruolo e le impostazioni (sprintEnabled, opzioni card) vivono nel workspace
        // corrente dello store: riletto dalla lista aggiornata.
        if (ev.type === 'WORKSPACE_UPDATED' || p.userId === meId) {
          void queryClient.refetchQueries({ queryKey: ['workspaces'] }).then(() => {
            const fresh = queryClient.getQueryData<Workspace[]>(['workspaces'])?.find(w => w.id === workspaceId)
            if (fresh && useWorkspaceStore.getState().current?.id === workspaceId) setCurrentWorkspace(fresh)
          })
        }
        return
      }
      case 'MESSAGE_CREATED': {
        if (!p.channelId) return
        const own = p.authorId === meId
        const reading = getActiveChatChannel() === p.channelId && document.visibilityState === 'visible'
        queryClient.setQueryData<Channel[]>(['channels', workspaceId], old => {
          if (!old) return old
          const idx = old.findIndex(c => c.id === p.channelId)
          // Canale non visibile a questo utente (stanza privata/DM altrui): ignorato.
          if (idx < 0) return old
          const ch = old[idx]
          const next = old.slice()
          next[idx] = {
            ...ch,
            updatedAt: ev.timestamp ?? ch.updatedAt,
            unreadCount: own || reading ? ch.unreadCount : (ch.unreadCount || 0) + 1,
          }
          return next
        })
        onMessageRef.current?.(p)
        return
      }
      default: {
        const keysFor = INVALIDATIONS[ev.type]
        if (keysFor) batcher.add(keysFor(workspaceId, ev))
      }
    }
  })

  // Coda personale: CHANNEL_READ arriva solo a chi ha letto (anche da un'altra scheda/dispositivo).
  useUserEvents(ev => {
    // Notifiche in-app: aggiornate in cache (lista + contatore) senza refetch.
    const userType = ev.type as WsEventType | NotificationWsEventType
    if (userType === 'NOTIFICATION') {
      const n = ev.payload as AppNotification | undefined
      if (!n?.id) return
      prependNotification(queryClient, n)
      // Notifica di sistema (se l'utente ha concesso il permesso) quando l'app non è in primo piano.
      if (!appIsForeground()) {
        showChatNotification({
          title: n.title,
          body: n.body ?? '',
          tag: `notif-${n.id}`,
          onClick: n.link ? () => navigate(n.link!) : undefined,
        })
      }
      return
    }
    if (userType === 'NOTIFICATIONS_READ') {
      applyRemoteRead(queryClient, ev.payload || {})
      return
    }
    if (ev.type !== 'CHANNEL_READ') return
    const { workspaceId: wsId, channelId } = ev.payload || {}
    if (!wsId || !channelId) return
    queryClient.setQueryData<Channel[]>(['channels', wsId], old => {
      if (!old) return old
      const idx = old.findIndex(c => c.id === channelId)
      if (idx < 0 || !old[idx].unreadCount) return old
      const next = old.slice()
      next[idx] = { ...old[idx], unreadCount: 0 }
      return next
    })
  })

  // Dopo una riconnessione riallinea le query attive del workspace (eventi persi offline).
  useEffect(() => {
    return onWSConnect(({ reconnect }) => {
      if (reconnect && workspaceId) batcherRef.current?.add(RECONNECT_KEYS(workspaceId))
    })
  }, [workspaceId])
}
