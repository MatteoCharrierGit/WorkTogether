import { useCallback, useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { elementsApi } from '@/lib/api'
import type { Element } from '@/types'
import { toast } from '@/components/ui/toast'
import { getErrorMessage } from '@/lib/utils'
import { sameBody } from '@/components/editor/BlockEditor'

export type SaveStatus = 'idle' | 'pending' | 'saving' | 'saved' | 'error'

/** Campi accettati dal PUT /elements/{id}: i campi null/assenti NON vengono modificati dal backend. */
export interface ElementPatch {
  status?: Element['status']
  blocked?: boolean
  startDate?: string
  endDate?: string
  allDay?: boolean
  tagIds?: string[]
  assigneeIds?: string[]
}

const DEBOUNCE_MS = 800

/**
 * Autosave del dettaglio elemento.
 *
 * - Titolo e corpo sono bozze locali: salvate 800ms dopo l'ultima modifica, al blur, quando la
 *   scheda va in background e allo smontaggio.
 * - Le proprietà (stato, tag, …) si salvano subito con aggiornamento ottimistico della cache.
 * - Il PUT è parziale: si inviano solo title/type (obbligatori) e i campi cambiati, così non si
 *   sovrascrivono modifiche concorrenti ad altri campi (il backend ignora i campi null).
 * - Gli aggiornamenti remoti (WS → refetch) non toccano un campo con modifiche locali non salvate
 *   o con il focus: vengono applicati al blur.
 * - Niente salvataggi prima che l'elemento sia caricato; un PUT alla volta (coda).
 */
export function useElementAutosave(wsId: string | undefined, element: Element | undefined, readOnly: boolean) {
  const queryClient = useQueryClient()
  const key = ['element', wsId, element?.id]

  const [title, setTitleState] = useState(element?.title ?? '')
  const [body, setBodyState] = useState<string | undefined>(element?.body)
  const [status, setStatus] = useState<SaveStatus>('idle')
  const [error, setError] = useState<string | null>(null)

  const serverRef = useRef(element)
  serverRef.current = element
  const draftRef = useRef({ title: element?.title ?? '', body: element?.body as string | undefined })
  const dirtyRef = useRef(new Set<'title' | 'body'>())
  const focusRef = useRef({ title: false, body: false })
  const patchRef = useRef<ElementPatch | null>(null)
  const inFlightRef = useRef<Promise<void> | null>(null)
  const againRef = useRef(false)
  const timerRef = useRef<ReturnType<typeof setTimeout>>()
  const initRef = useRef(!!element)
  const mountedRef = useRef(true)

  const safeSetStatus = (s: SaveStatus) => { if (mountedRef.current) setStatus(s) }

  // Allinea le bozze ai dati del server per i campi non modificati e non in focus.
  const syncFromServer = useCallback(() => {
    const el = serverRef.current
    if (!el) return
    if (!initRef.current) {
      initRef.current = true
      draftRef.current = { title: el.title, body: el.body }
      setTitleState(el.title)
      setBodyState(el.body)
      return
    }
    const d = draftRef.current
    if (!dirtyRef.current.has('title') && !focusRef.current.title && el.title !== d.title) {
      d.title = el.title
      setTitleState(el.title)
    }
    if (!dirtyRef.current.has('body') && !focusRef.current.body && !sameBody(el.body, d.body)) {
      d.body = el.body
      setBodyState(el.body)
    }
  }, [])

  useEffect(() => { syncFromServer() }, [element, syncFromServer])

  const flush = useCallback((): Promise<void> => {
    clearTimeout(timerRef.current)
    const el = serverRef.current
    if (!el || !wsId || readOnly) return Promise.resolve()
    if (inFlightRef.current) {
      againRef.current = true
      return inFlightRef.current
    }

    const d = draftRef.current
    const payload: Record<string, unknown> = { title: el.title, type: el.type }
    const sent: { title?: string; body?: string } = {}

    if (dirtyRef.current.has('title')) {
      const t = d.title.trim()
      if (t && t !== el.title) { payload.title = t; sent.title = t }
      else if (t === el.title) dirtyRef.current.delete('title')
      // titolo vuoto: non si salva (resta "non salvato" finché non viene corretto o al blur)
    }
    if (dirtyRef.current.has('body')) {
      if (!sameBody(d.body, el.body)) { payload.body = d.body ?? ''; sent.body = d.body }
      else dirtyRef.current.delete('body')
    }
    const patch = patchRef.current
    patchRef.current = null
    if (patch) Object.assign(payload, patch)

    if (sent.title === undefined && sent.body === undefined && !patch) {
      if (mountedRef.current) setStatus(s => (dirtyRef.current.size ? 'pending' : s === 'idle' ? 'idle' : 'saved'))
      return Promise.resolve()
    }

    safeSetStatus('saving')
    const p = (async () => {
      let failed = false
      try {
        const res: Element = await elementsApi.update(wsId, el.id, payload)
        if (sent.title !== undefined && draftRef.current.title.trim() === sent.title) dirtyRef.current.delete('title')
        if (sent.body !== undefined && draftRef.current.body === sent.body) dirtyRef.current.delete('body')
        // Evita che un refetch partito prima del salvataggio riporti dati vecchi.
        await queryClient.cancelQueries({ queryKey: ['element', wsId, el.id] })
        queryClient.setQueryData<Element>(['element', wsId, el.id], old =>
          old ? { ...old, ...res, body: res.body ?? (sent.body !== undefined ? sent.body : old.body) } : res)
        if (sent.title !== undefined || patch) {
          queryClient.invalidateQueries({ queryKey: ['elements', wsId] })
          queryClient.invalidateQueries({ queryKey: ['my-tasks'] })
        }
        if (mountedRef.current) setError(null)
        safeSetStatus(dirtyRef.current.size ? 'pending' : 'saved')
      } catch (err) {
        failed = true
        // Le proprietà non salvate tornano in coda: "Riprova" le reinvia.
        if (patch) patchRef.current = { ...patch, ...patchRef.current }
        const msg = getErrorMessage(err, 'Salvataggio non riuscito')
        if (mountedRef.current) setError(msg)
        safeSetStatus('error')
        toast(`Salvataggio non riuscito: ${msg}`, 'destructive')
      } finally {
        inFlightRef.current = null
        if (!failed) {
          if (patchRef.current || againRef.current) {
            againRef.current = false
            void flush()
          } else if (dirtyRef.current.size && mountedRef.current) {
            timerRef.current = setTimeout(() => void flush(), DEBOUNCE_MS)
          }
        } else {
          againRef.current = false
        }
      }
    })()
    inFlightRef.current = p
    return p
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wsId, readOnly, queryClient])

  const schedule = useCallback(() => {
    clearTimeout(timerRef.current)
    setStatus(s => (s === 'saving' ? s : 'pending'))
    timerRef.current = setTimeout(() => void flush(), DEBOUNCE_MS)
  }, [flush])

  const setTitle = useCallback((v: string) => {
    if (!serverRef.current || readOnly) return
    draftRef.current.title = v
    setTitleState(v)
    dirtyRef.current.add('title')
    schedule()
  }, [schedule, readOnly])

  const setBody = useCallback((v: string) => {
    if (!serverRef.current || readOnly) return
    // Aggiornamenti dell'editor che non cambiano nulla (es. normalizzazione all'avvio): ignorati.
    if (!dirtyRef.current.has('body') && sameBody(v, serverRef.current.body)) return
    draftRef.current.body = v
    setBodyState(v)
    dirtyRef.current.add('body')
    schedule()
  }, [schedule, readOnly])

  /** Salva subito delle proprietà, con aggiornamento ottimistico della cache. */
  const patch = useCallback((fields: ElementPatch, optimistic?: Partial<Element>) => {
    if (!serverRef.current || readOnly) return
    if (optimistic) {
      queryClient.setQueryData<Element>(key, old => (old ? { ...old, ...optimistic } : old))
      serverRef.current = { ...serverRef.current, ...optimistic }
    }
    patchRef.current = { ...patchRef.current, ...fields }
    void flush()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flush, readOnly, queryClient, wsId, element?.id])

  const focusHandlers = {
    onTitleFocus: () => { focusRef.current.title = true },
    onTitleBlur: () => {
      focusRef.current.title = false
      const el = serverRef.current
      if (el && !draftRef.current.title.trim()) {
        // Titolo vuoto non ammesso: si ripristina quello salvato.
        dirtyRef.current.delete('title')
        draftRef.current.title = el.title
        setTitleState(el.title)
      }
      void flush().then(syncFromServer)
    },
    onBodyFocus: () => { focusRef.current.body = true },
    onBodyBlur: () => {
      focusRef.current.body = false
      void flush().then(syncFromServer)
    },
  }

  // Salva quando la scheda va in background; avvisa prima di chiudere con modifiche pendenti.
  useEffect(() => {
    const onVisibility = () => { if (document.visibilityState === 'hidden') void flush() }
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (dirtyRef.current.size || patchRef.current || inFlightRef.current) {
        void flush()
        e.preventDefault()
        e.returnValue = ''
      }
    }
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('beforeunload', onBeforeUnload)
    }
  }, [flush])

  // Smontaggio (cambio pagina/elemento): salva subito ciò che resta.
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      clearTimeout(timerRef.current)
      if (dirtyRef.current.size || patchRef.current) void flush()
    }
  }, [flush])

  const retry = useCallback(() => { void flush() }, [flush])

  return { title, body, setTitle, setBody, patch, status, error, retry, flush, ...focusHandlers }
}
