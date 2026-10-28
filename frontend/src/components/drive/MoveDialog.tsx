import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronRight, Home, FolderInput } from 'lucide-react'
import { driveApi } from '@/lib/api'
import type { Folder } from '@/types'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { QueryState } from '@/components/shared'
import { cn } from '@/lib/utils'
import { FolderGlyph } from './file-icon'

interface Crumb { id?: string; name: string }

export interface MoveTarget { kind: 'file' | 'folder'; id: string; name: string; currentFolderId?: string }

/** Selettore di cartella di destinazione per "Sposta in…". */
export function MoveDialog({
  wsId, target, initialPath, onClose, onMove,
}: {
  wsId: string
  target: MoveTarget | null
  initialPath: Crumb[]
  onClose: () => void
  onMove: (target: MoveTarget, folderId?: string) => Promise<void>
}) {
  const [path, setPath] = useState<Crumb[]>(initialPath)
  const [moving, setMoving] = useState(false)
  useEffect(() => { if (target) setPath(initialPath) }, [target]) // eslint-disable-line react-hooks/exhaustive-deps

  const folderId = path.length ? path[path.length - 1].id : undefined
  // Stessa chiave della pagina Drive: la cache è condivisa.
  const query = useQuery<Folder[]>({
    queryKey: ['drive-folders', wsId, folderId],
    queryFn: () => driveApi.listFolders(wsId, folderId),
    enabled: !!target,
  })

  // Una cartella non può finire dentro se stessa.
  const insideSelf = target?.kind === 'folder' && path.some(c => c.id === target.id)
  const sameFolder = (target?.currentFolderId ?? undefined) === folderId
  const disabled = !target || insideSelf || sameFolder || moving

  const submit = async () => {
    if (!target) return
    setMoving(true)
    try { await onMove(target, folderId) } finally { setMoving(false) }
  }

  return (
    <Dialog open={!!target} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Sposta “{target?.name}”</DialogTitle>
          <DialogDescription>Scegli la cartella di destinazione.</DialogDescription>
        </DialogHeader>

        <nav aria-label="Percorso destinazione" className="flex flex-wrap items-center gap-0.5 text-sm">
          <button
            type="button"
            onClick={() => setPath([])}
            className={cn('focus-ring flex items-center gap-1 rounded-md px-1.5 py-1 hover:bg-accent', path.length === 0 ? 'font-medium text-foreground' : 'text-muted-foreground')}
          >
            <Home className="h-3.5 w-3.5" /> Home
          </button>
          {path.map((c, i) => (
            <span key={c.id ?? i} className="flex min-w-0 items-center gap-0.5">
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/60" aria-hidden="true" />
              <button
                type="button"
                onClick={() => setPath(p => p.slice(0, i + 1))}
                className={cn('focus-ring max-w-[10rem] truncate rounded-md px-1.5 py-1 hover:bg-accent', i === path.length - 1 ? 'font-medium text-foreground' : 'text-muted-foreground')}
              >
                {c.name}
              </button>
            </span>
          ))}
        </nav>

        <div className="h-64 overflow-y-auto rounded-lg border">
          <QueryState
            query={query}
            skeleton="list"
            rows={4}
            className="border-0"
            empty={{ icon: FolderInput, title: 'Nessuna sottocartella', description: 'Puoi spostare qui l’elemento.', size: 'sm' }}
          >
            {(folders: Folder[]) => (
              <ul className="divide-y">
                {folders.map(f => {
                  const self = target?.kind === 'folder' && f.id === target.id
                  return (
                    <li key={f.id}>
                      <button
                        type="button"
                        disabled={self}
                        onClick={() => setPath(p => [...p, { id: f.id, name: f.name }])}
                        className="focus-ring flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <FolderGlyph />
                        <span className="min-w-0 flex-1 truncate">{f.name}</span>
                        <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </QueryState>
        </div>
        {insideSelf && <p className="text-caption text-destructive">Non puoi spostare una cartella dentro se stessa.</p>}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Annulla</Button>
          <Button onClick={submit} disabled={disabled} loading={moving}>
            Sposta qui
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
