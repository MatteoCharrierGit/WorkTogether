import {
  SCREEN_RESOLUTIONS, SCREEN_FPS_OPTIONS, type ScreenSettings,
} from '@/contexts/VoiceSession'
import {
  DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'
import { Check, Gamepad2 } from 'lucide-react'

/** Contenuto del menu qualità della condivisione schermo (condiviso da VoiceBar e RoomVoicePanel). */
export function ScreenSettingsMenuContent({
  settings, onChange, align = 'start',
}: {
  settings: ScreenSettings
  onChange: (patch: Partial<ScreenSettings>) => void
  align?: 'start' | 'end'
}) {
  return (
    <DropdownMenuContent align={align} side="top" className="w-56">
      <DropdownMenuLabel>Risoluzione</DropdownMenuLabel>
      {SCREEN_RESOLUTIONS.map(r => (
        <DropdownMenuItem key={r.id} onClick={() => onChange({ resolution: r })}>
          <span className="flex-1">{r.label}</span>
          {r.id === settings.resolution.id && <Check className="h-4 w-4 text-primary" />}
        </DropdownMenuItem>
      ))}
      <DropdownMenuSeparator />
      <DropdownMenuLabel>Frame rate</DropdownMenuLabel>
      {SCREEN_FPS_OPTIONS.map(fps => (
        <DropdownMenuItem key={fps} onClick={() => onChange({ fps })}>
          <span className="flex-1">{fps} fps</span>
          {fps === settings.fps && <Check className="h-4 w-4 text-primary" />}
        </DropdownMenuItem>
      ))}
      <DropdownMenuSeparator />
      <DropdownMenuItem onClick={() => onChange({ motion: !settings.motion })}>
        <Gamepad2 className="h-4 w-4" />
        <span className="flex-1">Ottimizza movimento/giochi</span>
        {settings.motion && <Check className="h-4 w-4 text-primary" />}
      </DropdownMenuItem>
    </DropdownMenuContent>
  )
}
