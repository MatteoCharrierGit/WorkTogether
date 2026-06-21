import { useEffect, useRef, useState } from 'react'
import { useVoiceSession } from '@/contexts/VoiceSession'
import { Button } from '@/components/ui/button'
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
  const s = useVoiceSession()
  const videoRef = useRef<HTMLVideoElement>(null)
  // Apertura predefinita: grande. L'utente può ridurre a PiP e tornare grande.
  const [maximized, setMaximized] = useState(true)

  // (Ri)attacca la traccia schermo quando cambia il publisher o si riapre il viewer.
  // L'elemento <video> resta lo stesso al cambio di dimensione, quindi non serve riattaccare.
  useEffect(() => {
    if (s.activeScreen && s.screenViewerOpen && videoRef.current) {
      s.attachScreen(videoRef.current)
    }
  }, [s.activeScreen?.sid, s.screenViewerOpen, s])

  // Ogni volta che si apre una nuova condivisione, riparte in grande.
  useEffect(() => {
    if (s.activeScreen) setMaximized(true)
  }, [s.activeScreen?.sid])

  if (!s.activeScreen || !s.screenViewerOpen) return null

  const isLocal = s.activeScreen.identity === s.participants.find(p => p.isLocal)?.identity
  const title = isLocal ? 'Stai condividendo il tuo schermo' : `${s.activeScreen.name} sta condividendo`

  return (
    <div
      className={cn(
        'fixed z-40 flex flex-col overflow-hidden border bg-black shadow-2xl',
        maximized
          // Riempie l'area principale: parte dopo la sidebar (w-60 = 15rem) fino ai bordi.
          ? 'left-60 right-0 top-0 bottom-0'
          // PiP: riquadro flottante ridimensionabile in basso a destra.
          : 'bottom-3 right-3 w-[min(40vw,560px)] min-w-[280px] resize rounded-xl',
      )}
    >
      <div className="flex items-center gap-2 bg-card px-3 py-1.5 border-b">
        <Monitor className="h-4 w-4 shrink-0 text-muted-foreground" />
        <p className="min-w-0 flex-1 truncate text-xs font-medium">{title}</p>
        <Button
          size="icon" variant="ghost" className="h-6 w-6"
          onClick={() => setMaximized(m => !m)}
          title={maximized ? 'Riduci a riquadro' : 'Ingrandisci'}
        >
          {maximized ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
        </Button>
        <Button
          size="icon" variant="ghost" className="h-6 w-6"
          onClick={() => s.setScreenViewerOpen(false)}
          title="Chiudi"
        >
          <Minus className="h-4 w-4" />
        </Button>
      </div>
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className={cn(
          'bg-black object-contain',
          maximized ? 'flex-1 min-h-0 w-full' : 'w-full aspect-video',
        )}
      />
    </div>
  )
}
