import { useEffect, useRef, useState } from 'react'
import { useVoiceActions, useVoiceStatus } from '@/contexts/VoiceSession'
import { IconButton } from '@/components/ui/icon-button'
import { cn } from '@/lib/utils'
import { Minus, Monitor, Maximize2, Minimize2 } from 'lucide-react'

/**
 * Visualizzatore dello schermo condiviso. Si apre "grande", riempiendo l'area principale
 * della pagina (a destra della sidebar): a questa dimensione l'adaptiveStream di LiveKit
 * sottoscrive il layer a piena risoluzione, quindi l'immagine resta nitida.
 * Riducibile a riquadro flottante (PiP) in basso a destra. Montato nel Layout, persiste
 * tra i cambi pagina.
 */
export function ScreenShareOverlay() {
  // Niente lista partecipanti: l'overlay non deve ri-renderizzarsi a ogni cambio di speaker.
  const s = useVoiceStatus()
  const { attachScreen, setScreenViewerOpen } = useVoiceActions()
  const videoRef = useRef<HTMLVideoElement>(null)
  // Apertura predefinita: grande. L'utente può ridurre a PiP e tornare grande.
  const [maximized, setMaximized] = useState(true)

  // (Ri)attacca la traccia schermo quando cambia il publisher o si riapre il viewer.
  // L'elemento <video> resta lo stesso al cambio di dimensione, quindi non serve riattaccare.
  useEffect(() => {
    if (s.activeScreen && s.screenViewerOpen && videoRef.current) {
      attachScreen(videoRef.current)
    }
  }, [s.activeScreen, s.screenViewerOpen, attachScreen])

  // Ogni volta che si apre una nuova condivisione, riparte in grande.
  useEffect(() => {
    if (s.activeScreen) setMaximized(true)
  }, [s.activeScreen?.sid])

  if (!s.activeScreen || !s.screenViewerOpen) return null

  // activeScreen è il mio schermo esattamente quando sto condividendo (vedi sync() nel contesto).
  const isLocal = s.isSharing
  const title = isLocal ? 'Stai condividendo il tuo schermo' : `${s.activeScreen.name} sta condividendo`

  return (
    <div
      role="dialog"
      aria-label={title}
      className={cn(
        // Il video resta su fondo nero in entrambi i temi (letterbox).
        'fixed z-overlay flex flex-col overflow-hidden border bg-black shadow-lg',
        maximized
          // Riempie l'area principale: su mobile a tutta larghezza, su desktop parte dopo la
          // sidebar (w-60 = 15rem) fino ai bordi.
          ? 'bottom-0 left-0 right-0 top-0 md:left-60'
          // PiP: riquadro flottante ridimensionabile in basso a destra.
          : 'bottom-3 right-3 w-[min(40vw,560px)] min-w-72 resize rounded-lg',
      )}
    >
      <div className="flex items-center gap-2 border-b bg-elevated px-2 py-1">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
          <Monitor className="h-3.5 w-3.5" />
        </span>
        <p className="min-w-0 flex-1 truncate text-caption font-medium">{title}</p>
        {isLocal && <span className="hidden shrink-0 rounded-full bg-destructive-subtle px-2 text-2xs font-semibold text-destructive sm:inline">LIVE</span>}
        <IconButton
          size="xs"
          label={maximized ? 'Riduci a riquadro' : 'Ingrandisci'}
          icon={maximized ? <Minimize2 /> : <Maximize2 />}
          onClick={() => setMaximized(m => !m)}
        />
        <IconButton
          size="xs"
          label="Nascondi schermo condiviso"
          icon={<Minus />}
          onClick={() => setScreenViewerOpen(false)}
        />
      </div>
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className={cn(
          'bg-black object-contain',
          maximized ? 'min-h-0 w-full flex-1' : 'aspect-video w-full',
        )}
      />
    </div>
  )
}
