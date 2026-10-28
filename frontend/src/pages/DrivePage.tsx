import { useCallback, useMemo, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowDown, ArrowUp, ChevronRight, FolderOpen, FolderPlus, FolderUp, HardDrive, LayoutGrid, List, Search,
  Upload, X,
} from 'lucide-react'
import { driveApi, workspacesApi } from '@/lib/api'
import type { Folder as FolderType, DriveFile, Member } from '@/types'
import { useWorkspaceStore } from '@/store/workspaceStore'
import { useAuthStore } from '@/store/authStore'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { toast } from '@/components/ui/toast'
import { EmptyState, LoadingSkeleton, PageHeader, Callout, useConfirm } from '@/components/shared'
import { cn, getErrorMessage } from '@/lib/utils'
import { fileKind } from '@/lib/markdown'
import { FileViewerDialog } from '@/components/FileViewerDialog'
import { FileItem, FolderItem, LIST_COLS, type DragItem, type DriveActions, type DriveView } from '@/components/drive/DriveItems'
import { MoveDialog, type MoveTarget } from '@/components/drive/MoveDialog'

interface Crumb { id?: string; name: string }
type SortKey = 'name' | 'size' | 'date'
type SortDir = 'asc' | 'desc'

const DND_MIME = 'application/x-wt-item'
const VIEW_KEY = 'wt:drive-view'
const SORT_KEY = 'wt:drive-sort'
const LOCK_TTL = 5 * 60 * 1000

const isExternalDrag = (e: React.DragEvent) => Array.from(e.dataTransfer.types).includes('Files')
const isInternalDrag = (e: React.DragEvent) => Array.from(e.dataTransfer.types).includes(DND_MIME)
const isLocked = (f: DriveFile) => !!f.lockedBy && !!f.lockedAt && Date.now() - new Date(f.lockedAt).getTime() < LOCK_TTL

function readLS<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const v = localStorage.getItem(key) as T | null
    return v && allowed.includes(v) ? v : fallback
  } catch {
    return fallback
  }
}
function writeLS(key: string, value: string) {
  try { localStorage.setItem(key, value) } catch { /* ignore */ }
}

const collator = new Intl.Collator('it', { numeric: true, sensitivity: 'base' })

// Un file da caricare con il suo path relativo (es. "Progetto/img/logo.png"): la cartella è tutto
// tranne l'ultimo segmento. Usato sia dall'input "Carica cartella" sia dal drag & drop di cartelle.
type UploadEntry = { file: File; relPath: string }

export default function DrivePage() {
  const { wsId } = useParams<{ wsId: string }>()
  const queryClient = useQueryClient()
  const confirm = useConfirm()
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

  const [view, setViewState] = useState<DriveView>(() => readLS(VIEW_KEY, ['list', 'grid'] as const, 'list'))
  const setView = (v: DriveView) => { setViewState(v); writeLS(VIEW_KEY, v) }
  const [sort, setSortState] = useState<{ key: SortKey; dir: SortDir }>(() => {
    const raw = readLS(SORT_KEY, ['name:asc', 'name:desc', 'size:asc', 'size:desc', 'date:asc', 'date:desc'] as const, 'name:asc')
    const [key, dir] = raw.split(':') as [SortKey, SortDir]
    return { key, dir }
  })
  const setSort = (s: { key: SortKey; dir: SortDir }) => { setSortState(s); writeLS(SORT_KEY, `${s.key}:${s.dir}`) }
  const toggleSort = (key: SortKey) =>
    setSort(sort.key === key ? { key, dir: sort.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'name' ? 'asc' : 'desc' })
  const [filter, setFilter] = useState('')

  const [newFolderOpen, setNewFolderOpen] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  const [creating, setCreating] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState<{ index: number; total: number; percent: number; name: string } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const folderRef = useRef<HTMLInputElement>(null)
  const [viewerFile, setViewerFile] = useState<DriveFile | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [renameTarget, setRenameTarget] = useState<{ kind: 'file' | 'folder'; id: string; name: string } | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [renaming, setRenaming] = useState(false)
  const [moveTarget, setMoveTarget] = useState<MoveTarget | null>(null)

  // Stato drag-and-drop.
  const [dragItem, setDragItem] = useState<DragItem | null>(null)
  const [dropTarget, setDropTarget] = useState<string | null>(null) // id cartella o 'crumb:<id|root>'
  const [externalOver, setExternalOver] = useState(false)
  const dragDepth = useRef(0)

  // Niente polling: il Layout invalida 'drive-folders'/'drive-files' a ogni evento WS del workspace
  // (DRIVE_CHANGED incluso). Solo se nella cartella c'è un file in modifica si ricontrolla ogni 30s
  // per far sparire il badge quando il lock scade o viene rilasciato (acquire/release non emettono eventi).
  const foldersQuery = useQuery<FolderType[]>({
    queryKey: ['drive-folders', wsId, currentFolderId],
    queryFn: () => driveApi.listFolders(wsId!, currentFolderId),
    enabled: !!wsId,
  })
  const filesQuery = useQuery<DriveFile[]>({
    queryKey: ['drive-files', wsId, currentFolderId],
    queryFn: () => driveApi.listFiles(wsId!, currentFolderId),
    enabled: !!wsId,
    refetchInterval: q => ((q.state.data as DriveFile[] | undefined)?.some(isLocked) ? 30_000 : false),
  })
  const { data: members = [] } = useQuery<Member[]>({
    queryKey: ['members', wsId],
    queryFn: () => workspacesApi.getMembers(wsId!),
    enabled: !!wsId,
  })
  const folders = foldersQuery.data ?? []
  const files = filesQuery.data ?? []

  const membersById = useMemo(() => new Map(members.map(m => [m.userId, m])), [members])
  const resolveName = useCallback((id?: string) => (id && membersById.get(id)?.displayName) || 'Sconosciuto', [membersById])

  // Ordinamento e filtro memoizzati (le cartelle restano sempre prima dei file).
  const needle = filter.trim().toLowerCase()
  const sortedFolders = useMemo(() => {
    const list = needle ? folders.filter(f => f.name.toLowerCase().includes(needle)) : [...folders]
    const m = sort.dir === 'asc' ? 1 : -1
    return list.sort((a, b) =>
      sort.key === 'date' ? m * a.createdAt.localeCompare(b.createdAt) : (sort.key === 'name' ? m : 1) * collator.compare(a.name, b.name))
  }, [folders, needle, sort])
  const sortedFiles = useMemo(() => {
    const list = needle ? files.filter(f => f.filename.toLowerCase().includes(needle)) : [...files]
    const m = sort.dir === 'asc' ? 1 : -1
    return list.sort((a, b) =>
      sort.key === 'size' ? m * (a.sizeBytes - b.sizeBytes)
        : sort.key === 'date' ? m * a.createdAt.localeCompare(b.createdAt)
        : m * collator.compare(a.filename, b.filename))
  }, [files, needle, sort])

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['drive-folders', wsId, currentFolderId] })
    queryClient.invalidateQueries({ queryKey: ['drive-files', wsId, currentFolderId] })
  }
  // Invalida tutte le viste del Drive (utile quando lo spostamento tocca più cartelle).
  const refreshAll = () => {
    queryClient.invalidateQueries({ queryKey: ['drive-folders', wsId] })
    queryClient.invalidateQueries({ queryKey: ['drive-files', wsId] })
  }

  const goToCrumb = (index: number) => { setPath(p => p.slice(0, index)); setFilter(''); setSelectedId(null) }

  const handleCreateFolder = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newFolderName.trim() || !wsId) return
    setCreating(true)
    try {
      await driveApi.createFolder(wsId, newFolderName.trim(), currentFolderId)
      setNewFolderName('')
      setNewFolderOpen(false)
      refresh()
      toast('Cartella creata', 'success')
    } catch (err) {
      toast(getErrorMessage(err), 'destructive')
    } finally {
      setCreating(false)
    }
  }

  // Carica uno o più file nella cartella corrente.
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
          await driveApi.upload(wsId, file, folderId, p => setProgress(prev => prev && { ...prev, percent: p }))
          ok++
        } catch (err) {
          toast(`Errore con "${file.name}": ${getErrorMessage(err, 'caricamento fallito')}`, 'destructive')
        }
      }
      if (ok > 0) {
        refreshAll()
        toast(ok === 1 ? 'File caricato' : `${ok} file caricati`, 'success')
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

  // Carica un'intera cartella ricreandone l'alberatura nel Drive: si creano le cartelle mancanti
  // una volta sola (cache per path) e poi si carica ogni file nella sua cartella.
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
          await driveApi.upload(wsId, file, folderId, p => setProgress(prev => prev && { ...prev, percent: p }))
          ok++
        } catch (err) {
          toast(`Errore con "${relPath}": ${getErrorMessage(err, 'caricamento fallito')}`, 'destructive')
        }
      }
      if (ok > 0) {
        refreshAll()
        toast(ok === 1 ? 'File caricato' : `${ok} file caricati`, 'success')
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
    } catch (err) {
      toast(getErrorMessage(err, 'Errore nella rinomina'), 'destructive')
    } finally {
      setRenaming(false)
    }
  }

  // Sposta un file/cartella nella cartella target (undefined = radice).
  const moveItem = async (item: { kind: 'file' | 'folder'; id: string; name: string }, targetFolderId?: string) => {
    if (!wsId) return
    if (item.kind === 'folder' && item.id === targetFolderId) return
    try {
      if (item.kind === 'file') await driveApi.moveFile(wsId, item.id, targetFolderId)
      else await driveApi.moveFolder(wsId, item.id, targetFolderId)
      refreshAll()
      toast(`"${item.name}" spostato`)
    } catch (err) {
      toast(getErrorMessage(err, 'Errore nello spostamento'), 'destructive')
    }
  }

  // ---- Drop su breadcrumb / area ----

  const handleDropOnCrumb = async (e: React.DragEvent, targetId?: string) => {
    e.preventDefault(); e.stopPropagation()
    setDropTarget(null)
    if (isExternalDrag(e)) { const snap = snapshotDrop(e.dataTransfer); await uploadDrop(snap, targetId); return }
    if (dragItem) await moveItem(dragItem, targetId)
    setDragItem(null)
  }
  const allowCrumbDrop = (e: React.DragEvent, key: string) => {
    if (!canEdit) return
    if (isExternalDrag(e) || isInternalDrag(e)) {
      e.preventDefault(); e.stopPropagation()
      e.dataTransfer.dropEffect = isExternalDrag(e) ? 'copy' : 'move'
      setDropTarget(key)
    }
  }

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

  // ---- Azioni per le righe (identità stabile → le righe memoizzate non si ri-renderizzano) ----
  const impl: DriveActions = {
    openFolder: f => { setPath(p => [...p, { id: f.id, name: f.name }]); setFilter(''); setSelectedId(null) },
    openFile: f => {
      setSelectedId(f.id)
      // Anteprima/editor per i tipi supportati, altrimenti download.
      if (fileKind(f.filename, f.contentType) === 'other') { impl.downloadFile(f); return }
      setViewerFile(f)
    },
    downloadFile: async f => {
      if (!wsId) return
      try { await driveApi.download(wsId, f.id, f.filename) } catch { toast('Errore nel download', 'destructive') }
    },
    downloadFolder: async f => {
      if (!wsId) return
      try {
        toast('Preparazione dello ZIP…', 'info')
        await driveApi.downloadFolder(wsId, f.id, f.name)
      } catch {
        toast('Errore nel download della cartella', 'destructive')
      }
    },
    rename: (kind, id, name) => { setSelectedId(id); setRenameTarget({ kind, id, name }); setRenameValue(name) },
    move: t => { setSelectedId(t.id); setMoveTarget(t) },
    copyFile: async f => {
      if (!wsId) return
      try { await driveApi.copyFile(wsId, f.id); refresh(); toast('Copia creata') } catch (err) {
        toast(getErrorMessage(err, 'Errore nella copia'), 'destructive')
      }
    },
    // Alterna fra "modificabile da tutti" e "sola lettura" (solo proprietario/admin).
    toggleFilePermission: async f => {
      if (!wsId) return
      const next = f.editableByAll === false // attualmente sola lettura → rendi modificabile
      try {
        await driveApi.setFilePermission(wsId, f.id, next)
        refresh()
        toast(next ? 'File ora modificabile da tutti' : 'File ora in sola lettura')
      } catch (err) {
        toast(getErrorMessage(err), 'destructive')
      }
    },
    // Come sopra ma per una cartella: il flag viene propagato in cascata a file e sottocartelle.
    toggleFolderPermission: async f => {
      if (!wsId) return
      const next = f.editableByAll === false
      try {
        await driveApi.setFolderPermission(wsId, f.id, next)
        refreshAll()
        toast(next ? 'Cartella e contenuti ora modificabili da tutti' : 'Cartella e contenuti ora in sola lettura')
      } catch (err) {
        toast(getErrorMessage(err), 'destructive')
      }
    },
    deleteFile: async f => {
      if (!wsId) return
      const ok = await confirm({
        title: 'Eliminare il file?',
        description: `"${f.filename}" verrà eliminato definitivamente.`,
        confirmLabel: 'Elimina',
        destructive: true,
      })
      if (!ok) return
      try { await driveApi.deleteFile(wsId, f.id); refresh(); toast('File eliminato') } catch (err) {
        toast(getErrorMessage(err), 'destructive')
      }
    },
    deleteFolder: async f => {
      if (!wsId) return
      const ok = await confirm({
        title: 'Eliminare la cartella?',
        description: `"${f.name}" verrà eliminata. La cartella dev'essere vuota.`,
        confirmLabel: 'Elimina',
        destructive: true,
      })
      if (!ok) return
      try { await driveApi.deleteFolder(wsId, f.id); refresh(); toast('Cartella eliminata') } catch (err) {
        toast(getErrorMessage(err), 'destructive')
      }
    },
    dragStart: (e, item) => {
      if (!canEdit) return
      e.dataTransfer.setData(DND_MIME, JSON.stringify(item))
      e.dataTransfer.effectAllowed = 'move'
      setDragItem(item)
    },
    dragEnd: () => { setDragItem(null); setDropTarget(null) },
    folderDragOver: (e, folder) => {
      if (!canEdit) return
      if (isExternalDrag(e) || (isInternalDrag(e) && !(dragRef.current?.kind === 'folder' && dragRef.current.id === folder.id))) {
        e.preventDefault(); e.stopPropagation()
        e.dataTransfer.dropEffect = isExternalDrag(e) ? 'copy' : 'move'
        setDropTarget(folder.id)
      }
    },
    dragLeave: () => setDropTarget(null),
    // Drop su una cartella: sposta dentro (interno) o carica dentro (esterno).
    folderDrop: async (e, folder) => {
      e.preventDefault(); e.stopPropagation()
      setDropTarget(null)
      if (isExternalDrag(e)) { const snap = snapshotDrop(e.dataTransfer); await uploadDrop(snap, folder.id); return }
      if (dragRef.current) await moveItem(dragRef.current, folder.id)
      setDragItem(null)
    },
  }
  const dragRef = useRef(dragItem)
  dragRef.current = dragItem
  const implRef = useRef(impl)
  implRef.current = impl
  const actions = useMemo<DriveActions>(() => {
    const out = {} as Record<string, (...args: any[]) => any>
    for (const k of Object.keys(implRef.current)) out[k] = (...args: any[]) => (implRef.current as any)[k](...args)
    return out as unknown as DriveActions
  }, [])

  const loading = foldersQuery.isLoading || filesQuery.isLoading
  const error = foldersQuery.isError ? foldersQuery.error : filesQuery.isError ? filesQuery.error : null
  const empty = !loading && !error && folders.length === 0 && files.length === 0
  const noMatches = !empty && !!needle && sortedFolders.length === 0 && sortedFiles.length === 0
  const currentName = path.length ? path[path.length - 1].name : 'File condivisi'

  const crumbClass = (active: boolean, key: string) =>
    cn('focus-ring flex min-w-0 items-center gap-1 rounded-md px-1.5 py-0.5 transition-colors hover:bg-accent hover:text-foreground',
      active ? 'font-medium text-foreground' : 'text-muted-foreground',
      dropTarget === key && 'bg-primary/10 text-foreground ring-2 ring-primary')

  const breadcrumb = (
    <nav aria-label="Percorso cartelle" className="flex min-w-0 flex-wrap items-center gap-0.5">
      <button
        type="button"
        onClick={() => goToCrumb(0)}
        onDragOver={e => allowCrumbDrop(e, 'crumb:root')}
        onDragLeave={() => setDropTarget(null)}
        onDrop={e => handleDropOnCrumb(e, undefined)}
        className={crumbClass(path.length === 0, 'crumb:root')}
      >
        <HardDrive className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /> Drive
      </button>
      {path.map((c, i) => (
        <span key={c.id ?? i} className="flex min-w-0 items-center gap-0.5">
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50" aria-hidden="true" />
          <button
            type="button"
            onClick={() => goToCrumb(i + 1)}
            onDragOver={e => allowCrumbDrop(e, `crumb:${c.id}`)}
            onDragLeave={() => setDropTarget(null)}
            onDrop={e => handleDropOnCrumb(e, c.id)}
            aria-current={i === path.length - 1 ? 'page' : undefined}
            className={crumbClass(i === path.length - 1, `crumb:${c.id}`)}
          >
            <span className="max-w-[10rem] truncate">{c.name}</span>
          </button>
        </span>
      ))}
    </nav>
  )

  const sortHeader = (key: SortKey, label: string, className?: string) => (
    <button
      type="button"
      onClick={() => toggleSort(key)}
      className={cn('focus-ring -mx-1 inline-flex items-center gap-1 rounded-sm px-1 hover:text-foreground', sort.key === key && 'text-foreground', className)}
      aria-label={`Ordina per ${label.toLowerCase()}`}
    >
      {label}
      {sort.key === key && (sort.dir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
    </button>
  )

  const renderItems = () => (
    <>
      {sortedFolders.map(f => (
        <FolderItem
          key={f.id}
          folder={f}
          view={view}
          ownerName={resolveName(f.createdBy)}
          ownerAvatar={membersById.get(f.createdBy)?.avatar}
          canMove={canMoveFolder(f)}
          canSetPermission={canSetFolderPermission(f)}
          dragging={dragItem?.kind === 'folder' && dragItem.id === f.id}
          dropActive={dropTarget === f.id}
          selected={selectedId === f.id}
          actions={actions}
        />
      ))}
      {sortedFiles.map(f => (
        <FileItem
          key={f.id}
          file={f}
          view={view}
          ownerName={resolveName(f.uploadedBy)}
          ownerAvatar={membersById.get(f.uploadedBy)?.avatar}
          lockedByName={isLocked(f) ? resolveName(f.lockedBy) : undefined}
          canEdit={canEdit}
          canMove={canMoveFile(f)}
          canSetPermission={canSetFilePermission(f)}
          dragging={dragItem?.kind === 'file' && dragItem.id === f.id}
          selected={selectedId === f.id}
          actions={actions}
        />
      ))}
    </>
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {canEdit && (
        <>
          <input ref={fileRef} type="file" multiple className="hidden" onChange={handleUploadInput} />
          {/* webkitdirectory: il browser seleziona un'intera cartella (non tipizzato in React → cast). */}
          <input
            ref={folderRef}
            type="file"
            className="hidden"
            onChange={handleUploadFolderInput}
            {...({ webkitdirectory: '', directory: '', mozdirectory: '' } as any)}
          />
        </>
      )}

      {/* Contenuto (drop esterno → upload nella cartella corrente) */}
      <div
        className="relative min-h-0 flex-1 overflow-y-auto"
        onDragEnter={onAreaDragEnter}
        onDragOver={onAreaDragOver}
        onDragLeave={onAreaDragLeave}
        onDrop={onAreaDrop}
      >
        <div className="mx-auto w-full max-w-6xl px-4 py-4 sm:px-6 sm:py-6">
          <PageHeader
            title={currentName}
            description={path.length === 0 ? `File e cartelle condivisi in ${workspace?.name ?? 'questo workspace'}` : undefined}
            icon={path.length === 0 ? HardDrive : FolderOpen}
            breadcrumb={path.length > 0 ? breadcrumb : undefined}
            actions={canEdit && (
              <>
                <Button size="sm" disabled={uploading} loading={uploading} onClick={() => fileRef.current?.click()} className="sm:order-last">
                  {!uploading && <Upload className="h-4 w-4" />} {uploading ? 'Caricamento…' : 'Carica file'}
                </Button>
                <Button size="sm" variant="outline" disabled={uploading} onClick={() => folderRef.current?.click()}>
                  <FolderUp className="h-4 w-4" /> Carica cartella
                </Button>
                <Button size="sm" variant="outline" onClick={() => setNewFolderOpen(true)} className="sm:-order-1">
                  <FolderPlus className="h-4 w-4" /> Nuova cartella
                </Button>
              </>
            )}
          />

          {/* Toolbar: filtro, ordinamento, vista */}
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <div className="relative w-full min-w-0 sm:w-auto sm:max-w-xs sm:flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <Input
                value={filter}
                onChange={e => setFilter(e.target.value)}
                placeholder="Filtra per nome…"
                aria-label="Filtra file e cartelle"
                className="h-8 pl-8 pr-8"
              />
              {filter && (
                <IconButton
                  label="Cancella filtro"
                  icon={<X />}
                  size="xs"
                  className="absolute right-1 top-1/2 -translate-y-1/2"
                  onClick={() => setFilter('')}
                />
              )}
            </div>
            <div className="ml-auto flex items-center gap-2">
              <Select value={`${sort.key}:${sort.dir}`} onValueChange={v => { const [key, dir] = v.split(':') as [SortKey, SortDir]; setSort({ key, dir }) }}>
                <SelectTrigger aria-label="Ordinamento" className={cn('h-8 w-40 text-sm', view === 'list' && 'sm:hidden')}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="name:asc">Nome (A–Z)</SelectItem>
                  <SelectItem value="name:desc">Nome (Z–A)</SelectItem>
                  <SelectItem value="date:desc">Più recenti</SelectItem>
                  <SelectItem value="date:asc">Meno recenti</SelectItem>
                  <SelectItem value="size:desc">Più grandi</SelectItem>
                  <SelectItem value="size:asc">Più piccoli</SelectItem>
                </SelectContent>
              </Select>
              <div className="flex items-center rounded-md border p-0.5" role="group" aria-label="Vista">
                <IconButton
                  label="Vista elenco"
                  icon={<List />}
                  size="xs"
                  aria-pressed={view === 'list'}
                  className={cn(view === 'list' && 'bg-accent text-foreground')}
                  onClick={() => setView('list')}
                />
                <IconButton
                  label="Vista griglia"
                  icon={<LayoutGrid />}
                  size="xs"
                  aria-pressed={view === 'grid'}
                  className={cn(view === 'grid' && 'bg-accent text-foreground')}
                  onClick={() => setView('grid')}
                />
              </div>
            </div>
          </div>

          {loading ? (
            <LoadingSkeleton kind={view === 'grid' ? 'cards' : 'list'} rows={view === 'grid' ? 6 : 5} />
          ) : error ? (
            <Callout
              variant="destructive"
              title="Impossibile caricare il Drive"
              action={
                <Button size="sm" variant="outline" onClick={() => { foldersQuery.refetch(); filesQuery.refetch() }}>
                  Riprova
                </Button>
              }
            >
              {getErrorMessage(error)}
            </Callout>
          ) : empty ? (
            <EmptyState
              bordered
              icon={path.length ? FolderOpen : HardDrive}
              title={path.length ? 'Questa cartella è vuota' : 'Nessun file ancora'}
              description={canEdit ? 'Trascina qui file o cartelle dal computer, oppure usa i pulsanti qui sotto.' : 'Non ci sono ancora file condivisi qui.'}
              action={canEdit && (
                <>
                  <Button size="sm" onClick={() => fileRef.current?.click()} disabled={uploading}>
                    <Upload className="h-4 w-4" /> Carica file
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setNewFolderOpen(true)}>
                    <FolderPlus className="h-4 w-4" /> Nuova cartella
                  </Button>
                </>
              )}
            />
          ) : noMatches ? (
            <EmptyState
              size="sm"
              icon={Search}
              title="Nessun risultato"
              description={`Nessun file o cartella corrisponde a “${filter.trim()}”.`}
              action={<Button size="sm" variant="ghost" onClick={() => setFilter('')}>Cancella filtro</Button>}
            />
          ) : view === 'grid' ? (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3 lg:grid-cols-4 xl:grid-cols-5">{renderItems()}</div>
          ) : (
            <div className="rounded-lg border bg-card p-1">
              <div className={cn(LIST_COLS, 'hidden items-center gap-3 border-b px-2 pb-1.5 pt-1 text-caption font-medium text-muted-foreground sm:grid')}>
                <span className="pl-6">{sortHeader('name', 'Nome')}</span>
                <span className="hidden md:block">Proprietario</span>
                <span>{sortHeader('size', 'Dimensione')}</span>
                <span>{sortHeader('date', 'Data')}</span>
                <span className="sr-only">Azioni</span>
              </div>
              <div className="pt-0.5">{renderItems()}</div>
            </div>
          )}

          {canEdit && !empty && !loading && !error && (
            <p className="mt-3 hidden text-center text-caption text-muted-foreground sm:block">
              Trascina file o cartelle dal computer per caricarli qui · trascina un elemento su una cartella o sul percorso per spostarlo
            </p>
          )}
        </div>

        {externalOver && (
          <div className="pointer-events-none absolute inset-3 z-overlay flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-primary bg-primary/5">
            <Upload className="h-8 w-8 text-primary" aria-hidden="true" />
            <p className="text-sm font-medium text-primary">Rilascia qui per caricare</p>
            <p className="text-caption text-muted-foreground">nella cartella “{currentName}”</p>
          </div>
        )}
      </div>

      {/* Avanzamento upload */}
      {progress && (
        <div
          className="fixed inset-x-4 bottom-4 z-popover space-y-2 rounded-lg border bg-elevated p-3.5 shadow-lg sm:inset-x-auto sm:right-5 sm:w-80"
          role="status"
          aria-live="polite"
        >
          <div className="flex items-center gap-2">
            <Upload className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
            <span className="text-sm font-medium">
              Caricamento{progress.total > 1 ? ` ${progress.index} di ${progress.total}` : ''}
            </span>
            <span className="ml-auto text-caption tabular-nums text-muted-foreground">{progress.percent}%</span>
          </div>
          <p className="truncate text-caption text-muted-foreground">{progress.name}</p>
          <Progress value={progress.percent} aria-label="Avanzamento caricamento" />
        </div>
      )}

      {/* Nuova cartella */}
      <Dialog open={newFolderOpen} onOpenChange={v => !v && setNewFolderOpen(false)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Nuova cartella</DialogTitle></DialogHeader>
          <form onSubmit={handleCreateFolder} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="new-folder-name">Nome</Label>
              <Input id="new-folder-name" value={newFolderName} onChange={e => setNewFolderName(e.target.value)} autoFocus placeholder="Es: Documenti" required />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setNewFolderOpen(false)}>Annulla</Button>
              <Button type="submit" disabled={!newFolderName.trim()} loading={creating}>Crea</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Rinomina */}
      <Dialog open={!!renameTarget} onOpenChange={v => !v && setRenameTarget(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Rinomina {renameTarget?.kind === 'folder' ? 'cartella' : 'file'}</DialogTitle></DialogHeader>
          <form onSubmit={handleRename} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="rename-value">Nome</Label>
              <Input
                id="rename-value"
                value={renameValue}
                onChange={e => setRenameValue(e.target.value)}
                autoFocus
                required
                onFocus={e => {
                  // Seleziona il nome senza estensione, come nei file manager.
                  const dot = renameTarget?.kind === 'file' ? e.target.value.lastIndexOf('.') : -1
                  e.target.setSelectionRange(0, dot > 0 ? dot : e.target.value.length)
                }}
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setRenameTarget(null)}>Annulla</Button>
              <Button type="submit" disabled={!renameValue.trim()} loading={renaming}>Rinomina</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {wsId && (
        <MoveDialog
          wsId={wsId}
          target={moveTarget}
          initialPath={path}
          onClose={() => setMoveTarget(null)}
          onMove={async (t, folderId) => {
            await moveItem(t, folderId)
            setMoveTarget(null)
          }}
        />
      )}

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
