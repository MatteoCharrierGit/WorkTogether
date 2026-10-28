import { useEffect, useState } from 'react'
import {
  useVoiceActions, useVoiceStatus, useVoiceParticipants, preloadVoice, describeScreenSettings,
} from '@/contexts/VoiceSession'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { UserAvatar } from '@/components/shared'
import { DropdownMenu, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { Mic, MicOff, Phone, PhoneOff, MonitorUp, MonitorOff, Volume2, Gauge, Loader2 } from 'lucide-react'
import { ScreenSettingsMenuContent } from './ScreenSettingsMenu'

/**
 * Pannello voce inline mostrato nell'header di una stanza vocale in ChatPage.
 * Comanda la sessione globale: entrare qui non blocca la navigazione (i controlli
 * restano disponibili nella barra persistente anche cambiando pagina).
 */
export function RoomVoicePanel({
  wsId, channelId, channelName, screenShareEnabled,
}: {
  wsId: string
  channelId: string
  channelName: string
  screenShareEnabled: boolean
}) {
  // Stato stabile + azioni; la lista partecipanti (volatile) è in <RoomParticipants />.
  const s = { ...useVoiceStatus(), ...useVoiceActions() }
  const [busy, setBusy] = useState(false)
  // Scarica in anticipo livekit-client quando si apre una stanza vocale.
  useEffect(() => { preloadVoice() }, [])
  const here = s.status === 'connected' && s.channelId === channelId
  const connectingHere = s.status === 'connecting' && s.channelId === channelId

  const join = async () => {
    setBusy(true)
    try { await s.join({ wsId, channelId, channelName, screenShareEnabled }) }
    catch { /* errore già notificato dal contesto */ }
    finally { setBusy(false) }
  }

  if (!here) {
    return (
      <div className="flex items-center gap-3 rounded-lg border bg-surface-2 px-3 py-2">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
          <Volume2 className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-body font-medium">Stanza vocale</p>
          <p className="truncate text-2xs text-muted-foreground">
            {screenShareEnabled ? 'Voce e condivisione schermo' : 'Solo voce'}
          </p>
        </div>
        <Button size="sm" variant="secondary" className="shrink-0" onClick={join} loading={busy || connectingHere}>
          {!(busy || connectingHere) && <Phone className="h-4 w-4" />}
          {busy || connectingHere ? 'Connessione…' : 'Entra'}
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-2 rounded-lg border border-success/30 bg-success-subtle/40 px-3 py-2">
      <div className="flex items-center gap-2">
        <span className="relative flex h-2 w-2 shrink-0">
          <span className={cn('absolute inline-flex h-full w-full rounded-full opacity-60', s.reconnecting ? 'bg-warning' : 'animate-ping bg-success')} />
          <span className={cn('relative inline-flex h-2 w-2 rounded-full', s.reconnecting ? 'bg-warning' : 'bg-success')} />
        </span>
        <p className={cn('flex-1 truncate text-caption font-medium', s.reconnecting ? 'text-warning' : 'text-success')}>
          {s.reconnecting
            ? <span className="inline-flex items-center gap-1.5"><Loader2 className="h-3 w-3 animate-spin" /> Riconnessione in corso…</span>
            : 'Sei in chiamata'}
        </p>
      </div>

      <RoomParticipants />

      <div className="flex flex-wrap items-center gap-1">
        <IconButton
          label={s.muted ? 'Riattiva microfono' : 'Disattiva microfono'}
          icon={s.muted ? <MicOff /> : <Mic />}
          variant={s.muted ? 'destructive' : 'secondary'}
          aria-pressed={s.muted}
          onClick={s.toggleMute}
        />

        {screenShareEnabled && (
          s.isSharing ? (
            <IconButton label="Interrompi condivisione schermo" icon={<MonitorOff />} variant="secondary" className="text-warning" onClick={s.stopScreenShare} />
          ) : (
            <IconButton label="Condividi schermo" icon={<MonitorUp />} variant="secondary" onClick={() => s.startScreenShare()} />
          )
        )}

        {screenShareEnabled && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="ghost" className="gap-1.5 text-muted-foreground" aria-label={`Qualità schermo: ${describeScreenSettings(s.screenSettings)}`}>
                <Gauge className="h-4 w-4" />
                <span className="hidden text-caption sm:inline">{describeScreenSettings(s.screenSettings)}</span>
              </Button>
            </DropdownMenuTrigger>
            <ScreenSettingsMenuContent settings={s.screenSettings} onChange={s.setScreenSettings} />
          </DropdownMenu>
        )}

        <Button size="sm" variant="destructive" className="ml-auto" onClick={s.leave}>
          <PhoneOff className="h-4 w-4" /> Esci
        </Button>
      </div>
    </div>
  )
}

/** Partecipanti della stanza con indicatore "sta parlando" (si aggiorna a ogni cambio speaker). */
function RoomParticipants() {
  const { participants } = useVoiceParticipants()
  if (participants.length === 0) return null
  return (
    <ul className="flex flex-wrap items-center gap-1.5" aria-label="Partecipanti alla chiamata">
      {participants.map(p => (
        <li
          key={p.identity}
          className={cn(
            'flex items-center gap-1.5 rounded-full border bg-card py-0.5 pl-0.5 pr-2 text-caption transition-shadow',
            p.speaking && 'ring-2 ring-success',
          )}
          title={p.isLocal ? `${p.name} (tu)` : p.name}
        >
          <UserAvatar name={p.name} avatar={p.avatar} size="sm" />
          <span className="max-w-32 truncate font-medium">{p.isLocal ? 'Tu' : p.name}</span>
          {p.isScreenSharing && <MonitorUp className="h-3.5 w-3.5 text-warning" aria-label="Sta condividendo lo schermo" />}
          {p.muted
            ? <MicOff className="h-3.5 w-3.5 text-muted-foreground" aria-label="Microfono disattivato" />
            : <Mic className={cn('h-3.5 w-3.5', p.speaking ? 'text-success' : 'text-muted-foreground')} aria-hidden />}
        </li>
      ))}
    </ul>
  )
}
