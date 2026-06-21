import { useEffect, useRef } from 'react'
import { presenceApi } from '@/lib/api'
import { useWorkspaceStore } from '@/store/workspaceStore'
import { usePresenceStore } from '@/store/presenceStore'
import { useVoiceSession } from '@/contexts/VoiceSession'
import { subscribeWorkspace } from '@/lib/websocket'
import { WsEvent } from '@/types'

const HEARTBEAT_MS = 20_000

/**
 * Gestore di presenza (senza UI): manda un heartbeat periodico col canale vocale corrente
 * e aggiorna lo store con gli eventi PRESENCE diffusi sul workspace. Montato una volta nel Layout.
 */
export function PresenceManager() {
  const wsId = useWorkspaceStore(s => s.current?.id)
  const setAll = usePresenceStore(s => s.setAll)
  const clear = usePresenceStore(s => s.clear)
  const voice = useVoiceSession()

  // Canale vocale corrente solo se la call è in QUESTO workspace.
  const inCall = voice.status === 'connected' && voice.wsId === wsId ? voice.channelId : null
  const inCallRef = useRef<string | null>(inCall)
  inCallRef.current = inCall

  // Heartbeat periodico + snapshot iniziale.
  useEffect(() => {
    if (!wsId) { clear(); return }
    let alive = true
    const beat = () => {
      presenceApi.heartbeat(wsId, inCallRef.current)
        .then(list => { if (alive) setAll(list) })
        .catch(() => {})
    }
    beat() // immediato all'ingresso nel workspace
    const t = setInterval(beat, HEARTBEAT_MS)
    return () => { alive = false; clearInterval(t) }
  }, [wsId, setAll, clear])

  // Heartbeat immediato quando cambia lo stato "in chiamata".
  useEffect(() => {
    if (!wsId) return
    presenceApi.heartbeat(wsId, inCall).then(setAll).catch(() => {})
  }, [inCall, wsId, setAll])

  // Aggiornamenti realtime di presenza.
  useEffect(() => {
    if (!wsId) return
    const unsub = subscribeWorkspace(wsId, (ev: WsEvent) => {
      if (ev.type === 'PRESENCE') {
        const online = ev.payload?.online
        if (Array.isArray(online)) setAll(online)
      }
    })
    return unsub
  }, [wsId, setAll])

  return null
}
