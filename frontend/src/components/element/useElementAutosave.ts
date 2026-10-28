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
 * - Il PUT è parziale: si inviano solo i campi cambiati localmente (il titolo solo se modificato),
 *   così non si sovrascrivono modifiche concorrenti di altri utenti (il backend ignora i campi null).
 * - Aggiornamenti ottimistici versionati per campo: la risposta di un PUT non sovrascrive un valore
 *   ottimistico più recente; se il PUT fallisce il valore torna a quello precedente.
 * - `discard()` annulla bozze e proprietà pendenti (es. dopo l'eliminazione dell'elemento).
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
  const discardedRef = useRef(false)
  // Versioni per campo ottimistico: ultima versione applicata, ultima confermata dal server,
  // valore precedente alla prima modifica non confermata (per il rollback).
  const seqRef = useRef(0)
  const optVersionRef = useRef(new Map<keyof Element, number>())
  const optAckedRef = useRef(new Map<keyof Element, number>())
  const optBaseRef = useRef(new Map<keyof Element, unknown>())
  const pendingOptRef = useRef(new Map<keyof Element, number>())

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
    if (!el || !wsId || readOnly || discardedRef.current) return Promise.resolve()
    if (inFlightRef.current) {
      againRef.current = true
      return inFlightRef.current
    }

    const d = draftRef.current
    // type serve solo al controllo permessi (non viene modificato); il titolo va solo se cambiato.
    const payload: Record<string, unknown> = { type: el.type }
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
    const sentOpt = pendingOptRef.current
    pendingOptRef.current = new Map()

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
        sentOpt.forEach((v, k) => {
          optAckedRef.current.set(k, Math.max(v, optAckedRef.current.get(k) ?? 0))
          if (optVersionRef.current.get(k) === v) optBaseRef.current.delete(k)
        })
        queryClient.setQueryData<Element>(['element', wsId, el.id], old => {
          if (!old) return res
          const next: Element = { ...old, ...res, body: res.body ?? (sent.body !== undefined ? sent.body : old.body) }
          // I campi con un valore ottimistico più recente (patch successiva non ancora confermata) restano.
          optVersionRef.current.forEach((v, k) => {
            if (v > (optAckedRef.current.get(k) ?? 0)) (next as any)[k] = (old as any)[k]
          })
          return next
        })
        if (sent.title !== undefined || patch) {
          queryClient.invalidateQueries({ queryKey: ['elements', wsId] })
          queryClient.invalidateQueries({ queryKey: ['my-tasks'] })
        }
        if (mountedRef.current) setError(null)
        safeSetStatus(dirtyRef.current.size ? 'pending' : 'saved')
      } catch (err) {
        failed = true
        if (discardedRef.current) return
        // Proprietà non salvate: si ripristina il valore precedente (salvo modifiche più recenti).
        if (sentOpt.size) {
          const rollback: Partial<Element> = {}
          sentOpt.forEach((v, k) => {
            if (optVersionRef.current.get(k) === v && optBaseRef.current.has(k)) {
              ;(rollback as Record<string, unknown>)[k] = optBaseRef.current.get(k)
              optBaseRef.current.delete(k)
              optAckedRef.current.set(k, v)
            }
          })
          if (Object.keys(rollback).length) {
            queryClient.setQueryData<Element>(['element', wsId, el.id], old => (old ? { ...old, ...rollback } : old))
            serverRef.current = serverRef.current && { ...serverRef.current, ...rollback }
          }
        }
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
      const cur = (queryClient.getQueryData<Element>(key) ?? serverRef.current) as Element
      for (const k of Object.keys(optimistic) as (keyof Element)[]) {
        if (!optBaseRef.current.has(k)) optBaseRef.current.set(k, cur[k])
        const v = ++seqRef.current
        optVersionRef.current.set(k, v)
        pendingOptRef.current.set(k, v)
      }
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

  /** Scarta bozze e proprietà pendenti e blocca i salvataggi successivi (elemento eliminato). */
  const discard = useCallback(() => {
    discardedRef.current = true
    clearTimeout(timerRef.current)
    dirtyRef.current.clear()
    patchRef.current = null
    pendingOptRef.current = new Map()
    againRef.current = false
  }, [])

  return { title, body, setTitle, setBody, patch, status, error, retry, flush, discard, ...focusHandlers }
}
