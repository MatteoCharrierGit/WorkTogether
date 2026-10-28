import { useCallback, useEffect, useRef } from 'react'
import { presenceApi } from '@/lib/api'
import { useWorkspaceStore } from '@/store/workspaceStore'
import { usePresenceStore, type PresenceEntry } from '@/store/presenceStore'
import { useAuthStore } from '@/store/authStore'
import { useVoiceActions, useVoiceStatus } from '@/contexts/VoiceSession'
import { useWorkspaceEvents } from '@/lib/websocket'

const HEARTBEAT_MS = 20_000

/**
 * Gestore di presenza (senza UI): manda un heartbeat periodico col canale vocale corrente
 * e aggiorna lo store con gli eventi PRESENCE diffusi sul workspace. Montato una volta nel Layout.
 */
export function PresenceManager() {
  const wsId = useWorkspaceStore(s => s.current?.id)
  const meId = useAuthStore(s => s.user?.id)
  const setAllRaw = usePresenceStore(s => s.setAll)
  const clear = usePresenceStore(s => s.clear)
  // Solo stato stabile + azioni: non si ri-renderizza a ogni cambio di speaker attivo.
  const voice = useVoiceStatus()
  const { leave } = useVoiceActions()

  // Canale vocale corrente solo se la call è in QUESTO workspace.
  const inCall = voice.status === 'connected' && voice.wsId === wsId ? voice.channelId : null
  const inCallRef = useRef<string | null>(inCall)
  inCallRef.current = inCall

  // Un admin in modalità invisibile non compare negli snapshot del server (per nessuno): il
  // proprio client si considera comunque online (e nella call corrente) finché manda heartbeat.
  const meIdRef = useRef(meId)
  meIdRef.current = meId
  const setAll = useCallback((entries: PresenceEntry[]) => {
    const me = meIdRef.current
    if (me && !entries.some(e => e.userId === me)) {
      setAllRaw([...entries, { userId: me, inCallChannelId: inCallRef.current }])
    } else {
      setAllRaw(entries)
    }
  }, [setAllRaw])

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

  // Uscita immediata alla chiusura/refresh della pagina: senza questo il client resterebbe
  // "online"/"in chiamata" fino alla scadenza dell'heartbeat (~30s), lasciando un fantasma agli
  // altri utenti. `pagehide` copre chiusura tab, refresh e navigazione (più affidabile di
  // `beforeunload`, specie su mobile). Chiude anche la room LiveKit così il partecipante viene
  // rimosso subito lato media.
  const leaveRef = useRef(leave)
  leaveRef.current = leave
  useEffect(() => {
    if (!wsId) return
    const onHide = () => {
      presenceApi.offline(wsId)
      leaveRef.current?.()
    }
    window.addEventListener('pagehide', onHide)
    return () => window.removeEventListener('pagehide', onHide)
  }, [wsId])

  // Aggiornamenti realtime di presenza (setAll non ricrea lo stato se nulla è cambiato).
  useWorkspaceEvents(wsId, ev => {
    if (ev.type === 'PRESENCE') {
      const online = ev.payload?.online
      if (Array.isArray(online)) setAll(online)
    }
  })

  return null
}
