import { useAuthStore } from '@/store/authStore'

/** Dettagli di un errore dello stream dell'agente (es. 429 con Retry-After). */
export interface AiStreamErrorInfo {
  status?: number
  /** Secondi dopo cui riprovare (limiti d'uso). */
  retryAfter?: number
  /** AI_RATE_MINUTE | AI_RATE_DAY | AI_CONCURRENT | AI_BUSY */
  code?: string
}

export interface AiStreamCallbacks {
  onToken: (t: string) => void
  /** Il testo ricevuto finora va scartato (es. rifiuto del modello a metà risposta). */
  onReset?: () => void
  onTool?: (name: string) => void
  onConfirm?: (actions: any[]) => void
  onDone?: () => void
  onError?: (message: string, info: AiStreamErrorInfo) => void
}

/**
 * Legge una risposta SSE dell'agente via fetch (per inviare il Bearer token), esponendo anche
 * status HTTP, codice e Retry-After degli errori di limite d'uso (429/503).
 */
export async function aiStream(path: string, body: object, cb: AiStreamCallbacks) {
  const token = useAuthStore.getState().accessToken
  const base = (import.meta as any).env?.VITE_API_URL || '/api'
  let res: Response
  try {
    res = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    })
  } catch {
    cb.onError?.('Errore di rete', {})
    return
  }
  if (!res.ok || !res.body) {
    let msg = 'Errore nella richiesta'
    const info: AiStreamErrorInfo = { status: res.status }
    const header = Number(res.headers.get('Retry-After'))
    if (Number.isFinite(header) && header > 0) info.retryAfter = header
    try {
      const j = await res.json()
      msg = j.error || msg
      if (typeof j.retryAfter === 'number') info.retryAfter = j.retryAfter
      if (j.code) info.code = j.code
    } catch { /* corpo non-JSON */ }
    cb.onError?.(msg, info)
    return
  }
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  let finished = false
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    const events = buf.split('\n\n')
    buf = events.pop() ?? ''
    for (const evt of events) {
      const dataLine = evt.split('\n').find(l => l.startsWith('data:'))
      if (!dataLine) continue
      const payload = dataLine.slice(5).trim()
      if (!payload) continue
      try {
        const ev = JSON.parse(payload)
        if (ev.type === 'token') cb.onToken(ev.text)
        else if (ev.type === 'reset') cb.onReset?.()
        else if (ev.type === 'tool') cb.onTool?.(ev.name)
        else if (ev.type === 'confirm') { finished = true; cb.onConfirm?.(ev.actions || []) }
        else if (ev.type === 'done') { finished = true; cb.onDone?.() }
        else if (ev.type === 'error') { finished = true; cb.onError?.(ev.message || 'Errore', { status: ev.status }) }
      } catch { /* frammento non-JSON */ }
    }
  }
  // Stream chiuso senza evento finale (timeout/disconnessione): sblocca comunque la UI.
  if (!finished) cb.onDone?.()
}
