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
  Mic, MicOff, PhoneOff, Settings, Check, MonitorUp, MonitorOff, Monitor, Volume2, Gauge, Gamepad2,
} from 'lucide-react'

/**
 * Barra di controllo persistente della sessione vocale (stile Discord): resta visibile
 * mentre navighi l'app. Montata nel Layout, legge lo stato dal contesto globale.
 */
export function VoiceBar() {
  const s = useVoiceSession()
  if (s.status === 'idle') return null

  const connecting = s.status === 'connecting'

  return (
    <div className="fixed bottom-3 left-3 z-40 w-72 rounded-xl border bg-card shadow-lg">
      <div className="flex items-center gap-2 px-3 py-2 border-b">
        <span className={cn('h-2 w-2 rounded-full shrink-0',
          connecting || s.reconnecting ? 'bg-amber-500 animate-pulse' : 'bg-green-500')} />
        <Volume2 className="h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold truncate">{s.channelName ?? 'Stanza vocale'}</p>
          <p className="text-[11px] text-muted-foreground">
            {connecting ? 'Connessione…' : s.reconnecting ? 'Riconnessione…' : `${s.participants.length} in chiamata`}
          </p>
        </div>
      </div>

      {s.participants.length > 0 && (
        <div className="flex flex-wrap gap-1 px-3 py-2">
          {s.participants.map(p => (
            <div
              key={p.identity}
              className={cn('relative rounded-full', p.speaking && 'ring-2 ring-green-500')}
              title={p.isLocal ? `${p.name} (tu)` : p.name}
            >
              <UserAvatar name={p.name} avatar={p.avatar} className="h-7 w-7" />
              {p.muted && (
                <span className="absolute -bottom-0.5 -right-0.5 rounded-full bg-card p-0.5">
                  <MicOff className="h-2.5 w-2.5 text-muted-foreground" />
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center gap-1.5 px-3 py-2 border-t">
        <Button size="icon" variant={s.muted ? 'destructive' : 'secondary'} className="h-8 w-8"
          onClick={s.toggleMute} disabled={connecting} title={s.muted ? 'Riattiva microfono' : 'Muta'}>
          {s.muted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
        </Button>

        {s.devices.length > 1 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="icon" variant="ghost" className="h-8 w-8" title="Microfono">
                <Settings className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" side="top">
              <DropdownMenuLabel>Microfono</DropdownMenuLabel>
              {s.devices.map(d => (
                <DropdownMenuItem key={d.deviceId} onClick={() => s.switchMic(d.deviceId)}>
                  <span className="flex-1 truncate max-w-[200px]">{d.label || 'Microfono'}</span>
                  {d.deviceId === s.activeDeviceId && <Check className="h-4 w-4" />}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        {s.screenShareAllowed && (
          s.isSharing ? (
            <Button size="icon" variant="secondary" className="h-8 w-8 text-amber-600" onClick={s.stopScreenShare} title="Ferma condivisione">
              <MonitorOff className="h-4 w-4" />
            </Button>
          ) : (
            <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => s.startScreenShare()} disabled={connecting} title="Condividi schermo">
              <MonitorUp className="h-4 w-4" />
            </Button>
          )
        )}

        {s.screenShareAllowed && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="icon" variant="ghost" className="h-8 w-8" title={`Qualità schermo: ${describeScreenSettings(s.screenSettings)}`}>
                <Gauge className="h-4 w-4" />
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

        {s.activeScreen && !s.screenViewerOpen && (
          <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => s.setScreenViewerOpen(true)} title="Mostra schermo condiviso">
            <Monitor className="h-4 w-4" />
          </Button>
        )}

        <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive ml-auto" onClick={s.leave} title="Esci dalla chiamata">
          <PhoneOff className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}
