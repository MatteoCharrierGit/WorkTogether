import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { driveApi } from '@/lib/api'
import { DriveFile, LockResult } from '@/types'
import { markdownToHtml, fileKind, FileKind } from '@/lib/markdown'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { Skeleton } from '@/components/ui/skeleton'
import { SimpleTooltip } from '@/components/ui/tooltip'
import { toast } from '@/components/ui/toast'
import { EmptyState, useConfirm } from '@/components/shared'
import { cn, formatBytes, getErrorMessage } from '@/lib/utils'
import { detectLang, LANGUAGES, LangId } from '@/components/editor/languages'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'
import { FileIcon } from '@/components/drive/file-icon'
import { Save, Eye, Pencil, Lock, Download, WrapText, X, FileQuestion, PencilLine } from 'lucide-react'

// CodeMirror è pesante: caricato solo quando si apre un file di testo/markdown.
const CodeEditor = lazy(() => import('@/components/editor/CodeEditor'))

interface Props {
  open: boolean
  onClose: () => void
  wsId: string
  file: DriveFile | null
  canEdit: boolean
  resolveName: (id?: string) => string
}

function EditorSkeleton() {
  return (
    <div className="flex h-full" aria-busy="true" aria-label="Caricamento editor">
      <div className="w-12 shrink-0 space-y-2.5 border-r bg-surface-2 px-3 py-4">
        {Array.from({ length: 10 }).map((_, i) => <Skeleton key={i} className="h-3 w-5" />)}
      </div>
      <div className="flex-1 space-y-2.5 p-4">
        {[70, 45, 85, 60, 30, 75, 50, 90, 40, 65].map((w, i) => (
          <Skeleton key={i} className="h-3" style={{ width: `${w}%` }} />
        ))}
      </div>
    </div>
  )
}

export function FileViewerDialog({ open, onClose, wsId, file, canEdit, resolveName }: Props) {
  const confirm = useConfirm()
  const [kind, setKind] = useState<FileKind>('other')
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [blobUrl, setBlobUrl] = useState<string | null>(null)
  const [content, setContent] = useState('')
  const [edited, setEdited] = useState('')
  const [mode, setMode] = useState<'view' | 'edit'>('view')
  const [iHoldLock, setIHoldLock] = useState(false)
  const [lockedByName, setLockedByName] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [lang, setLang] = useState<LangId>('plaintext')
  const [wrap, setWrap] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

  // ref per accedere allo stato del lock nella pulizia
  const holdRef = useRef(false)
  const urlRef = useRef<string | null>(null)
  useEffect(() => { holdRef.current = iHoldLock }, [iHoldLock])
  useEffect(() => { urlRef.current = blobUrl }, [blobUrl])
  // File attualmente aperto nel dialog (null se chiuso/smontato): decide se un lock arrivato
  // dopo l'annullamento del caricamento va rilasciato.
  const activeFileRef = useRef<string | null>(null)

  useEffect(() => {
    let cancelled = false
    activeFileRef.current = open && file ? file.id : null
    if (!open || !file) return

    const load = async () => {
      setLoading(true)
      setLoadError(null)
      setBlobUrl(null); setContent(''); setEdited('')
      setIHoldLock(false); setLockedByName(null); setMode('view')
      const k = fileKind(file.filename, file.contentType)
      setKind(k)
      setLang(detectLang(file.filename))
      setWrap(k === 'markdown')
      try {
        if (k === 'image' || k === 'pdf') {
          const blob = await driveApi.fetchBlob(wsId, file.id)
          if (cancelled) return
          setBlobUrl(URL.createObjectURL(blob))
        } else if (k === 'text' || k === 'markdown') {
          const text = await driveApi.fetchText(wsId, file.id)
          if (cancelled) return
          setContent(text); setEdited(text)
          if (canEdit) {
            const lock: LockResult = await driveApi.lock(wsId, file.id)
            if (cancelled) {
              // Dialog chiuso (o file cambiato) mentre il lock era in acquisizione: lo si rilascia,
              // a meno che lo stesso file sia stato riaperto (il nuovo caricamento lo riusa).
              if (lock.acquired && activeFileRef.current !== file.id) {
                driveApi.unlock(wsId, file.id).catch(() => { /* ignore */ })
              }
              return
            }
            if (lock.acquired) {
              setIHoldLock(true)
              if (k === 'text') setMode('edit')
            } else {
              setLockedByName(resolveName(lock.lockedBy))
            }
          }
        }
      } catch (err) {
        if (!cancelled) setLoadError(getErrorMessage(err, 'Impossibile aprire il file'))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, file?.id, reloadKey])

  const cleanup = async () => {
    if (urlRef.current) { URL.revokeObjectURL(urlRef.current); urlRef.current = null }
    if (holdRef.current && file) {
      holdRef.current = false
      try { await driveApi.unlock(wsId, file.id) } catch { /* ignore */ }
    }
  }

  // Rilascia lock/URL allo smontaggio (fire-and-forget).
  useEffect(() => () => { activeFileRef.current = null; cleanup() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const editable = iHoldLock && !lockedByName
  const dirty = edited !== content

  // Aspetta il rilascio del lock prima di chiudere, così la lista si aggiorna pulita.
  const handleClose = async () => {
    if (editable && dirty) {
      const ok = await confirm({
        title: 'Chiudere senza salvare?',
        description: 'Le modifiche non salvate a questo file andranno perse.',
        confirmLabel: 'Chiudi senza salvare',
        destructive: true,
      })
      if (!ok) return
    }
    await cleanup()
    onClose()
  }

  const handleSave = async () => {
    if (!file || !editable || !dirty || saving) return
    setSaving(true)
    try {
      await driveApi.saveContent(wsId, file.id, edited)
      setContent(edited)
      toast('File salvato', 'success')
    } catch (err) {
      toast(getErrorMessage(err, 'Errore nel salvataggio'), 'destructive')
    } finally {
      setSaving(false)
    }
  }

  const handleDownload = async () => {
    if (!file) return
    try { await driveApi.download(wsId, file.id, file.filename) } catch { toast('Errore nel download', 'destructive') }
  }

  // Strumenti editor visibili quando si mostra il CodeEditor (testo, o markdown in modifica).
  const showEditorTools = !loading && !loadError && (kind === 'text' || (kind === 'markdown' && mode === 'edit'))
  const canSave = editable && (kind === 'text' || (kind === 'markdown' && mode === 'edit'))

  const status = loading ? null
    : lockedByName ? { icon: Lock, text: `In modifica da ${lockedByName}`, cls: 'text-warning' }
    : editable ? { icon: PencilLine, text: dirty ? 'Modifiche non salvate' : 'In modifica da te', cls: dirty ? 'text-warning' : 'text-success' }
    : (kind === 'text' || kind === 'markdown') ? { icon: Eye, text: 'Sola lettura', cls: 'text-muted-foreground' }
    : null

  return (
    <Dialog open={open} onOpenChange={v => !v && handleClose()}>
      <DialogContent
        hideClose
        onKeyDown={e => {
          if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') { e.preventDefault(); handleSave() }
        }}
        className={cn(
          'flex flex-col gap-0 overflow-hidden p-0 sm:p-0',
          // Mobile: a schermo intero. Da sm: dialog grande centrato.
          'inset-0 left-0 top-0 h-[100dvh] max-h-none w-full max-w-none translate-x-0 translate-y-0 rounded-none border-0',
          'sm:inset-auto sm:left-1/2 sm:top-1/2 sm:h-[92dvh] sm:w-[96vw] sm:max-w-7xl sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-xl sm:border'
        )}
      >
        {/* Header */}
        <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b px-3 py-2 sm:px-4">
          <div className="order-1 flex min-w-0 flex-1 items-center gap-2.5">
            {file && (
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border bg-surface-2">
                <FileIcon filename={file.filename} contentType={file.contentType} />
              </span>
            )}
            <div className="min-w-0">
              <DialogTitle className="truncate text-sm font-semibold">{file?.filename}</DialogTitle>
              <DialogDescription className="flex items-center gap-1.5 text-caption text-muted-foreground">
                {file && <span>{formatBytes(file.sizeBytes)}</span>}
                {status && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className={cn('inline-flex min-w-0 items-center gap-1', status.cls)}>
                      <status.icon className="h-3 w-3 shrink-0" aria-hidden="true" />
                      <span className="truncate">{status.text}</span>
                    </span>
                  </>
                )}
              </DialogDescription>
            </div>
          </div>

          <div className="order-2 flex shrink-0 items-center gap-1 sm:order-3 sm:gap-1.5">
            {canSave && (
              <SimpleTooltip content="Salva il file" shortcut="Ctrl+S">
                <Button size="sm" onClick={handleSave} disabled={!dirty} loading={saving}>
                  {!saving && <Save className="h-4 w-4" />} Salva
                </Button>
              </SimpleTooltip>
            )}
            <IconButton label="Scarica" icon={<Download />} onClick={handleDownload} disabled={!file} />
            <IconButton label="Chiudi" icon={<X />} onClick={handleClose} />
          </div>

          {/* Seconda riga su mobile, inline da sm: strumenti di vista/editor */}
          {(kind === 'markdown' || showEditorTools) && !loading && !loadError && (
            <div className="order-3 flex w-full items-center gap-1.5 sm:order-2 sm:w-auto">
              {kind === 'markdown' && (
                <div className="flex rounded-md border p-0.5" role="group" aria-label="Modalità">
                  <Button
                    size="xs"
                    variant={mode === 'view' ? 'secondary' : 'ghost'}
                    aria-pressed={mode === 'view'}
                    onClick={() => setMode('view')}
                  >
                    <Eye className="h-3.5 w-3.5" /> Anteprima
                  </Button>
                  <Button
                    size="xs"
                    variant={mode === 'edit' ? 'secondary' : 'ghost'}
                    aria-pressed={mode === 'edit'}
                    onClick={() => setMode('edit')}
                  >
                    <Pencil className="h-3.5 w-3.5" /> {editable ? 'Modifica' : 'Sorgente'}
                  </Button>
                </div>
              )}
              {showEditorTools && (
                <>
                  <Select value={lang} onValueChange={v => setLang(v as LangId)}>
                    <SelectTrigger aria-label="Linguaggio" className="h-8 w-36 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="max-h-72">
                      {LANGUAGES.map(l => (
                        <SelectItem key={l.id} value={l.id} className="text-xs">{l.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <IconButton
                    label={wrap ? 'Disattiva a capo automatico' : 'A capo automatico'}
                    icon={<WrapText />}
                    aria-pressed={wrap}
                    variant={wrap ? 'secondary' : 'ghost'}
                    onClick={() => setWrap(w => !w)}
                  />
                </>
              )}
            </div>
          )}
        </div>

        {/* Banner lock */}
        {lockedByName && (
          <div className="flex shrink-0 items-center gap-2 border-b bg-warning-subtle px-4 py-2 text-caption text-warning">
            <Lock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>
              <strong className="font-semibold">{lockedByName}</strong> sta modificando questo file: puoi aprirlo in sola lettura finché non lo rilascia.
            </span>
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-auto bg-background">
          {loading ? (
            kind === 'image' || kind === 'pdf' ? (
              <div className="flex h-full items-center justify-center p-6"><Skeleton className="h-full w-full max-w-3xl" /></div>
            ) : (
              <EditorSkeleton />
            )
          ) : loadError ? (
            <EmptyState
              icon={FileQuestion}
              title="Impossibile aprire il file"
              description={loadError}
              action={
                <>
                  <Button size="sm" variant="outline" onClick={() => setReloadKey(k => k + 1)}>Riprova</Button>
                  <Button size="sm" variant="ghost" onClick={handleDownload}><Download className="h-4 w-4" /> Scarica</Button>
                </>
              }
            />
          ) : kind === 'image' && blobUrl ? (
            <div className="flex h-full items-center justify-center bg-surface-2 p-4">
              <img src={blobUrl} alt={file?.filename} className="max-h-full max-w-full rounded-md object-contain shadow-sm" />
            </div>
          ) : kind === 'pdf' && blobUrl ? (
            <iframe src={blobUrl} title={file?.filename} className="h-full w-full" />
          ) : kind === 'markdown' && mode === 'view' ? (
            <div
              className="prose prose-sm mx-auto max-w-3xl px-4 py-6 dark:prose-invert sm:px-8 sm:py-10"
              dangerouslySetInnerHTML={{ __html: markdownToHtml(editable ? edited : content) }}
            />
          ) : kind === 'text' || kind === 'markdown' ? (
            <Suspense fallback={<EditorSkeleton />}>
              <CodeEditor
                value={editable ? edited : content}
                onChange={editable ? setEdited : undefined}
                language={lang}
                wrap={wrap}
                readOnly={!editable}
              />
            </Suspense>
          ) : (
            <EmptyState
              icon={FileQuestion}
              title="Anteprima non disponibile"
              description="Questo tipo di file non può essere visualizzato nel browser."
              action={
                <Button size="sm" onClick={handleDownload}>
                  <Download className="h-4 w-4" /> Scarica
                </Button>
              }
              className="h-full"
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
