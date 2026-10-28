import { useEffect, useRef } from 'react'
import { Client, StompSubscription } from '@stomp/stompjs'
import SockJS from 'sockjs-client'
import { WsEvent } from '@/types'
import { useAuthStore } from '@/store/authStore'
import { usersApi } from '@/lib/api'

/**
 * Connessione STOMP unica per tutta l'app.
 *
 * API per le pagine:
 *  - `useWorkspaceEvents(wsId, handler)`  hook: eventi di `/topic/workspace/{wsId}`.
 *     L'handler può cambiare a ogni render (è tenuto in un ref): la subscription non viene rifatta.
 *  - `useUserEvents(handler)`             hook: eventi personali di `/user/queue/events` (es. CHANNEL_READ).
 *  - `subscribeWorkspace(wsId, handler)`  versione imperativa (ritorna l'unsubscribe).
 *  - `subscribeUserEvents(handler)`       idem per la coda personale.
 *  - `onWSConnect(listener)`              chiamato a ogni (ri)connessione; `reconnect=true` dopo una
 *                                         caduta → occasione per riallineare i dati persi.
 *
 * Più componenti possono ascoltare lo stesso workspace: c'è UNA sola subscription STOMP per
 * workspace che inoltra l'evento a tutti gli handler registrati.
 */

export type WsHandler = (event: WsEvent) => void
type ConnectListener = (info: { reconnect: boolean }) => void

let client: Client | null = null
let everConnected = false
const handlers = new Map<string, Set<WsHandler>>()
const active = new Map<string, StompSubscription>()
const userHandlers = new Set<WsHandler>()
let userSub: StompSubscription | null = null
const connectListeners = new Set<ConnectListener>()

const USER_QUEUE = '/user/queue/events'

function parse(body: string): WsEvent | null {
  try {
    return JSON.parse(body) as WsEvent
  } catch {
    return null /* frame malformato: ignorato */
  }
}

function dispatch(set: Iterable<WsHandler> | undefined, event: WsEvent) {
  if (!set) return
  // Copia: un handler può disiscriversi durante il dispatch.
  for (const h of Array.from(set)) {
    try {
      h(event)
    } catch (err) {
      // Un handler che fallisce non deve bloccare gli altri.
      if (import.meta.env.DEV) console.error('[ws] handler error', err)
    }
  }
}

function doSubscribe(workspaceId: string) {
  // Solo a connessione attiva, altrimenti @stomp/stompjs lancia ("no underlying STOMP connection").
  if (!client || !client.connected) return
  if (active.has(workspaceId)) return
  const set = handlers.get(workspaceId)
  if (!set || set.size === 0) return
  const sub = client.subscribe(`/topic/workspace/${workspaceId}`, msg => {
    const event = parse(msg.body)
    if (event) dispatch(handlers.get(workspaceId), event)
  })
  active.set(workspaceId, sub)
}

function doSubscribeUser() {
  if (!client || !client.connected || userSub) return
  userSub = client.subscribe(USER_QUEUE, msg => {
    const event = parse(msg.body)
    if (event) dispatch(userHandlers, event)
  })
}

/** Scadenza (ms epoch) di un JWT, null se illeggibile. */
function jwtExpiry(token: string): number | null {
  try {
    const base64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
    const payload = JSON.parse(atob(base64))
    return typeof payload.exp === 'number' ? payload.exp * 1000 : null
  } catch {
    return null
  }
}

/**
 * Token corrente per la CONNECT. Se è scaduto (o sta per scadere) fa una chiamata autenticata
 * leggera: l'interceptor di axios rinnova il token col refresh token (deduplicato) e lo salva
 * nello store, da cui lo rileggiamo.
 */
async function freshAccessToken(): Promise<string | null> {
  let token = useAuthStore.getState().accessToken
  if (!token) return null
  const exp = jwtExpiry(token)
  if (exp !== null && exp - Date.now() < 30_000) {
    try {
      await usersApi.me()
    } catch {
      /* refresh fallito: l'interceptor gestisce il logout; tentiamo comunque */
    }
    token = useAuthStore.getState().accessToken
  }
  return token
}

/**
 * Avvia (una volta) la connessione. Il token passato è ignorato: a ogni (ri)connessione
 * `beforeConnect` legge il token CORRENTE dallo store (l'access token scade dopo 15 minuti e le
 * riconnessioni usavano quello vecchio).
 */
export function connectWS(_token?: string): Client {
  if (client) return client

  const c = new Client({
    webSocketFactory: () => new SockJS('/ws'),
    reconnectDelay: 3000,
    beforeConnect: async stomp => {
      const token = await freshAccessToken()
      if (!token) {
        // Sessione chiusa nel frattempo: niente connessione.
        void stomp.deactivate()
        return
      }
      stomp.connectHeaders = { Authorization: `Bearer ${token}` }
    },
    onConnect: () => {
      // (Ri)crea tutte le subscription desiderate ora che la connessione è pronta.
      active.clear()
      userSub = null
      handlers.forEach((_, wsId) => doSubscribe(wsId))
      doSubscribeUser()
      const reconnect = everConnected
      everConnected = true
      connectListeners.forEach(l => {
        try {
          l({ reconnect })
        } catch {
          /* ignore */
        }
      })
    },
    onWebSocketClose: () => {
      // Oggetti subscription ormai invalidi: onConnect li ricrea.
      active.clear()
      userSub = null
    },
  })

  client = c
  c.activate()
  return c
}

export function isWSConnected(): boolean {
  return !!client?.connected
}

export function subscribeWorkspace(workspaceId: string, onEvent: WsHandler): () => void {
  let set = handlers.get(workspaceId)
  if (!set) {
    set = new Set()
    handlers.set(workspaceId, set)
  }
  set.add(onEvent)
  // Subito se già connessi; altrimenti ci pensa onConnect.
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
          /* connessione già chiusa */
        }
        active.delete(workspaceId)
      }
    }
  }
}

/** Eventi personali (`/user/queue/events`), es. CHANNEL_READ {workspaceId, channelId, userId}. */
export function subscribeUserEvents(onEvent: WsHandler): () => void {
  userHandlers.add(onEvent)
  doSubscribeUser()
  return () => {
    userHandlers.delete(onEvent)
  }
}

/** Listener di (ri)connessione. Ritorna l'unsubscribe. */
export function onWSConnect(listener: ConnectListener): () => void {
  connectListeners.add(listener)
  return () => {
    connectListeners.delete(listener)
  }
}

/**
 * Hook: ascolta gli eventi del workspace. L'handler può essere una closure nuova a ogni render:
 * viene letto da un ref, quindi la subscription dipende solo da `wsId`.
 *
 *   useWorkspaceEvents(wsId, ev => { if (ev.type === 'MESSAGE_CREATED') … })
 */
export function useWorkspaceEvents(wsId: string | null | undefined, handler: WsHandler): void {
  const ref = useRef(handler)
  ref.current = handler
  useEffect(() => {
    if (!wsId) return
    return subscribeWorkspace(wsId, ev => ref.current(ev))
  }, [wsId])
}

/** Hook: eventi personali dell'utente (`/user/queue/events`). */
export function useUserEvents(handler: WsHandler): void {
  const ref = useRef(handler)
  ref.current = handler
  useEffect(() => subscribeUserEvents(ev => ref.current(ev)), [])
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
  userSub = null
  everConnected = false
  // Gli handler restano registrati: appartengono ai componenti, che li rimuovono al proprio unmount.
  void client?.deactivate()
  client = null
}

// Logout: chiude la connessione (non deve restare aperta con l'identità dell'utente precedente).
useAuthStore.subscribe((state, prev) => {
  if (prev.accessToken && !state.accessToken) disconnectWS()
})
