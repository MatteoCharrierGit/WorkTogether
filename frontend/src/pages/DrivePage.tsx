import { useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { driveApi, workspacesApi } from '@/lib/api'
import { Folder as FolderType, DriveFile, Member } from '@/types'
import { useWorkspaceStore } from '@/store/workspaceStore'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { toast } from '@/components/ui/toast'
import { formatBytes, formatDate, cn } from '@/lib/utils'
import { fileKind } from '@/lib/markdown'
import { UserAvatar } from '@/components/UserAvatar'
import { FileViewerDialog } from '@/components/FileViewerDialog'
import {
  Folder as FolderIcon, FolderPlus, Upload, Download, Trash2,
  ChevronRight, File as FileIcon, Home, Lock,
} from 'lucide-react'

interface Crumb { id?: string; name: string }

export default function DrivePage() {
  const { wsId } = useParams<{ wsId: string }>()
  const queryClient = useQueryClient()
  const workspace = useWorkspaceStore(s => s.current)
  const canEdit = workspace?.myRole !== 'GUEST'

  const [path, setPath] = useState<Crumb[]>([])
  const currentFolderId = path.length ? path[path.length - 1].id : undefined

  const [newFolderOpen, setNewFolderOpen] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  const [creating, setCreating] = useState(false)
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const [viewerFile, setViewerFile] = useState<DriveFile | null>(null)

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

  const openFolder = (f: FolderType) => setPath(p => [...p, { id: f.id, name: f.name }])
  const goToCrumb = (index: number) => setPath(p => p.slice(0, index)) // index -1 → root handled below

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

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !wsId) return
    setUploading(true)
    try {
      await driveApi.upload(wsId, file, currentFolderId)
      refresh()
      toast('File caricato')
    } catch (err: any) {
      toast(err.response?.data?.error ?? 'Errore nel caricamento', 'destructive')
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
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
            <input ref={fileRef} type="file" className="hidden" onChange={handleUpload} />
            <Button size="sm" variant="outline" onClick={() => setNewFolderOpen(true)}>
              <FolderPlus className="h-4 w-4 mr-1.5" /> Nuova cartella
            </Button>
            <Button size="sm" disabled={uploading} onClick={() => fileRef.current?.click()}>
              <Upload className="h-4 w-4 mr-1.5" /> {uploading ? 'Caricamento...' : 'Carica file'}
            </Button>
          </div>
        )}
      </div>

      {/* Breadcrumb */}
      <div className="flex items-center gap-1 px-6 py-2.5 border-b text-sm shrink-0">
        <button
          onClick={() => setPath([])}
          className={cn('flex items-center gap-1 hover:text-foreground transition-colors',
            path.length === 0 ? 'text-foreground font-medium' : 'text-muted-foreground')}
        >
          <Home className="h-3.5 w-3.5" /> Home
        </button>
        {path.map((c, i) => (
          <span key={c.id ?? i} className="flex items-center gap-1">
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/50" />
            <button
              onClick={() => goToCrumb(i + 1)}
              className={cn('hover:text-foreground transition-colors truncate max-w-[160px]',
                i === path.length - 1 ? 'text-foreground font-medium' : 'text-muted-foreground')}
            >
              {c.name}
            </button>
          </span>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        {empty ? (
          <div className="flex flex-col items-center justify-center h-64 text-center gap-2">
            <FolderIcon className="h-10 w-10 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">Questa cartella è vuota.</p>
            {canEdit && <p className="text-xs text-muted-foreground">Carica un file o crea una cartella per iniziare.</p>}
          </div>
        ) : (
          <div className="space-y-1.5 max-w-3xl">
            {/* Folders */}
            {folders.map(f => (
              <div
                key={f.id}
                className="group flex items-center gap-3 rounded-lg border px-4 py-2.5 hover:bg-muted/40 transition-colors"
              >
                <button onClick={() => openFolder(f)} className="flex items-center gap-3 flex-1 min-w-0 text-left">
                  <FolderIcon className="h-5 w-5 shrink-0 text-primary" />
                  <span className="text-sm font-medium truncate">{f.name}</span>
                </button>
                {canEdit && (
                  <button
                    onClick={() => handleDeleteFolder(f)}
                    className="shrink-0 p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-accent opacity-0 group-hover:opacity-100 transition"
                    title="Elimina cartella"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            ))}

            {/* Files */}
            {files.map(f => (
              <div
                key={f.id}
                className="group flex items-center gap-3 rounded-lg border px-4 py-2.5 hover:bg-muted/40 transition-colors"
              >
                <button onClick={() => openFile(f)} className="flex items-center gap-3 flex-1 min-w-0 text-left">
                  <FileIcon className="h-5 w-5 shrink-0 text-muted-foreground" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm truncate flex items-center gap-1.5">
                      {f.filename}
                      {isLocked(f) && <Lock className="h-3 w-3 text-amber-500 shrink-0" />}
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
                  <button
                    onClick={() => handleDeleteFile(f)}
                    className="shrink-0 p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-accent transition-colors"
                    title="Elimina"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

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
