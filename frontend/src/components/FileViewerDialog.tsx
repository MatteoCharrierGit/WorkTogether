import { useEffect, useRef, useState } from 'react'
import { driveApi } from '@/lib/api'
import { DriveFile, LockResult } from '@/types'
import { markdownToHtml, fileKind, FileKind } from '@/lib/markdown'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { toast } from '@/components/ui/toast'
import { cn } from '@/lib/utils'
import { Save, Eye, Pencil, Lock, Download } from 'lucide-react'

interface Props {
  open: boolean
  onClose: () => void
  wsId: string
  file: DriveFile | null
  canEdit: boolean
  resolveName: (id?: string) => string
}

export function FileViewerDialog({ open, onClose, wsId, file, canEdit, resolveName }: Props) {
  const [kind, setKind] = useState<FileKind>('other')
  const [loading, setLoading] = useState(true)
  const [blobUrl, setBlobUrl] = useState<string | null>(null)
  const [content, setContent] = useState('')
  const [edited, setEdited] = useState('')
  const [mode, setMode] = useState<'view' | 'edit'>('view')
  const [iHoldLock, setIHoldLock] = useState(false)
  const [lockedByName, setLockedByName] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // ref per accedere allo stato del lock nella pulizia
  const holdRef = useRef(false)
  const urlRef = useRef<string | null>(null)
  useEffect(() => { holdRef.current = iHoldLock }, [iHoldLock])
  useEffect(() => { urlRef.current = blobUrl }, [blobUrl])

  useEffect(() => {
    let cancelled = false
    if (!open || !file) return

    const load = async () => {
      setLoading(true)
      setBlobUrl(null); setContent(''); setEdited('')
      setIHoldLock(false); setLockedByName(null); setMode('view')
      const k = fileKind(file.filename, file.contentType)
      setKind(k)
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
            if (cancelled) return
            if (lock.acquired) {
              setIHoldLock(true)
              if (k === 'text') setMode('edit')
            } else {
              setLockedByName(resolveName(lock.lockedBy))
            }
          }
        }
      } catch {
        toast('Errore nell\'apertura del file', 'destructive')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, file?.id])

  const cleanup = async () => {
    if (urlRef.current) { URL.revokeObjectURL(urlRef.current); urlRef.current = null }
    if (holdRef.current && file) {
      holdRef.current = false
      try { await driveApi.unlock(wsId, file.id) } catch { /* ignore */ }
    }
  }

  // Rilascia lock/URL allo smontaggio (fire-and-forget).
  useEffect(() => () => { cleanup() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Aspetta il rilascio del lock prima di chiudere, così la lista si aggiorna pulita.
  const handleClose = async () => { await cleanup(); onClose() }

  const handleSave = async () => {
    if (!file) return
    setSaving(true)
    try {
      await driveApi.saveContent(wsId, file.id, edited)
      setContent(edited)
      toast('File salvato')
    } catch (err: any) {
      toast(err.response?.data?.error ?? 'Errore nel salvataggio', 'destructive')
    } finally {
      setSaving(false)
    }
  }

  const editable = iHoldLock && !lockedByName
  const dirty = edited !== content

  return (
    <Dialog open={open} onOpenChange={v => !v && handleClose()}>
      <DialogContent className="max-w-3xl w-full h-[80vh] flex flex-col p-0 gap-0">
        <DialogHeader className="pl-5 pr-12 py-3 border-b flex-row items-center justify-between space-y-0">
          <DialogTitle className="text-sm truncate pr-4">{file?.filename}</DialogTitle>
          <div className="flex items-center gap-2">
            {kind === 'markdown' && (
              <div className="flex rounded-md border overflow-hidden">
                <button
                  onClick={() => setMode('view')}
                  className={cn('px-2 py-1 text-xs flex items-center gap-1', mode === 'view' ? 'bg-accent' : 'hover:bg-accent/50')}
                >
                  <Eye className="h-3.5 w-3.5" /> Anteprima
                </button>
                <button
                  onClick={() => setMode('edit')}
                  disabled={!editable}
                  className={cn('px-2 py-1 text-xs flex items-center gap-1 disabled:opacity-40', mode === 'edit' ? 'bg-accent' : 'hover:bg-accent/50')}
                >
                  <Pencil className="h-3.5 w-3.5" /> Modifica
                </button>
              </div>
            )}
            {editable && (kind === 'text' || (kind === 'markdown' && mode === 'edit')) && (
              <Button size="sm" onClick={handleSave} disabled={saving || !dirty}>
                <Save className="h-3.5 w-3.5 mr-1.5" /> {saving ? 'Salvataggio...' : 'Salva'}
              </Button>
            )}
          </div>
        </DialogHeader>

        {/* Banner lock */}
        {lockedByName && (
          <div className="px-5 py-2 bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-200 text-xs flex items-center gap-2 border-b">
            <Lock className="h-3.5 w-3.5 shrink-0" />
            In modifica da <strong>{lockedByName}</strong> — apribile in sola lettura finché non viene rilasciato.
          </div>
        )}

        <div className="flex-1 overflow-auto">
          {loading ? (
            <div className="flex items-center justify-center h-full text-sm text-muted-foreground">Caricamento...</div>
          ) : kind === 'image' && blobUrl ? (
            <div className="flex items-center justify-center h-full p-4 bg-muted/20">
              <img src={blobUrl} alt={file?.filename} className="max-h-full max-w-full object-contain" />
            </div>
          ) : kind === 'pdf' && blobUrl ? (
            <iframe src={blobUrl} title={file?.filename} className="w-full h-full" />
          ) : kind === 'markdown' && mode === 'view' ? (
            <div
              className="prose prose-sm dark:prose-invert max-w-none p-6"
              dangerouslySetInnerHTML={{ __html: markdownToHtml(content) }}
            />
          ) : kind === 'text' || kind === 'markdown' ? (
            <textarea
              value={editable ? edited : content}
              onChange={e => editable && setEdited(e.target.value)}
              readOnly={!editable}
              spellCheck={false}
              className="w-full h-full resize-none border-0 bg-background p-4 font-mono text-sm leading-relaxed focus:outline-none"
            />
          ) : (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-center text-sm text-muted-foreground p-6">
              <p>Anteprima non disponibile per questo tipo di file.</p>
              {file && (
                <Button size="sm" variant="outline" onClick={() => driveApi.download(wsId, file.id, file.filename)}>
                  <Download className="h-3.5 w-3.5 mr-1.5" /> Scarica
                </Button>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
