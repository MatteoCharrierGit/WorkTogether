import { useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { driveApi, workspacesApi } from '@/lib/api'
import { Folder as FolderType, DriveFile, Member } from '@/types'
import { useWorkspaceStore } from '@/store/workspaceStore'
import { useAuthStore } from '@/store/authStore'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'
import { toast } from '@/components/ui/toast'
import { formatBytes, formatDate, cn } from '@/lib/utils'
import { fileKind } from '@/lib/markdown'
import { UserAvatar } from '@/components/UserAvatar'
import { FileViewerDialog } from '@/components/FileViewerDialog'
import {
  Folder as FolderIcon, FolderPlus, FolderUp, Upload, Download, Trash2,
  ChevronRight, File as FileIcon, Home, Lock, LockOpen, GripVertical,
  MoreVertical, Pencil, Copy,
} from 'lucide-react'

interface Crumb { id?: string; name: string }

// Elemento trascinato internamente (file o cartella).
interface DragItem { kind: 'file' | 'folder'; id: string; name: string }
const DND_MIME = 'application/x-wt-item'

const isExternalDrag = (e: React.DragEvent) => Array.from(e.dataTransfer.types).includes('Files')
const isInternalDrag = (e: React.DragEvent) => Array.from(e.dataTransfer.types).includes(DND_MIME)

export default function DrivePage() {
  const { wsId } = useParams<{ wsId: string }>()
  const queryClient = useQueryClient()
  const workspace = useWorkspaceStore(s => s.current)
  const myUserId = useAuthStore(s => s.user?.id)
  const canEdit = workspace?.myRole !== 'GUEST'
  const isAdmin = workspace?.myRole === 'ADMIN'
  // Permesso per-file: un file marcato "modificabile da tutti" (default) è gestibile da ogni membro
  // non guest; altrimenti solo dal proprietario o dall'admin. (Il backend applica comunque la regola.)
  const canMoveFile = (f: DriveFile) => canEdit && (isAdmin || f.uploadedBy === myUserId || f.editableByAll !== false)
  const canMoveFolder = (f: FolderType) => canEdit && (isAdmin || f.createdBy === myUserId)
  // Solo il proprietario o l'admin può cambiare il flag "sola lettura" di un file/cartella.
  const canSetFilePermission = (f: DriveFile) => isAdmin || f.uploadedBy === myUserId
  const canSetFolderPermission = (f: FolderType) => isAdmin || f.createdBy === myUserId

  const [path, setPath] = useState<Crumb[]>([])
  const currentFolderId = path.length ? path[path.length - 1].id : undefined

  const [newFolderOpen, setNewFolderOpen] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  const [creating, setCreating] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState<{ index: number; total: number; percent: number; name: string } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const folderRef = useRef<HTMLInputElement>(null)
  const [viewerFile, setViewerFile] = useState<DriveFile | null>(null)
  const [renameTarget, setRenameTarget] = useState<{ kind: 'file' | 'folder'; id: string; name: string } | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [renaming, setRenaming] = useState(false)

  // Stato drag-and-drop.
  const [dragItem, setDragItem] = useState<DragItem | null>(null)
  const [dropTarget, setDropTarget] = useState<string | null>(null) // id cartella o 'crumb:<id|root>'
  const [externalOver, setExternalOver] = useState(false)
  const dragDepth = useRef(0)

  const { data: folders = [] } = useQuery<FolderType[]>({
    queryKey: ['drive-folders', wsId, currentFolderId],
    queryFn: () => driveApi.listFolders(wsId!, currentFolderId),
    enabled: !!wsId,
  })
  const { data: files = [] } = useQuery<DriveFile[]>({
    queryKey: ['drive-files', wsId, currentFolderId],
    queryFn: () => driveApi.listFiles(wsId!, currentFolderId),
    enabled: !!wsId,
    // Tiene aggiornato lo stato "in modifica da..." senza refresh manuale.
    refetchInterval: 15000,
  })
  const { data: members = [] } = useQuery<Member[]>({
    queryKey: ['members', wsId],
    queryFn: () => workspacesApi.getMembers(wsId!),
    enabled: !!wsId,
  })

  const memberOf = (id?: string) => members.find(m => m.userId === id)
  const resolveName = (id?: string) => memberOf(id)?.displayName ?? 'Sconosciuto'
  const isLocked = (f: DriveFile) =>
    !!f.lockedBy && !!f.lockedAt && Date.now() - new Date(f.lockedAt).getTime() < 5 * 60 * 1000

  // Apri il file: anteprima/editor per i tipi supportati, altrimenti download.
  const openFile = (f: DriveFile) => {
    const k = fileKind(f.filename, f.contentType)
    if (k === 'other') { driveApi.download(wsId!, f.id, f.filename); return }
    setViewerFile(f)
  }

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['drive-folders', wsId, currentFolderId] })
    queryClient.invalidateQueries({ queryKey: ['drive-files', wsId, currentFolderId] })
  }
  // Invalida tutte le viste del Drive (utile quando lo spostamento tocca più cartelle).
  const refreshAll = () => {
    queryClient.invalidateQueries({ queryKey: ['drive-folders', wsId] })
    queryClient.invalidateQueries({ queryKey: ['drive-files', wsId] })
  }

  const openFolder = (f: FolderType) => setPath(p => [...p, { id: f.id, name: f.name }])
  const goToCrumb = (index: number) => setPath(p => p.slice(0, index))

  const handleCreateFolder = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newFolderName.trim() || !wsId) return
    setCreating(true)
    try {
      await driveApi.createFolder(wsId, newFolderName.trim(), currentFolderId)
      setNewFolderName('')
      setNewFolderOpen(false)
      refresh()
      toast('Cartella creata')
    } catch (err: any) {
      toast(err.response?.data?.error ?? 'Errore', 'destructive')
    } finally {
      setCreating(false)
    }
  }

  // Carica uno o più file nella cartella indicata (default: cartella corrente).
  const uploadFiles = async (fileList: FileList | File[], folderId = currentFolderId) => {
    const list = Array.from(fileList)
    if (!list.length || !wsId) return
    setUploading(true)
    let ok = 0
    try {
      for (let i = 0; i < list.length; i++) {
        const file = list[i]
        setProgress({ index: i + 1, total: list.length, percent: 0, name: file.name })
        try {
          await driveApi.upload(wsId, file, folderId, p =>
            setProgress(prev => prev && { ...prev, percent: p }))
          ok++
        } catch (err: any) {
          toast(`Errore con "${file.name}": ${err.response?.data?.error ?? 'caricamento fallito'}`, 'destructive')
        }
      }
      if (ok > 0) {
        refreshAll()
        toast(ok === 1 ? 'File caricato' : `${ok} file caricati`)
      }
    } finally {
      setUploading(false)
      setProgress(null)
    }
  }

  const handleUploadInput = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.length) await uploadFiles(e.target.files)
    if (fileRef.current) fileRef.current.value = ''
  }

  // Carica un'intera cartella ricreandone l'alberatura nel Drive. Il browser fornisce un FileList
  // piatto dove ogni file ha `webkitRelativePath` (es. "Progetto/img/logo.png"): si creano le
  // cartelle mancanti una volta sola (cache per path) e poi si carica ogni file nella sua cartella.
  // Un file da caricare con il suo path relativo (es. "Progetto/img/logo.png"): la cartella è tutto
  // tranne l'ultimo segmento. Usato sia dall'input "Carica cartella" sia dal drag & drop di cartelle.
  type UploadEntry = { file: File; relPath: string }

  const uploadEntries = async (entries: UploadEntry[], baseFolderId = currentFolderId) => {
    if (!entries.length || !wsId) return
    setUploading(true)
    // path relativo della cartella -> id creato. '' = cartella di destinazione (radice dell'upload).
    const folderIdByPath = new Map<string, string | undefined>([['', baseFolderId]])

    const ensureFolder = async (dirPath: string): Promise<string | undefined> => {
      if (folderIdByPath.has(dirPath)) return folderIdByPath.get(dirPath)
      const parts = dirPath.split('/')
      const name = parts[parts.length - 1]
      const parentId = await ensureFolder(parts.slice(0, -1).join('/'))
      const folder = await driveApi.createFolder(wsId, name, parentId)
      folderIdByPath.set(dirPath, folder.id)
      return folder.id
    }

    let ok = 0
    try {
      for (let i = 0; i < entries.length; i++) {
        const { file, relPath } = entries[i]
        const dirPath = relPath.split('/').slice(0, -1).join('/')
        setProgress({ index: i + 1, total: entries.length, percent: 0, name: relPath })
        try {
          const folderId = await ensureFolder(dirPath)
          await driveApi.upload(wsId, file, folderId, p =>
            setProgress(prev => prev && { ...prev, percent: p }))
          ok++
        } catch (err: any) {
          toast(`Errore con "${relPath}": ${err.response?.data?.error ?? 'caricamento fallito'}`, 'destructive')
        }
      }
      if (ok > 0) {
        refreshAll()
        toast(ok === 1 ? 'File caricato' : `${ok} file caricati`)
      }
    } finally {
      setUploading(false)
      setProgress(null)
    }
  }

  const handleUploadFolderInput = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.length) {
      const entries = Array.from(e.target.files).map(f => ({ file: f, relPath: (f as any).webkitRelativePath || f.name }))
      await uploadEntries(entries)
    }
    if (folderRef.current) folderRef.current.value = ''
  }

  // ---- Drag & drop di cartelle (oltre ai singoli file) ----
  // Il DataTransfer è valido SOLO durante l'handler: catturiamo gli "entry" in modo sincrono qui,
  // poi li espandiamo (ricorsione cartelle) in modo asincrono.
  const snapshotDrop = (dt: DataTransfer): { roots: any[]; files: File[] } => {
    const roots = Array.from(dt.items || [])
      .filter(it => it.kind === 'file')
      .map(it => (it as any).webkitGetAsEntry?.())
      .filter(Boolean)
    return { roots, files: Array.from(dt.files) }
  }

  // Visita ricorsivamente un FileSystemEntry (file o directory) accumulando gli UploadEntry.
  const walkEntry = async (entry: any, prefix: string, out: UploadEntry[]): Promise<void> => {
    if (entry.isFile) {
      const file: File = await new Promise((res, rej) => entry.file(res, rej))
      out.push({ file, relPath: prefix + entry.name })
    } else if (entry.isDirectory) {
      const reader = entry.createReader()
      // readEntries restituisce a lotti: va richiamato finché non torna vuoto.
      const children: any[] = await new Promise((res, rej) => {
        const all: any[] = []
        const read = () => reader.readEntries((batch: any[]) => {
          if (!batch.length) return res(all)
          all.push(...batch); read()
        }, rej)
        read()
      })
      for (const child of children) await walkEntry(child, prefix + entry.name + '/', out)
    }
  }

  // Carica il contenuto di un drop (file e/o cartelle) nella cartella indicata.
  const uploadDrop = async (snap: { roots: any[]; files: File[] }, baseFolderId = currentFolderId) => {
    const entries: UploadEntry[] = []
    if (snap.roots.length > 0) {
      for (const root of snap.roots) await walkEntry(root, '', entries)
    } else {
      // Browser senza API entry: ripiego sui file piatti.
      for (const f of snap.files) entries.push({ file: f, relPath: f.name })
    }
    await uploadEntries(entries, baseFolderId)
  }

  const openRename = (kind: 'file' | 'folder', id: string, name: string) => {
    setRenameTarget({ kind, id, name })
    setRenameValue(name)
  }

  const handleRename = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!wsId || !renameTarget) return
    const name = renameValue.trim()
    if (!name || name === renameTarget.name) { setRenameTarget(null); return }
    setRenaming(true)
    try {
      if (renameTarget.kind === 'file') await driveApi.renameFile(wsId, renameTarget.id, name)
      else await driveApi.renameFolder(wsId, renameTarget.id, name)
      setRenameTarget(null)
      refresh()
      toast('Rinominato')
    } catch (err: any) {
      toast(err.response?.data?.error ?? 'Errore nella rinomina', 'destructive')
    } finally {
      setRenaming(false)
    }
  }

  const handleCopyFile = async (f: DriveFile) => {
    if (!wsId) return
    try {
      await driveApi.copyFile(wsId, f.id)
      refresh()
      toast('File copiato')
    } catch (err: any) {
      toast(err.response?.data?.error ?? 'Errore nella copia', 'destructive')
    }
  }

  // Alterna fra "modificabile da tutti" e "sola lettura" (solo proprietario/admin).
  const handleToggleFilePermission = async (f: DriveFile) => {
    if (!wsId) return
    const next = f.editableByAll === false // attualmente sola lettura → rendi modificabile
    try {
      await driveApi.setFilePermission(wsId, f.id, next)
      refresh()
      toast(next ? 'File ora modificabile da tutti' : 'File ora in sola lettura')
    } catch (err: any) {
      toast(err.response?.data?.error ?? 'Errore', 'destructive')
    }
  }

  // Come sopra ma per una cartella: il flag viene propagato in cascata a file e sottocartelle.
  const handleToggleFolderPermission = async (f: FolderType) => {
    if (!wsId) return
    const next = f.editableByAll === false
    try {
      await driveApi.setFolderPermission(wsId, f.id, next)
      refreshAll()
      toast(next ? 'Cartella e contenuti ora modificabili da tutti' : 'Cartella e contenuti ora in sola lettura')
    } catch (err: any) {
      toast(err.response?.data?.error ?? 'Errore', 'destructive')
    }
  }

  const handleDeleteFolder = async (f: FolderType) => {
    if (!wsId) return
    if (!confirm(`Eliminare la cartella "${f.name}"? Dev'essere vuota.`)) return
    try {
      await driveApi.deleteFolder(wsId, f.id)
      refresh()
      toast('Cartella eliminata')
    } catch (err: any) {
      toast(err.response?.data?.error ?? 'Errore', 'destructive')
    }
  }

  const handleDownload = async (f: DriveFile) => {
    if (!wsId) return
    try {
      await driveApi.download(wsId, f.id, f.filename)
    } catch {
      toast('Errore nel download', 'destructive')
    }
  }

  const handleDownloadFolder = async (f: FolderType) => {
    if (!wsId) return
    try {
      toast('Preparazione dello ZIP…')
      await driveApi.downloadFolder(wsId, f.id, f.name)
    } catch {
      toast('Errore nel download della cartella', 'destructive')
    }
  }

  const handleDeleteFile = async (f: DriveFile) => {
    if (!wsId) return
    if (!confirm(`Eliminare "${f.filename}"?`)) return
    try {
      await driveApi.deleteFile(wsId, f.id)
      refresh()
      toast('File eliminato')
    } catch (err: any) {
      toast(err.response?.data?.error ?? 'Errore', 'destructive')
    }
  }

  // ---- Drag & drop interno ----

  const startDrag = (e: React.DragEvent, item: DragItem) => {
    if (!canEdit) return
    e.dataTransfer.setData(DND_MIME, JSON.stringify(item))
    e.dataTransfer.effectAllowed = 'move'
    setDragItem(item)
  }
  const endDrag = () => { setDragItem(null); setDropTarget(null) }

  // Sposta l'elemento trascinato nella cartella target (undefined = radice).
  const moveTo = async (targetFolderId?: string) => {
    if (!wsId || !dragItem) return
    const item = dragItem
    if (item.kind === 'folder' && item.id === targetFolderId) return
    try {
      if (item.kind === 'file') await driveApi.moveFile(wsId, item.id, targetFolderId)
      else await driveApi.moveFolder(wsId, item.id, targetFolderId)
      refreshAll()
      toast(`"${item.name}" spostato`)
    } catch (err: any) {
      toast(err.response?.data?.error ?? 'Errore nello spostamento', 'destructive')
    }
  }

  // Drop su una riga cartella: sposta dentro (interno) o carica dentro (esterno).
  const handleDropOnFolder = async (e: React.DragEvent, folder: FolderType) => {
    e.preventDefault(); e.stopPropagation()
    setDropTarget(null)
    if (isExternalDrag(e)) { const snap = snapshotDrop(e.dataTransfer); await uploadDrop(snap, folder.id); return }
    await moveTo(folder.id)
    endDrag()
  }

  // Drop su un breadcrumb: sposta/carica in quella cartella (o radice).
  const handleDropOnCrumb = async (e: React.DragEvent, targetId?: string) => {
    e.preventDefault(); e.stopPropagation()
    setDropTarget(null)
    if (isExternalDrag(e)) { const snap = snapshotDrop(e.dataTransfer); await uploadDrop(snap, targetId); return }
    await moveTo(targetId)
    endDrag()
  }

  // ---- Drop esterno sull'area principale (upload nella cartella corrente) ----

  const onAreaDragEnter = (e: React.DragEvent) => {
    if (!canEdit || !isExternalDrag(e)) return
    dragDepth.current += 1
    setExternalOver(true)
  }
  const onAreaDragOver = (e: React.DragEvent) => {
    if (canEdit && isExternalDrag(e)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy' }
  }
  const onAreaDragLeave = (e: React.DragEvent) => {
    if (!isExternalDrag(e)) return
    dragDepth.current = Math.max(0, dragDepth.current - 1)
    if (dragDepth.current === 0) setExternalOver(false)
  }
  const onAreaDrop = async (e: React.DragEvent) => {
    dragDepth.current = 0
    setExternalOver(false)
    if (!canEdit) return
    if (isExternalDrag(e)) {
      e.preventDefault()
      const snap = snapshotDrop(e.dataTransfer) // cattura sincrona prima dell'await
      await uploadDrop(snap)
    }
  }

  const allowFolderDrop = (e: React.DragEvent, folder: FolderType) => {
    if (!canEdit) return
    if (isExternalDrag(e) || (isInternalDrag(e) && !(dragItem?.kind === 'folder' && dragItem.id === folder.id))) {
      e.preventDefault(); e.stopPropagation()
      e.dataTransfer.dropEffect = isExternalDrag(e) ? 'copy' : 'move'
      setDropTarget(folder.id)
    }
  }
  const allowCrumbDrop = (e: React.DragEvent, key: string) => {
    if (!canEdit) return
    if (isExternalDrag(e) || isInternalDrag(e)) {
      e.preventDefault(); e.stopPropagation()
      e.dataTransfer.dropEffect = isExternalDrag(e) ? 'copy' : 'move'
      setDropTarget(key)
    }
  }

  const empty = folders.length === 0 && files.length === 0

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b shrink-0">
        <div>
          <h1 className="text-lg font-semibold">File condivisi</h1>
          <p className="text-xs text-muted-foreground">{workspace?.name}</p>
        </div>
        {canEdit && (
          <div className="flex gap-2">
            <input ref={fileRef} type="file" multiple className="hidden" onChange={handleUploadInput} />
            {/* webkitdirectory: il browser seleziona un'intera cartella (non tipizzato in React → cast). */}
            <input
              ref={folderRef}
              type="file"
              className="hidden"
              onChange={handleUploadFolderInput}
              {...({ webkitdirectory: '', directory: '', mozdirectory: '' } as any)}
            />
            <Button size="sm" variant="outline" onClick={() => setNewFolderOpen(true)}>
              <FolderPlus className="h-4 w-4 mr-1.5" /> Nuova cartella
            </Button>
            <Button size="sm" variant="outline" disabled={uploading} onClick={() => folderRef.current?.click()}>
              <FolderUp className="h-4 w-4 mr-1.5" /> Carica cartella
            </Button>
            <Button size="sm" disabled={uploading} onClick={() => fileRef.current?.click()}>
              <Upload className="h-4 w-4 mr-1.5" /> {uploading ? 'Caricamento...' : 'Carica file'}
            </Button>
          </div>
        )}
      </div>

      {/* Breadcrumb (anche drop target per lo spostamento) */}
      <div className="flex items-center gap-1 px-6 py-2.5 border-b text-sm shrink-0">
        <button
          onClick={() => setPath([])}
          onDragOver={e => allowCrumbDrop(e, 'crumb:root')}
          onDragLeave={() => setDropTarget(null)}
          onDrop={e => handleDropOnCrumb(e, undefined)}
          className={cn('flex items-center gap-1 rounded px-1 py-0.5 hover:text-foreground transition-colors',
            path.length === 0 ? 'text-foreground font-medium' : 'text-muted-foreground',
            dropTarget === 'crumb:root' && 'ring-2 ring-primary bg-primary/10 text-foreground')}
        >
          <Home className="h-3.5 w-3.5" /> Home
        </button>
        {path.map((c, i) => (
          <span key={c.id ?? i} className="flex items-center gap-1">
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/50" />
            <button
              onClick={() => goToCrumb(i + 1)}
              onDragOver={e => allowCrumbDrop(e, `crumb:${c.id}`)}
              onDragLeave={() => setDropTarget(null)}
              onDrop={e => handleDropOnCrumb(e, c.id)}
              className={cn('rounded px-1 py-0.5 hover:text-foreground transition-colors truncate max-w-[160px]',
                i === path.length - 1 ? 'text-foreground font-medium' : 'text-muted-foreground',
                dropTarget === `crumb:${c.id}` && 'ring-2 ring-primary bg-primary/10 text-foreground')}
            >
              {c.name}
            </button>
          </span>
        ))}
      </div>

      {/* Content (drop esterno → upload nella cartella corrente) */}
      <div
        className="flex-1 overflow-y-auto p-6 relative"
        onDragEnter={onAreaDragEnter}
        onDragOver={onAreaDragOver}
        onDragLeave={onAreaDragLeave}
        onDrop={onAreaDrop}
      >
        {externalOver && (
          <div className="absolute inset-3 z-10 rounded-xl border-2 border-dashed border-primary bg-primary/5 flex flex-col items-center justify-center gap-2 pointer-events-none">
            <Upload className="h-8 w-8 text-primary" />
            <p className="text-sm font-medium text-primary">Rilascia qui per caricare</p>
            <p className="text-xs text-muted-foreground">
              nella cartella {currentFolderId ? `"${path[path.length - 1].name}"` : 'Home'}
            </p>
          </div>
        )}

        {empty ? (
          <div className="flex flex-col items-center justify-center h-64 text-center gap-2">
            <FolderIcon className="h-10 w-10 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">Questa cartella è vuota.</p>
            {canEdit && <p className="text-xs text-muted-foreground">Trascina qui dei file o crea una cartella per iniziare.</p>}
          </div>
        ) : (
          <div className="space-y-1.5 max-w-3xl">
            {/* Folders */}
            {folders.map(f => (
              <div
                key={f.id}
                draggable={canMoveFolder(f)}
                onDragStart={e => startDrag(e, { kind: 'folder', id: f.id, name: f.name })}
                onDragEnd={endDrag}
                onDragOver={e => allowFolderDrop(e, f)}
                onDragLeave={() => setDropTarget(null)}
                onDrop={e => handleDropOnFolder(e, f)}
                className={cn(
                  'group flex items-center gap-3 rounded-lg border px-4 py-2.5 hover:bg-muted/40 transition-colors',
                  canMoveFolder(f) && 'cursor-grab active:cursor-grabbing',
                  dragItem?.kind === 'folder' && dragItem.id === f.id && 'opacity-50',
                  dropTarget === f.id && 'ring-2 ring-primary bg-primary/10',
                )}
              >
                {canMoveFolder(f) && (
                  <GripVertical className="h-4 w-4 shrink-0 text-muted-foreground/40 opacity-0 group-hover:opacity-100 transition-opacity" />
                )}
                <button onClick={() => openFolder(f)} className="flex items-center gap-3 flex-1 min-w-0 text-left">
                  <FolderIcon className="h-5 w-5 shrink-0 text-primary" />
                  <span className="text-sm font-medium truncate">{f.name}</span>
                  {f.editableByAll === false && (
                    <span className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground shrink-0" title="Sola lettura: la cartella e tutto il suo contenuto sono modificabili solo da proprietario o admin">
                      <Lock className="h-2.5 w-2.5" /> sola lettura
                    </span>
                  )}
                </button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      className="shrink-0 p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent opacity-0 group-hover:opacity-100 transition"
                      title="Azioni"
                    >
                      <MoreVertical className="h-4 w-4" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => handleDownloadFolder(f)}>
                      <Download className="h-4 w-4" /> Scarica (ZIP)
                    </DropdownMenuItem>
                    {canMoveFolder(f) && (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={() => openRename('folder', f.id, f.name)}>
                          <Pencil className="h-4 w-4" /> Rinomina
                        </DropdownMenuItem>
                        {canSetFolderPermission(f) && (
                          <DropdownMenuItem onClick={() => handleToggleFolderPermission(f)}>
                            {f.editableByAll === false
                              ? <><LockOpen className="h-4 w-4" /> Rendi modificabile (cartella + contenuti)</>
                              : <><Lock className="h-4 w-4" /> Sola lettura (cartella + contenuti)</>}
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={() => handleDeleteFolder(f)} className="text-destructive focus:text-destructive">
                          <Trash2 className="h-4 w-4" /> Elimina
                        </DropdownMenuItem>
                      </>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            ))}

            {/* Files */}
            {files.map(f => (
              <div
                key={f.id}
                draggable={canMoveFile(f)}
                onDragStart={e => startDrag(e, { kind: 'file', id: f.id, name: f.filename })}
                onDragEnd={endDrag}
                className={cn(
                  'group flex items-center gap-3 rounded-lg border px-4 py-2.5 hover:bg-muted/40 transition-colors',
                  canMoveFile(f) && 'cursor-grab active:cursor-grabbing',
                  dragItem?.kind === 'file' && dragItem.id === f.id && 'opacity-50',
                )}
              >
                {canMoveFile(f) && (
                  <GripVertical className="h-4 w-4 shrink-0 text-muted-foreground/40 opacity-0 group-hover:opacity-100 transition-opacity" />
                )}
                <button onClick={() => openFile(f)} className="flex items-center gap-3 flex-1 min-w-0 text-left">
                  <FileIcon className="h-5 w-5 shrink-0 text-muted-foreground" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm truncate flex items-center gap-1.5">
                      {f.filename}
                      {isLocked(f) && <Lock className="h-3 w-3 text-amber-500 shrink-0" />}
                      {f.editableByAll === false && (
                        <span className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground shrink-0" title="Sola lettura: solo il proprietario o un admin può modificarlo">
                          <Lock className="h-2.5 w-2.5" /> sola lettura
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                      <UserAvatar name={resolveName(f.uploadedBy)} avatar={memberOf(f.uploadedBy)?.avatar} className="h-4 w-4" fallbackClassName="text-[8px]" />
                      {resolveName(f.uploadedBy)} · {formatBytes(f.sizeBytes)} · {formatDate(f.createdAt)}
                      {isLocked(f) && <span className="text-amber-600 dark:text-amber-400">· in modifica da {resolveName(f.lockedBy)}</span>}
                    </p>
                  </div>
                </button>
                <button
                  onClick={() => handleDownload(f)}
                  className="shrink-0 p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                  title="Scarica"
                >
                  <Download className="h-4 w-4" />
                </button>
                {canEdit && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        className="shrink-0 p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                        title="Azioni"
                      >
                        <MoreVertical className="h-4 w-4" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => handleCopyFile(f)}>
                        <Copy className="h-4 w-4" /> Copia
                      </DropdownMenuItem>
                      {canMoveFile(f) && (
                        <DropdownMenuItem onClick={() => openRename('file', f.id, f.filename)}>
                          <Pencil className="h-4 w-4" /> Rinomina
                        </DropdownMenuItem>
                      )}
                      {canSetFilePermission(f) && (
                        <DropdownMenuItem onClick={() => handleToggleFilePermission(f)}>
                          {f.editableByAll === false
                            ? <><LockOpen className="h-4 w-4" /> Rendi modificabile</>
                            : <><Lock className="h-4 w-4" /> Imposta sola lettura</>}
                        </DropdownMenuItem>
                      )}
                      {canMoveFile(f) && <DropdownMenuSeparator />}
                      {canMoveFile(f) && (
                        <DropdownMenuItem onClick={() => handleDeleteFile(f)} className="text-destructive focus:text-destructive">
                          <Trash2 className="h-4 w-4" /> Elimina
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Avanzamento upload */}
      {progress && (
        <div className="fixed bottom-5 right-5 z-50 w-72 rounded-lg border bg-background shadow-lg p-3.5 space-y-2">
          <div className="flex items-center gap-2">
            <Upload className="h-4 w-4 shrink-0 text-primary" />
            <span className="text-sm font-medium">
              Caricamento {progress.total > 1 ? `(${progress.index}/${progress.total})` : ''}
            </span>
            <span className="ml-auto text-xs text-muted-foreground">{progress.percent}%</span>
          </div>
          <p className="text-xs text-muted-foreground truncate">{progress.name}</p>
          <Progress value={progress.percent} />
        </div>
      )}

      {/* New folder dialog */}
      <Dialog open={newFolderOpen} onOpenChange={v => !v && setNewFolderOpen(false)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Nuova cartella</DialogTitle></DialogHeader>
          <form onSubmit={handleCreateFolder} className="space-y-4">
            <div className="space-y-1.5">
              <Label>Nome</Label>
              <Input value={newFolderName} onChange={e => setNewFolderName(e.target.value)} autoFocus placeholder="Es: Documenti" required />
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setNewFolderOpen(false)}>Annulla</Button>
              <Button type="submit" disabled={creating || !newFolderName.trim()}>{creating ? 'Creazione...' : 'Crea'}</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Rename dialog */}
      <Dialog open={!!renameTarget} onOpenChange={v => !v && setRenameTarget(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Rinomina {renameTarget?.kind === 'folder' ? 'cartella' : 'file'}</DialogTitle></DialogHeader>
          <form onSubmit={handleRename} className="space-y-4">
            <div className="space-y-1.5">
              <Label>Nome</Label>
              <Input value={renameValue} onChange={e => setRenameValue(e.target.value)} autoFocus required />
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setRenameTarget(null)}>Annulla</Button>
              <Button type="submit" disabled={renaming || !renameValue.trim()}>{renaming ? 'Salvataggio...' : 'Rinomina'}</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <FileViewerDialog
        open={!!viewerFile}
        onClose={() => { setViewerFile(null); refresh() }}
        wsId={wsId!}
        file={viewerFile}
        canEdit={canEdit}
        resolveName={resolveName}
      />
    </div>
  )
}
