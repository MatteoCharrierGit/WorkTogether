import { Client, StompSubscription } from '@stomp/stompjs'
import SockJS from 'sockjs-client'
import { WsEvent } from '@/types'

let client: Client | null = null
// Desired subscriptions (workspaceId -> handler) and the live STOMP subscriptions.
const handlers = new Map<string, (event: WsEvent) => void>()
const active = new Map<string, StompSubscription>()

function doSubscribe(workspaceId: string) {
  // Only subscribe when the underlying STOMP connection is actually up,
  // otherwise @stomp/stompjs throws ("no underlying STOMP connection").
  if (!client || !client.connected) return
  if (active.has(workspaceId)) return
  const handler = handlers.get(workspaceId)
  if (!handler) return
  const sub = client.subscribe(`/topic/workspace/${workspaceId}`, msg => {
    try {
      handler(JSON.parse(msg.body) as WsEvent)
    } catch {
      /* ignore malformed frames */
    }
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
  handlers.set(workspaceId, onEvent)
  // Subscribe immediately if already connected; otherwise onConnect handles it.
  doSubscribe(workspaceId)

  return () => {
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
