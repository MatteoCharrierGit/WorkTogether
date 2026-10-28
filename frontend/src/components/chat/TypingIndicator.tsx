import * as React from 'react'
import { useWorkspaceEvents } from '@/lib/websocket'

const TTL_MS = 4000

/**
 * "X sta scrivendo…": stato isolato in questo componente (con la sua subscription),
 * così gli eventi TYPING non ri-renderizzano la pagina né la lista messaggi.
 */
export const TypingIndicator = React.memo(function TypingIndicator({ wsId, channelId, meId }: {
  wsId: string; channelId: string; meId?: string
}) {
  const [typing, setTyping] = React.useState<Record<string, { name: string; exp: number }>>({})

  React.useEffect(() => { setTyping({}) }, [channelId])

  useWorkspaceEvents(wsId, ev => {
    const p = ev.payload || {}
    if (p.channelId !== channelId) return
    if (ev.type === 'TYPING' && p.userId && p.userId !== meId && p.userName) {
      setTyping(prev => ({ ...prev, [p.userId]: { name: p.userName, exp: Date.now() + TTL_MS } }))
    } else if (ev.type === 'MESSAGE_CREATED' && p.authorId) {
      // Il messaggio è arrivato: chi l'ha scritto non sta più scrivendo.
      setTyping(prev => {
        if (!prev[p.authorId]) return prev
        const next = { ...prev }
        delete next[p.authorId]
        return next
      })
    }
  })

  const hasAny = Object.keys(typing).length > 0
  React.useEffect(() => {
    if (!hasAny) return
    const t = setInterval(() => {
      setTyping(prev => {
        const now = Date.now()
        let changed = false
        const next: typeof prev = {}
        for (const [k, v] of Object.entries(prev)) {
          if (v.exp > now) next[k] = v
          else changed = true
        }
        return changed ? next : prev
      })
    }, 1000)
    return () => clearInterval(t)
  }, [hasAny])

  const names = Object.values(typing).map(t => t.name)
  const label = names.length === 0 ? null
    : names.length === 1 ? <><span className="font-semibold">{names[0]}</span> sta scrivendo</>
    : names.length === 2 ? <><span className="font-semibold">{names[0]}</span> e <span className="font-semibold">{names[1]}</span> stanno scrivendo</>
    : <>{names.length} persone stanno scrivendo</>

  return (
    <div className="flex h-5 items-center gap-1.5 px-1 text-2xs text-muted-foreground" aria-live="polite">
      {label && (
        <>
          <span className="inline-flex gap-0.5" aria-hidden>
            <span className="h-1 w-1 animate-bounce rounded-full bg-current" />
            <span className="h-1 w-1 animate-bounce rounded-full bg-current [animation-delay:150ms]" />
            <span className="h-1 w-1 animate-bounce rounded-full bg-current [animation-delay:300ms]" />
          </span>
          <span className="truncate">{label}…</span>
        </>
      )}
    </div>
  )
})
