import { useLayoutEffect, useState } from 'react'
import { useAuthStore } from '@/store/authStore'
import { usersApi } from '@/lib/api'
import { Button } from '@/components/ui/button'

interface Step {
  target?: string   // valore di data-tour da evidenziare; assente = passo centrato
  title: string
  body: string
}

const STEPS: Step[] = [
  {
    title: 'Benvenuto in WorkTogether! 🌸',
    body: 'Facciamo un giro completo delle funzionalità più importanti: ti bastano un paio di minuti per sapere dove sta ogni cosa. Puoi saltare quando vuoi.',
  },
  {
    target: 'workspace',
    title: 'Il tuo workspace',
    body: 'Da qui in alto cambi workspace: ognuno ha i suoi progetti, file, chat e membri. Se sei amministratore puoi anche crearne di nuovi. Tutto ciò che vedi sotto si riferisce al workspace selezionato qui.',
  },
  {
    target: 'mytasks',
    title: 'Le mie task',
    body: 'La tua vista personale trasversale: raccoglie i task assegnati a te in TUTTI i workspace, così sai sempre cosa ti aspetta senza dover entrare progetto per progetto.',
  },
  {
    target: 'kanban',
    title: 'Kanban',
    body: 'Il cuore operativo. Le storie raggruppano i task in colonne Da fare · In corso · Completato: trascina le card per cambiare stato, aprile per assegnatari, scadenze, tag, commenti e allegati.',
  },
  {
    target: 'roadmap',
    title: 'Roadmap',
    body: 'La visione d\'insieme nel tempo: epiche e storie su una timeline tipo Gantt. Utile per pianificare le fasi del progetto e vedere a colpo d\'occhio cosa arriva prima e cosa dopo.',
  },
  {
    target: 'calendar',
    title: 'Calendario',
    body: 'Eventi, riunioni e scadenze del team in vista mensile. Clicca un giorno per creare un evento; le scadenze dei task compaiono qui automaticamente.',
  },
  {
    target: 'files',
    title: 'File',
    body: 'Il drive condiviso del workspace: carica documenti, organizzali in cartelle, trascina per spostarli. Puoi allegarli anche direttamente ai task nel Kanban.',
  },
  {
    target: 'chat',
    title: 'Chat, voce e schermo',
    body: 'Messaggi diretti e di gruppo con il team. Nelle stanze vocali puoi parlare e — dove abilitato — condividere lo schermo con qualità regolabile (risoluzione, fps, modalità giochi). I controlli restano in una barra sempre visibile mentre navighi.',
  },
  {
    target: 'akari',
    title: 'Akari, la tua assistente AI',
    body: 'Chiedi ad Akari in linguaggio naturale: "crea un task per venerdì", "sposta questo file", "scrivi una mail al team". Capisce il contesto del workspace e agisce per te. (Va abilitata dall\'amministratore.)',
  },
  {
    target: 'settings',
    title: 'Impostazioni e profilo',
    body: 'Le impostazioni sono qui, nel menu del tuo profilo in fondo alla sidebar: tema dell\'app, avatar, nome e preferenze personali. Tienilo a mente — è il posto da cui personalizzi WorkTogether.',
  },
  {
    title: 'Tutto qui! Buon lavoro 🚀',
    body: 'Ora conosci le sezioni principali. Esplora con calma: ogni area ha qualche dettaglio in più da scoprire. Puoi sempre tornare a queste sezioni dalla sidebar a sinistra.',
  },
]

type Rect = { top: number; left: number; width: number; height: number }

export function WelcomeTour() {
  const user = useAuthStore(s => s.user)
  const updateUser = useAuthStore(s => s.updateUser)

  const [index, setIndex] = useState(0)
  const [rect, setRect] = useState<Rect | null>(null)
  const [done, setDone] = useState(false)

  // Mostra il tour solo al primo accesso assoluto (non durante il reset password forzato).
  const shouldShow = !!user && user.onboardingCompleted === false && !user.mustResetPassword && !done

  const step = STEPS[index]

  // Calcola la posizione dell'elemento da evidenziare per il passo corrente.
  useLayoutEffect(() => {
    if (!shouldShow) return
    const measure = () => {
      if (!step?.target) { setRect(null); return }
      const el = document.querySelector<HTMLElement>(`[data-tour="${step.target}"]`)
      if (!el) { setRect(null); return }
      const r = el.getBoundingClientRect()
      setRect({ top: r.top, left: r.left, width: r.width, height: r.height })
    }
    measure()
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true)
    return () => {
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure, true)
    }
  }, [index, shouldShow, step])

  if (!shouldShow) return null

  const isFirst = index === 0
  const isLast = index === STEPS.length - 1

  const finish = async () => {
    setDone(true)
    updateUser({ onboardingCompleted: true })
    try { await usersApi.completeOnboarding() } catch { /* best effort: l'utente l'ha comunque visto */ }
  }

  const next = () => { if (isLast) finish(); else setIndex(i => i + 1) }
  const prev = () => setIndex(i => Math.max(0, i - 1))

  // Posizione del riquadro evidenziato (con un piccolo padding attorno all'elemento).
  const pad = 6
  const spotlight = rect
    ? { top: rect.top - pad, left: rect.left - pad, width: rect.width + pad * 2, height: rect.height + pad * 2 }
    : null

  // Posizione della card: accanto all'elemento (a destra della sidebar) o centrata.
  const cardStyle: React.CSSProperties = spotlight
    ? {
        position: 'fixed',
        top: Math.min(Math.max(8, spotlight.top), window.innerHeight - 220),
        left: Math.min(spotlight.left + spotlight.width + 14, window.innerWidth - 340),
      }
    : {
        position: 'fixed',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
      }

  return (
    <div className="fixed inset-0 z-[100]">
      {/* Overlay scuro: con lo spotlight usiamo un box-shadow gigante per "bucare" attorno all'elemento. */}
      {spotlight ? (
        <div
          className="pointer-events-none fixed rounded-lg ring-2 ring-primary transition-all duration-200"
          style={{
            top: spotlight.top,
            left: spotlight.left,
            width: spotlight.width,
            height: spotlight.height,
            boxShadow: '0 0 0 9999px rgba(0,0,0,0.55)',
          }}
        />
      ) : (
        <div className="fixed inset-0 bg-black/55" />
      )}

      {/* Card */}
      <div
        style={cardStyle}
        className="w-[320px] max-w-[90vw] rounded-xl border bg-card p-4 shadow-xl"
      >
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-sm font-semibold">{step.title}</h3>
          <span className="text-xs text-muted-foreground">{index + 1}/{STEPS.length}</span>
        </div>
        <p className="text-sm text-muted-foreground leading-relaxed">{step.body}</p>

        <div className="mt-4 flex items-center justify-between">
          <button
            onClick={finish}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            Salta
          </button>
          <div className="flex gap-2">
            {!isFirst && (
              <Button size="sm" variant="outline" onClick={prev}>Indietro</Button>
            )}
            <Button size="sm" onClick={next}>
              {isLast ? 'Fine' : 'Avanti'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
