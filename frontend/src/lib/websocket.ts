import { Client, StompSubscription } from '@stomp/stompjs'
import SockJS from 'sockjs-client'
import { WsEvent } from '@/types'

type WsHandler = (event: WsEvent) => void

let client: Client | null = null
// Desired subscribers (workspaceId -> set of handlers) and the live STOMP subscriptions.
// Più componenti (es. Layout + ChatPage) possono ascoltare lo stesso workspace:
// una sola subscription STOMP per workspace inoltra l'evento a tutti gli handler.
const handlers = new Map<string, Set<WsHandler>>()
const active = new Map<string, StompSubscription>()

function doSubscribe(workspaceId: string) {
  // Only subscribe when the underlying STOMP connection is actually up,
  // otherwise @stomp/stompjs throws ("no underlying STOMP connection").
  if (!client || !client.connected) return
  if (active.has(workspaceId)) return
  const set = handlers.get(workspaceId)
  if (!set || set.size === 0) return
  const sub = client.subscribe(`/topic/workspace/${workspaceId}`, msg => {
    let event: WsEvent
    try {
      event = JSON.parse(msg.body) as WsEvent
    } catch {
      return /* ignore malformed frames */
    }
    handlers.get(workspaceId)?.forEach(h => {
      try {
        h(event)
      } catch {
        /* un handler che fallisce non deve bloccare gli altri */
      }
    })
  })
  active.set(workspaceId, sub)
}

export function connectWS(token: string): Client {
  if (client) return client

  client = new Client({
    webSocketFactory: () => new SockJS('/ws'),
    connectHeaders: { Authorization: `Bearer ${token}` },
    reconnectDelay: 3000,
    onConnect: () => {
      // (Re)subscribe every desired workspace once the connection is ready.
      active.clear()
      handlers.forEach((_, wsId) => doSubscribe(wsId))
    },
    onWebSocketClose: () => {
      // Stale subscription objects: clear so onConnect can recreate them.
      active.clear()
    },
  })

  client.activate()
  return client
}

export function subscribeWorkspace(
  workspaceId: string,
  onEvent: (event: WsEvent) => void
): () => void {
  let set = handlers.get(workspaceId)
  if (!set) {
    set = new Set()
    handlers.set(workspaceId, set)
  }
  set.add(onEvent)
  // Subscribe immediately if already connected; otherwise onConnect handles it.
  doSubscribe(workspaceId)

  return () => {
    const s = handlers.get(workspaceId)
    s?.delete(onEvent)
    // Solo quando nessuno ascolta più il workspace chiudiamo la subscription STOMP.
    if (!s || s.size === 0) {
      handlers.delete(workspaceId)
      const sub = active.get(workspaceId)
      if (sub) {
        try {
          sub.unsubscribe()
        } catch {
          /* connection may already be gone */
        }
        active.delete(workspaceId)
      }
    }
  }
}

export function disconnectWS() {
  active.forEach(sub => {
    try {
      sub.unsubscribe()
    } catch {
      /* ignore */
    }
  })
  active.clear()
  handlers.clear()
  client?.deactivate()
  client = null
}
