import { useState } from 'react'
import {
  useVoiceSession, SCREEN_RESOLUTIONS, SCREEN_FPS_OPTIONS, describeScreenSettings,
} from '@/contexts/VoiceSession'
import { Button } from '@/components/ui/button'
import { UserAvatar } from '@/components/UserAvatar'
import { cn } from '@/lib/utils'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Mic, MicOff, Phone, PhoneOff, Loader2, MonitorUp, MonitorOff, Volume2, Gauge, Check, Gamepad2,
} from 'lucide-react'

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
  const s = useVoiceSession()
  const [busy, setBusy] = useState(false)
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
      <div className="flex items-center justify-between gap-3 rounded-lg border bg-muted/30 px-3 py-2.5">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Volume2 className="h-4 w-4" />
          <span>Stanza vocale{screenShareEnabled ? ' · condivisione schermo' : ''}</span>
        </div>
        <Button size="sm" onClick={join} disabled={busy || connectingHere}>
          {busy || connectingHere
            ? <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> Connessione…</>
            : <><Phone className="h-4 w-4 mr-1.5" /> Entra in chiamata</>}
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-2.5 rounded-lg border bg-muted/30 px-3 py-2.5">
      {s.reconnecting && (
        <p className="text-[11px] font-medium text-amber-600 flex items-center gap-1.5">
          <Loader2 className="h-3 w-3 animate-spin" /> Riconnessione in corso…
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {s.participants.map(p => (
          <div
            key={p.identity}
            className={cn(
              'flex items-center gap-1.5 rounded-full border bg-background pl-1 pr-2.5 py-1 text-xs transition-shadow',
              p.speaking && 'ring-2 ring-green-500',
            )}
            title={p.isLocal ? `${p.name} (tu)` : p.name}
          >
            <UserAvatar name={p.name} avatar={p.avatar} className="h-6 w-6" />
            <span className="font-medium max-w-[120px] truncate">{p.isLocal ? 'Tu' : p.name}</span>
            {p.isScreenSharing && <MonitorUp className="h-3.5 w-3.5 text-amber-600" />}
            {p.muted
              ? <MicOff className="h-3.5 w-3.5 text-muted-foreground" />
              : <Mic className={cn('h-3.5 w-3.5', p.speaking ? 'text-green-600' : 'text-muted-foreground')} />}
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <Button size="sm" variant={s.muted ? 'destructive' : 'secondary'} onClick={s.toggleMute}>
          {s.muted ? <><MicOff className="h-4 w-4 mr-1.5" /> Riattiva</> : <><Mic className="h-4 w-4 mr-1.5" /> Muta</>}
        </Button>

        {screenShareEnabled && (
          s.isSharing ? (
            <Button size="sm" variant="secondary" className="text-amber-600" onClick={s.stopScreenShare}>
              <MonitorOff className="h-4 w-4 mr-1.5" /> Ferma schermo
            </Button>
          ) : (
            <Button size="sm" variant="outline" onClick={() => s.startScreenShare()}>
              <MonitorUp className="h-4 w-4 mr-1.5" /> Condividi schermo
            </Button>
          )
        )}

        {screenShareEnabled && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="ghost" title="Qualità schermo">
                <Gauge className="h-4 w-4 mr-1.5" /> {describeScreenSettings(s.screenSettings)}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" side="top" className="w-52">
              <DropdownMenuLabel>Risoluzione</DropdownMenuLabel>
              {SCREEN_RESOLUTIONS.map(r => (
                <DropdownMenuItem key={r.id} onClick={() => s.setScreenSettings({ resolution: r })}>
                  <span className="flex-1">{r.label}</span>
                  {r.id === s.screenSettings.resolution.id && <Check className="h-4 w-4" />}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator className="-mx-1 my-1 h-px bg-muted" />
              <DropdownMenuLabel>Frame rate</DropdownMenuLabel>
              {SCREEN_FPS_OPTIONS.map(fps => (
                <DropdownMenuItem key={fps} onClick={() => s.setScreenSettings({ fps })}>
                  <span className="flex-1">{fps} fps</span>
                  {fps === s.screenSettings.fps && <Check className="h-4 w-4" />}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator className="-mx-1 my-1 h-px bg-muted" />
              <DropdownMenuItem onClick={() => s.setScreenSettings({ motion: !s.screenSettings.motion })}>
                <Gamepad2 className="h-4 w-4 mr-2" />
                <span className="flex-1">Ottimizza movimento/giochi</span>
                {s.screenSettings.motion && <Check className="h-4 w-4" />}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        <Button size="sm" variant="ghost" className="text-destructive ml-auto" onClick={s.leave}>
          <PhoneOff className="h-4 w-4 mr-1.5" /> Esci
        </Button>
      </div>
    </div>
  )
}
