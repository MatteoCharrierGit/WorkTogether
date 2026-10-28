import {
  useVoiceActions, useVoiceStatus, useVoiceParticipants, describeScreenSettings,
} from '@/contexts/VoiceSession'
import { IconButton } from '@/components/ui/icon-button'
import { UserAvatar } from '@/components/shared'
import { cn } from '@/lib/utils'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Mic, MicOff, PhoneOff, Settings, Check, MonitorUp, MonitorOff, Monitor, Volume2, VolumeX, Gauge,
} from 'lucide-react'
import { ScreenSettingsMenuContent } from './ScreenSettingsMenu'

/**
 * Barra di controllo persistente della sessione vocale (stile Discord): resta visibile
 * mentre navighi l'app. Montata nel Layout, legge lo stato dal contesto globale.
 */
export function VoiceBar() {
  // Stato stabile + azioni: la parte che dipende dagli speaker attivi è isolata nei
  // sottocomponenti sotto, così ActiveSpeakersChanged non ri-renderizza tutta la barra.
  const s = { ...useVoiceStatus(), ...useVoiceActions() }
  if (s.status === 'idle') return null

  const connecting = s.status === 'connecting'
  const unstable = connecting || s.reconnecting

  return (
    <div
      role="region"
      aria-label="Chiamata vocale"
      className="fixed bottom-3 left-3 z-modal w-72 max-w-[calc(100vw-1.5rem)] rounded-lg border bg-elevated shadow-lg"
    >
      <div className="flex items-center gap-2 px-3 py-2">
        <span className={cn('h-2 w-2 shrink-0 rounded-full', unstable ? 'animate-pulse bg-warning' : 'bg-success')} aria-hidden />
        <div className="min-w-0 flex-1">
          <p className={cn('text-caption font-semibold', unstable ? 'text-warning' : 'text-success')}>
            {connecting ? 'Connessione…' : s.reconnecting ? 'Riconnessione…' : 'Voce connessa'}
          </p>
          <p className="flex items-center gap-1 truncate text-2xs text-muted-foreground">
            <Volume2 className="h-3 w-3 shrink-0" />
            <span className="truncate">{s.channelName ?? 'Stanza vocale'}</span>
            {!unstable && <> · <ParticipantCount /></>}
          </p>
        </div>
        <IconButton
          label="Esci dalla chiamata"
          icon={<PhoneOff />}
          variant="ghost"
          className="text-destructive hover:bg-destructive-subtle hover:text-destructive"
          onClick={s.leave}
        />
      </div>

      <VoiceBarParticipants />

      <div className="flex items-center gap-1 border-t px-2 py-1.5">
        <IconButton
          label={s.muted ? 'Riattiva microfono' : 'Disattiva microfono'}
          icon={s.muted ? <MicOff /> : <Mic />}
          variant={s.muted ? 'destructive' : 'ghost'}
          aria-pressed={s.muted}
          onClick={s.toggleMute}
          disabled={connecting}
        />

        {s.devices.length > 1 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton label="Scegli microfono" icon={<Settings />} />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" side="top">
              <DropdownMenuLabel>Microfono</DropdownMenuLabel>
              {s.devices.map(d => (
                <DropdownMenuItem key={d.deviceId} onClick={() => s.switchMic(d.deviceId)}>
                  <span className="max-w-52 flex-1 truncate">{d.label || 'Microfono'}</span>
                  {d.deviceId === s.activeDeviceId && <Check className="h-4 w-4 text-primary" />}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        {s.screenShareAllowed && (
          s.isSharing ? (
            <IconButton label="Interrompi condivisione schermo" icon={<MonitorOff />} variant="secondary" className="text-warning" onClick={s.stopScreenShare} />
          ) : (
            <IconButton label="Condividi schermo" icon={<MonitorUp />} onClick={() => s.startScreenShare()} disabled={connecting} />
          )
        )}

        {s.screenShareAllowed && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton label={`Qualità schermo: ${describeScreenSettings(s.screenSettings)}`} icon={<Gauge />} />
            </DropdownMenuTrigger>
            <ScreenSettingsMenuContent settings={s.screenSettings} onChange={s.setScreenSettings} />
          </DropdownMenu>
        )}

        {s.activeScreen && !s.screenViewerOpen && (
          <IconButton label="Mostra schermo condiviso" icon={<Monitor />} className="ml-auto" onClick={() => s.setScreenViewerOpen(true)} />
        )}
      </div>
    </div>
  )
}

function ParticipantCount() {
  const { participants } = useVoiceParticipants()
  return <span className="shrink-0">{participants.length} in chiamata</span>
}

/** Avatar dei partecipanti con indicatore "sta parlando" e controlli volume per-utente. */
function VoiceBarParticipants() {
  const { participants, participantVolumes } = useVoiceParticipants()
  const { setParticipantVolume } = useVoiceActions()
  if (participants.length === 0) return null
  return (
    <div className="flex flex-wrap gap-1.5 px-3 pb-2">
      {participants.map(p => {
        const vol = participantVolumes[p.identity] ?? 1
        const locallyMuted = !p.isLocal && vol === 0
        const avatar = (
          <span className={cn('relative block rounded-full transition-shadow', p.speaking && 'ring-2 ring-success ring-offset-1 ring-offset-elevated')}>
            <UserAvatar name={p.name} avatar={p.avatar} size="md" />
            {p.muted && (
              <span className="absolute -bottom-0.5 -right-0.5 rounded-full bg-elevated p-0.5" aria-label="Microfono disattivato">
                <MicOff className="h-2.5 w-2.5 text-muted-foreground" />
              </span>
            )}
            {locallyMuted && (
              <span className="absolute -right-0.5 -top-0.5 rounded-full bg-elevated p-0.5" aria-label="Silenziato per te">
                <VolumeX className="h-2.5 w-2.5 text-destructive" />
              </span>
            )}
          </span>
        )
        // Il proprio avatar non ha controlli volume; per gli altri un menu con muta + slider.
        if (p.isLocal) {
          return <span key={p.identity} title={`${p.name} (tu)`}>{avatar}</span>
        }
        return (
          <DropdownMenu key={p.identity}>
            <DropdownMenuTrigger asChild>
              <button type="button" aria-label={`${p.name}: regola volume`} title={`${p.name} — regola volume`} className="focus-ring rounded-full">
                {avatar}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="top" align="start" className="w-60 p-2">
              <div className="truncate px-1 pb-1.5 text-caption font-medium">{p.name}</div>
              <div className="flex items-center gap-1 px-0.5">
                <IconButton
                  label={vol === 0 ? 'Riattiva audio' : 'Silenzia per me'}
                  icon={vol === 0 ? <VolumeX className="text-destructive" /> : <Volume2 />}
                  size="xs"
                  onClick={() => setParticipantVolume(p.identity, vol === 0 ? 1 : 0)}
                />
                <input
                  type="range" min={0} max={1} step={0.05} value={vol}
                  aria-label={`Volume di ${p.name}`}
                  onChange={e => setParticipantVolume(p.identity, parseFloat(e.target.value))}
                  className="flex-1 cursor-pointer accent-primary"
                />
                <span className="w-8 text-right text-caption tabular-nums text-muted-foreground">
                  {Math.round(vol * 100)}
                </span>
              </div>
              <p className="px-1 pt-1.5 text-2xs text-muted-foreground">Solo per te, non per gli altri.</p>
            </DropdownMenuContent>
          </DropdownMenu>
        )
      })}
    </div>
  )
}
