import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, ReactNode,
} from 'react'
// Solo tipi: livekit-client (~500 kB) viene caricato con import() dinamico al primo join,
// così non pesa sul bundle iniziale di chi non entra mai in una stanza vocale.
import type {
  Room, RemoteTrack, LocalTrackPublication, RemoteTrackPublication,
} from 'livekit-client'
import { useQuery } from '@tanstack/react-query'
import { channelsApi, workspacesApi } from '@/lib/api'
import { useAuthStore } from '@/store/authStore'
import { toast } from '@/components/ui/toast'

export interface VoiceParticipant {
  identity: string
  name: string
  avatar?: string
  speaking: boolean
  muted: boolean
  isLocal: boolean
  isScreenSharing: boolean
}

interface ActiveScreen { identity: string; name: string; sid: string }

/**
 * Impostazioni granulari per la condivisione schermo. Risoluzione e fps si scelgono
 * separatamente; `motion` ottimizza per il movimento (giochi/video) invece che per la
 * nitidezza del testo. Il bitrate è derivato da risoluzione×fps: più alti = più carico
 * sull'encoder (CPU), che sulla VPS è il vero collo di bottiglia, non la banda.
 */
export interface ScreenResolution {
  id: string
  label: string
  width: number
  height: number
}

export const SCREEN_RESOLUTIONS: ScreenResolution[] = [
  { id: '720p',  label: '720p (1280×720)',   width: 1280, height: 720 },
  { id: '900p',  label: '900p (1600×900)',   width: 1600, height: 900 },
  { id: '1080p', label: '1080p (1920×1080)', width: 1920, height: 1080 },
  { id: '1440p', label: '1440p (2560×1440)', width: 2560, height: 1440 },
  { id: '4k',    label: '4K (3840×2160)',    width: 3840, height: 2160 },
]

export const SCREEN_FPS_OPTIONS = [15, 30, 60] as const

export interface ScreenSettings {
  resolution: ScreenResolution
  fps: number
  motion: boolean
}

const DEFAULT_SCREEN_SETTINGS: ScreenSettings = {
  resolution: SCREEN_RESOLUTIONS[2], // 1080p
  fps: 30,
  motion: false,
}
const SCREEN_SETTINGS_STORAGE_KEY = 'screenShareSettings'

function loadScreenSettings(): ScreenSettings {
  try {
    const raw = localStorage.getItem(SCREEN_SETTINGS_STORAGE_KEY)
    if (!raw) return DEFAULT_SCREEN_SETTINGS
    const saved = JSON.parse(raw) as { resolutionId?: string; fps?: number; motion?: boolean }
    const resolution = SCREEN_RESOLUTIONS.find(r => r.id === saved.resolutionId) ?? DEFAULT_SCREEN_SETTINGS.resolution
    const fps = SCREEN_FPS_OPTIONS.includes(saved.fps as any) ? saved.fps! : DEFAULT_SCREEN_SETTINGS.fps
    return { resolution, fps, motion: !!saved.motion }
  } catch {
    return DEFAULT_SCREEN_SETTINGS
  }
}

/**
 * Bitrate massimo (bps) derivato da risoluzione×fps con un fattore bit-per-pixel.
 * 'motion' alza il fattore (il movimento comprime peggio). Limitato per non esagerare con la CPU.
 */
function computeScreenBitrate(width: number, height: number, fps: number, motion: boolean): number {
  const bpp = motion ? 0.12 : 0.08
  const raw = width * height * fps * bpp
  return Math.round(Math.max(1_000_000, Math.min(raw, 25_000_000)))
}

export function describeScreenSettings(st: ScreenSettings): string {
  return `${st.resolution.id} · ${st.fps}fps${st.motion ? ' · movimento' : ''}`
}

type Status = 'idle' | 'connecting' | 'connected'

type LiveKit = typeof import('livekit-client')
let livekitModule: LiveKit | null = null
let livekitPromise: Promise<LiveKit> | null = null

/** Carica (una sola volta) il modulo livekit-client. */
function loadLiveKit(): Promise<LiveKit> {
  if (livekitModule) return Promise.resolve(livekitModule)
  if (!livekitPromise) {
    livekitPromise = import('livekit-client')
      .then(m => { livekitModule = m; return m })
      .catch(err => { livekitPromise = null; throw err })
  }
  return livekitPromise
}

/**
 * Pre-carica livekit-client in idle (es. quando si apre una stanza vocale), così il click su
 * "Entra in chiamata" non deve attendere il download. Errori ignorati: join() ritenta.
 */
export function preloadVoice() {
  loadLiveKit().catch(() => {})
}

interface JoinParams {
  wsId: string
  channelId: string
  channelName: string
  screenShareEnabled: boolean
}

/**
 * Il contesto è diviso in tre parti per limitare i re-render:
 * - actions: callback stabili (identità costante per tutta la vita del provider);
 * - status: stato che cambia di rado (connessione, canale, mute locale, schermo attivo…);
 * - participants: dati volatili (lista partecipanti con `speaking`, volumi) aggiornati a ogni
 *   ActiveSpeakersChanged. Solo chi li legge si ri-renderizza a ogni cambio di speaker.
 */
export interface VoiceActions {
  setParticipantVolume: (identity: string, volume: number) => void
  setScreenViewerOpen: (v: boolean) => void
  setScreenSettings: (patch: Partial<ScreenSettings>) => Promise<void>
  join: (p: JoinParams) => Promise<void>
  leave: () => Promise<void>
  toggleMute: () => Promise<void>
  switchMic: (deviceId: string) => Promise<void>
  startScreenShare: () => Promise<void>
  stopScreenShare: () => Promise<void>
  attachScreen: (el: HTMLVideoElement | null) => void
}

export interface VoiceStatus {
  status: Status
  reconnecting: boolean
  wsId: string | null
  channelId: string | null
  channelName: string | null
  screenShareAllowed: boolean
  muted: boolean
  isSharing: boolean
  activeScreen: ActiveScreen | null
  devices: MediaDeviceInfo[]
  activeDeviceId: string
  screenViewerOpen: boolean
  screenSettings: ScreenSettings
}

export interface VoiceParticipantsState {
  participants: VoiceParticipant[]
  // Volume di riproduzione per partecipante remoto (identity → 0..1; 0 = mutato localmente).
  participantVolumes: Record<string, number>
}

export type VoiceSessionValue = VoiceActions & VoiceStatus & VoiceParticipantsState

const VoiceActionsContext = createContext<VoiceActions | null>(null)
const VoiceStatusContext = createContext<VoiceStatus | null>(null)
const VoiceParticipantsContext = createContext<VoiceParticipantsState | null>(null)

function required<T>(v: T | null, hook: string): T {
  if (!v) throw new Error(`${hook} deve stare dentro <VoiceSessionProvider>`)
  return v
}

/** Azioni (join/leave/mute/schermo…): identità stabile, non causa re-render. */
export function useVoiceActions() {
  return required(useContext(VoiceActionsContext), 'useVoiceActions')
}

/** Stato poco volatile della sessione (status, canale, mute, schermo attivo…). */
export function useVoiceStatus() {
  return required(useContext(VoiceStatusContext), 'useVoiceStatus')
}

/** Partecipanti e volumi: cambia a ogni variazione degli speaker attivi. */
export function useVoiceParticipants() {
  return required(useContext(VoiceParticipantsContext), 'useVoiceParticipants')
}

/** Retro-compatibile: tutto insieme (si ri-renderizza a ogni cambio partecipanti). */
export function useVoiceSession(): VoiceSessionValue {
  const actions = useVoiceActions()
  const status = useVoiceStatus()
  const parts = useVoiceParticipants()
  return useMemo(() => ({ ...actions, ...status, ...parts }), [actions, status, parts])
}

interface Member { userId: string; displayName: string; avatar?: string }

export function VoiceSessionProvider({ children }: { children: ReactNode }) {
  const me = useAuthStore(s => s.user)

  const [status, setStatus] = useState<Status>('idle')
  const statusRef = useRef<Status>(status)
  statusRef.current = status
  const [reconnecting, setReconnecting] = useState(false)
  const [wsId, setWsId] = useState<string | null>(null)
  const [channelId, setChannelId] = useState<string | null>(null)
  const [channelName, setChannelName] = useState<string | null>(null)
  const [screenShareAllowed, setScreenShareAllowed] = useState(false)
  const [participants, setParticipants] = useState<VoiceParticipant[]>([])
  const [muted, setMuted] = useState(false)
  // Volume per partecipante (controllo locale: non influisce sugli altri client).
  const [participantVolumes, setParticipantVolumes] = useState<Record<string, number>>({})
  const volumesRef = useRef<Record<string, number>>({})
  volumesRef.current = participantVolumes
  const [isSharing, setIsSharing] = useState(false)
  const [activeScreen, setActiveScreen] = useState<ActiveScreen | null>(null)
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [activeDeviceId, setActiveDeviceId] = useState('')
  const [screenViewerOpen, setScreenViewerOpen] = useState(true)
  const [screenSettings, setScreenSettingsState] = useState<ScreenSettings>(loadScreenSettings)

  const roomRef = useRef<Room | null>(null)
  const audioContainer = useRef<HTMLDivElement>(null)
  const screenTrackRef = useRef<RemoteTrack | LocalTrackPublication['track'] | null>(null)
  // Ref per leggere le impostazioni correnti dentro startScreenShare senza ricrearne la callback.
  const screenSettingsRef = useRef<ScreenSettings>(screenSettings)
  screenSettingsRef.current = screenSettings

  // Risolve nome/avatar dei partecipanti (identity LiveKit = userId) per il workspace della call.
  const { data: members = [] } = useQuery<Member[]>({
    queryKey: ['members', wsId],
    queryFn: () => workspacesApi.getMembers(wsId!),
    enabled: !!wsId,
  })
  const resolveRef = useRef<(id: string) => { name: string; avatar?: string }>(() => ({ name: 'Utente' }))
  resolveRef.current = (id: string) => {
    if (id === me?.id) return { name: me?.displayName ?? 'Tu', avatar: me?.avatar }
    const m = members.find(x => x.userId === id)
    return m ? { name: m.displayName, avatar: m.avatar } : { name: 'Utente' }
  }

  const sync = useCallback(() => {
    const room = roomRef.current
    const lk = livekitModule
    if (!room || !lk) return
    const { Track } = lk
    const resolve = resolveRef.current
    const lp = room.localParticipant
    const lu = resolve(lp.identity)
    const localScreen = lp.getTrackPublication(Track.Source.ScreenShare)

    const parts: VoiceParticipant[] = [{
      identity: lp.identity, name: lu.name, avatar: lu.avatar,
      speaking: lp.isSpeaking, muted: !lp.isMicrophoneEnabled, isLocal: true,
      isScreenSharing: !!localScreen?.track,
    }]
    room.remoteParticipants.forEach(p => {
      const u = resolve(p.identity)
      const mic = p.getTrackPublication(Track.Source.Microphone)
      const sc = p.getTrackPublication(Track.Source.ScreenShare)
      // Riapplica il volume scelto localmente: nuove sottoscrizioni/riconnessioni ripartirebbero a 1.
      const vol = volumesRef.current[p.identity]
      if (vol !== undefined) { try { p.setVolume(vol) } catch { /* nessuna traccia audio ancora */ } }
      parts.push({
        identity: p.identity, name: u.name, avatar: u.avatar,
        speaking: p.isSpeaking, muted: mic?.isMuted ?? true, isLocal: false,
        isScreenSharing: !!(sc?.isSubscribed && sc?.track),
      })
    })
    setParticipants(parts)
    setMuted(!lp.isMicrophoneEnabled)
    setIsSharing(!!localScreen?.track)

    // Schermo attivo: il mio se sto condividendo, altrimenti il primo remoto sottoscritto.
    let screen: { identity: string; name: string; sid: string; track: any } | null = null
    if (localScreen?.track) {
      screen = { identity: lp.identity, name: lu.name, sid: localScreen.trackSid, track: localScreen.track }
    } else {
      for (const p of room.remoteParticipants.values()) {
        const sc = p.getTrackPublication(Track.Source.ScreenShare)
        if (sc?.isSubscribed && sc.track) {
          const u = resolve(p.identity)
          screen = { identity: p.identity, name: u.name, sid: sc.trackSid, track: sc.track }
          break
        }
      }
    }
    screenTrackRef.current = screen?.track ?? null
    // Aggiorna solo se cambia davvero: sync() gira a ogni ActiveSpeakersChanged e un nuovo
    // oggetto a ogni chiamata ri-renderizzerebbe tutti i consumer dello stato "stabile".
    setActiveScreen(prev => {
      if (!screen) return null
      if (prev && prev.identity === screen.identity && prev.sid === screen.sid && prev.name === screen.name) return prev
      return { identity: screen.identity, name: screen.name, sid: screen.sid }
    })
  }, [])

  // Ricalcola quando cambia la lista membri (per i nomi).
  useEffect(() => { if (status === 'connected') sync() }, [members, status, sync])

  const reset = useCallback(() => {
    roomRef.current = null
    screenTrackRef.current = null
    setStatus('idle'); setReconnecting(false); setWsId(null); setChannelId(null); setChannelName(null)
    setScreenShareAllowed(false); setParticipants([]); setMuted(false)
    setIsSharing(false); setActiveScreen(null); setDevices([]); setActiveDeviceId('')
    setParticipantVolumes({})
  }, [])

  // Generazione del join: leave() (o un nuovo join) la incrementa, così un join ancora in attesa
  // di token/modulo/connessione si accorge di essere superato e chiude la propria Room.
  const joinGenRef = useRef(0)

  const join = useCallback(async (p: JoinParams) => {
    if (statusRef.current === 'connecting') return
    const gen = ++joinGenRef.current
    const stale = () => gen !== joinGenRef.current
    statusRef.current = 'connecting'
    let room: Room | null = null
    if (roomRef.current) {
      const prev = roomRef.current
      roomRef.current = null
      await prev.disconnect().catch(() => {})
      if (stale()) return
      reset()
      statusRef.current = 'connecting'
    }

    setStatus('connecting'); setWsId(p.wsId); setChannelId(p.channelId)
    setChannelName(p.channelName); setScreenShareAllowed(p.screenShareEnabled)
    setScreenViewerOpen(true)
    try {
      // Token e modulo LiveKit in parallelo: il download del chunk non allunga il join.
      const [{ url, token }, { Room, RoomEvent, Track }] = await Promise.all([
        channelsApi.voiceToken(p.wsId, p.channelId),
        loadLiveKit(),
      ])
      if (stale()) return
      if (!url) throw new Error('URL del media server non configurato')

      room = new Room({
        adaptiveStream: true,
        dynacast: true,
        audioCaptureDefaults: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      })
      roomRef.current = room
      const thisRoom = room

      room
        .on(RoomEvent.ParticipantConnected, sync)
        .on(RoomEvent.ParticipantDisconnected, sync)
        .on(RoomEvent.ActiveSpeakersChanged, sync)
        .on(RoomEvent.TrackMuted, sync)
        .on(RoomEvent.TrackUnmuted, sync)
        .on(RoomEvent.LocalTrackPublished, sync)
        .on(RoomEvent.LocalTrackUnpublished, sync)
        .on(RoomEvent.TrackSubscribed, (track: RemoteTrack, _pub: RemoteTrackPublication) => {
          if (track.kind === Track.Kind.Audio) {
            const el = track.attach()
            el.setAttribute('data-lk-audio', '1')
            audioContainer.current?.appendChild(el)
          }
          sync()
        })
        .on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack) => {
          if (track.kind === Track.Kind.Audio) track.detach().forEach(el => el.remove())
          sync()
        })
        .on(RoomEvent.Reconnecting, () => setReconnecting(true))
        .on(RoomEvent.Reconnected, () => { setReconnecting(false); sync() })
        // Solo la Room corrente resetta lo stato (una Room di un join superato no).
        .on(RoomEvent.Disconnected, () => { if (roomRef.current === thisRoom) reset() })

      await room.connect(url, token)
      if (stale()) throw new Error('stale join')
      await room.localParticipant.setMicrophoneEnabled(true)
      if (stale()) throw new Error('stale join')
      await room.startAudio().catch(() => {})
      if (stale()) throw new Error('stale join')

      try {
        const mics = await Room.getLocalDevices('audioinput')
        setDevices(mics)
        setActiveDeviceId(room.getActiveDevice('audioinput') ?? mics[0]?.deviceId ?? '')
      } catch { /* etichette dispositivi non disponibili: ignora */ }
      if (stale()) throw new Error('stale join')

      statusRef.current = 'connected'
      setStatus('connected')
      sync()
    } catch (err: any) {
      if (stale()) {
        // Join annullato (leave o nuovo join): chiude la propria Room senza toccare lo stato.
        if (room && roomRef.current === room) roomRef.current = null
        await room?.disconnect().catch(() => {})
        return
      }
      await roomRef.current?.disconnect().catch(() => {})
      reset()
      const msg = err?.response?.data?.error
        ?? (err?.name === 'NotAllowedError' ? 'Permesso microfono negato' : err?.message)
        ?? 'Impossibile entrare nella stanza vocale'
      toast(msg, 'destructive')
      throw err
    }
  }, [sync, reset])

  const leave = useCallback(async () => {
    joinGenRef.current++ // invalida un eventuale join in corso
    statusRef.current = 'idle'
    const room = roomRef.current
    reset()
    await room?.disconnect().catch(() => {})
  }, [reset])

  const toggleMute = useCallback(async () => {
    const room = roomRef.current
    if (!room) return
    await room.localParticipant.setMicrophoneEnabled(!room.localParticipant.isMicrophoneEnabled)
    sync()
  }, [sync])

  // Imposta il volume di ascolto di un partecipante remoto (solo lato locale). 0 = mutato per me.
  const setParticipantVolume = useCallback((identity: string, volume: number) => {
    const v = Math.max(0, Math.min(1, volume))
    setParticipantVolumes(prev => ({ ...prev, [identity]: v }))
    const p = roomRef.current?.remoteParticipants.get(identity)
    if (p) { try { p.setVolume(v) } catch { /* la traccia audio potrebbe non esserci ancora */ } }
  }, [])

  const switchMic = useCallback(async (deviceId: string) => {
    const room = roomRef.current
    if (!room) return
    try {
      await room.switchActiveDevice('audioinput', deviceId)
      setActiveDeviceId(deviceId)
    } catch {
      toast('Cambio microfono non riuscito', 'destructive')
    }
  }, [])

  const startScreenShare = useCallback(async (settings?: ScreenSettings) => {
    const room = roomRef.current
    if (!room) return
    // Un publisher per volta: blocca se qualcun altro sta già condividendo.
    const { Track } = livekitModule!
    const other = [...room.remoteParticipants.values()]
      .some(p => p.getTrackPublication(Track.Source.ScreenShare)?.isSubscribed)
    if (other) { toast('Qualcuno sta già condividendo lo schermo', 'destructive'); return }
    const st = settings ?? screenSettingsRef.current
    const { width, height } = st.resolution
    const maxBitrate = computeScreenBitrate(width, height, st.fps, st.motion)
    try {
      await room.localParticipant.setScreenShareEnabled(
        true,
        { resolution: { width, height, frameRate: st.fps }, contentHint: st.motion ? 'motion' : 'detail', audio: false },
        // motion (giochi/video): privilegia gli fps. detail (testo/codice): privilegia la risoluzione.
        {
          degradationPreference: st.motion ? 'maintain-framerate' : 'maintain-resolution',
          screenShareEncoding: { maxBitrate, maxFramerate: st.fps },
        },
      )
      setScreenViewerOpen(true)
      sync()
    } catch (err: any) {
      if (err?.name !== 'NotAllowedError') {
        toast('Impossibile avviare la condivisione', 'destructive')
      }
    }
  }, [sync])

  const stopScreenShare = useCallback(async () => {
    const room = roomRef.current
    if (!room) return
    await room.localParticipant.setScreenShareEnabled(false)
    sync()
  }, [sync])

  // Aggiorna risoluzione/fps/motion (merge parziale). Se sto già condividendo, ripubblica con i
  // nuovi parametri (il browser richiede di nuovo la selezione dello schermo: l'encoding non si
  // cambia a caldo).
  const setScreenSettings = useCallback(async (patch: Partial<ScreenSettings>) => {
    const next: ScreenSettings = { ...screenSettingsRef.current, ...patch }
    setScreenSettingsState(next)
    screenSettingsRef.current = next
    try {
      localStorage.setItem(SCREEN_SETTINGS_STORAGE_KEY, JSON.stringify({
        resolutionId: next.resolution.id, fps: next.fps, motion: next.motion,
      }))
    } catch { /* storage non disponibile */ }
    const room = roomRef.current
    const sharing = !!(room && livekitModule
      && room.localParticipant.getTrackPublication(livekitModule.Track.Source.ScreenShare)?.track)
    if (sharing) {
      await stopScreenShare()
      await startScreenShare(next)
    }
  }, [startScreenShare, stopScreenShare])

  const attachScreen = useCallback((el: HTMLVideoElement | null) => {
    const track = screenTrackRef.current
    if (el && track) track.attach(el)
  }, [])

  // Smonta la sessione se l'utente fa logout.
  useEffect(() => {
    if (!me) { roomRef.current?.disconnect().catch(() => {}); }
  }, [me])

  const actions = useMemo<VoiceActions>(() => ({
    setParticipantVolume, setScreenViewerOpen, setScreenSettings,
    join, leave, toggleMute, switchMic, startScreenShare, stopScreenShare, attachScreen,
  }), [setParticipantVolume, setScreenSettings,
    join, leave, toggleMute, switchMic, startScreenShare, stopScreenShare, attachScreen])

  const statusValue = useMemo<VoiceStatus>(() => ({
    status, reconnecting, wsId, channelId, channelName, screenShareAllowed,
    muted, isSharing, activeScreen, devices, activeDeviceId, screenViewerOpen, screenSettings,
  }), [status, reconnecting, wsId, channelId, channelName, screenShareAllowed,
    muted, isSharing, activeScreen, devices, activeDeviceId, screenViewerOpen, screenSettings])

  const participantsValue = useMemo<VoiceParticipantsState>(
    () => ({ participants, participantVolumes }),
    [participants, participantVolumes],
  )

  return (
    <VoiceActionsContext.Provider value={actions}>
      <VoiceStatusContext.Provider value={statusValue}>
        <VoiceParticipantsContext.Provider value={participantsValue}>
          {children}
          {/* Audio remoti: contenitore nascosto persistente (sopravvive ai cambi pagina). */}
          <div ref={audioContainer} className="hidden" />
        </VoiceParticipantsContext.Provider>
      </VoiceStatusContext.Provider>
    </VoiceActionsContext.Provider>
  )
}
