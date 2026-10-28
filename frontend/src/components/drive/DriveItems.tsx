import * as React from 'react'
import {
  Copy, Download, FolderInput, GripVertical, Lock, LockOpen, MoreHorizontal, Pencil, Trash2, FileArchive,
} from 'lucide-react'
import type { DriveFile, Folder } from '@/types'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { IconButton } from '@/components/ui/icon-button'
import { SimpleTooltip } from '@/components/ui/tooltip'
import { UserAvatar } from '@/components/shared'
import { cn, formatBytes, formatDate } from '@/lib/utils'
import { FileIcon, FolderGlyph, fileMeta } from './file-icon'
import type { MoveTarget } from './MoveDialog'

export type DriveView = 'list' | 'grid'
export interface DragItem { kind: 'file' | 'folder'; id: string; name: string }

/** Azioni stabili (identità costante) passate alle righe memoizzate. */
export interface DriveActions {
  openFolder: (f: Folder) => void
  openFile: (f: DriveFile) => void
  downloadFile: (f: DriveFile) => void
  downloadFolder: (f: Folder) => void
  rename: (kind: 'file' | 'folder', id: string, name: string) => void
  move: (t: MoveTarget) => void
  copyFile: (f: DriveFile) => void
  toggleFilePermission: (f: DriveFile) => void
  toggleFolderPermission: (f: Folder) => void
  deleteFile: (f: DriveFile) => void
  deleteFolder: (f: Folder) => void
  dragStart: (e: React.DragEvent, item: DragItem) => void
  dragEnd: () => void
  folderDragOver: (e: React.DragEvent, f: Folder) => void
  dragLeave: () => void
  folderDrop: (e: React.DragEvent, f: Folder) => void
}

/** Colonne della vista elenco: su mobile solo nome + azioni, poi data/dimensione (sm) e proprietario (md). */
export const LIST_COLS =
  'grid grid-cols-[minmax(0,1fr)_auto] sm:grid-cols-[minmax(0,1fr)_6rem_7rem_4.5rem] md:grid-cols-[minmax(0,1fr)_9rem_6rem_7rem_4.5rem]'

const rowBase =
  'group relative rounded-md transition-colors hover:bg-accent focus-within:bg-accent/60'

function ReadOnlyBadge({ folder }: { folder?: boolean }) {
  return (
    <SimpleTooltip
      content={folder
        ? 'Sola lettura: la cartella e il suo contenuto sono modificabili solo da proprietario o admin'
        : 'Sola lettura: solo il proprietario o un admin può modificarlo'}
    >
      <span className="relative inline-flex shrink-0 items-center gap-0.5 rounded-full bg-muted px-1.5 text-2xs font-medium text-muted-foreground">
        <Lock className="h-3 w-3" aria-hidden="true" /> Sola lettura
      </span>
    </SimpleTooltip>
  )
}

function LockBadge({ name }: { name: string }) {
  return (
    <SimpleTooltip content={`In modifica da ${name}`}>
      <span className="relative inline-flex shrink-0 items-center gap-1 rounded-full bg-warning-subtle px-1.5 text-2xs font-medium text-warning">
        <Lock className="h-3 w-3" aria-hidden="true" />
        <span className="max-w-[8rem] truncate">{name}</span>
      </span>
    </SimpleTooltip>
  )
}

function OwnerCell({ name, avatar }: { name: string; avatar?: string }) {
  return (
    <span className="hidden min-w-0 items-center gap-1.5 text-sm text-muted-foreground md:flex">
      <UserAvatar name={name} avatar={avatar} size="xs" />
      <span className="truncate">{name}</span>
    </span>
  )
}

function MenuTrigger({ name }: { name: string }) {
  return (
    <DropdownMenuTrigger asChild>
      <IconButton label={`Azioni per ${name}`} icon={<MoreHorizontal />} noTooltip />
    </DropdownMenuTrigger>
  )
}

// ---------------------------------------------------------------- Cartella

export interface FolderItemProps {
  folder: Folder
  view: DriveView
  ownerName: string
  ownerAvatar?: string
  canMove: boolean
  canSetPermission: boolean
  dragging: boolean
  dropActive: boolean
  selected: boolean
  actions: DriveActions
}

export const FolderItem = React.memo(function FolderItem({
  folder: f, view, ownerName, ownerAvatar, canMove, canSetPermission, dragging, dropActive, selected, actions: a,
}: FolderItemProps) {
  const readOnly = f.editableByAll === false
  const dnd = {
    draggable: canMove,
    onDragStart: (e: React.DragEvent) => a.dragStart(e, { kind: 'folder', id: f.id, name: f.name }),
    onDragEnd: a.dragEnd,
    onDragOver: (e: React.DragEvent) => a.folderDragOver(e, f),
    onDragLeave: a.dragLeave,
    onDrop: (e: React.DragEvent) => a.folderDrop(e, f),
  }
  const state = cn(
    canMove && 'cursor-grab active:cursor-grabbing',
    dragging && 'opacity-50',
    selected && 'bg-primary/10 hover:bg-primary/10',
    dropActive && 'bg-primary/10 ring-2 ring-inset ring-primary',
  )
  const menu = (
    <DropdownMenu>
      <MenuTrigger name={f.name} />
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuItem onClick={() => a.openFolder(f)}>
          <FolderGlyph /> Apri
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => a.downloadFolder(f)}>
          <FileArchive className="h-4 w-4" /> Scarica come ZIP
        </DropdownMenuItem>
        {canMove && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => a.rename('folder', f.id, f.name)}>
              <Pencil className="h-4 w-4" /> Rinomina
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => a.move({ kind: 'folder', id: f.id, name: f.name, currentFolderId: f.parentId })}>
              <FolderInput className="h-4 w-4" /> Sposta in…
            </DropdownMenuItem>
          </>
        )}
        {canSetPermission && (
          <DropdownMenuItem onClick={() => a.toggleFolderPermission(f)}>
            {readOnly
              ? <><LockOpen className="h-4 w-4" /> Rendi modificabile (con contenuti)</>
              : <><Lock className="h-4 w-4" /> Sola lettura (con contenuti)</>}
          </DropdownMenuItem>
        )}
        {canMove && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem destructive onClick={() => a.deleteFolder(f)}>
              <Trash2 className="h-4 w-4" /> Elimina
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )

  if (view === 'grid') {
    return (
      <div {...dnd} className={cn(rowBase, 'flex flex-col gap-2 border bg-card p-3', state)}>
        <div className="flex items-start justify-between gap-2">
          <span className="flex h-10 w-10 items-center justify-center rounded-md bg-primary/10">
            <FolderGlyph className="h-5 w-5" />
          </span>
          <div className="relative -mr-1 -mt-1">{menu}</div>
        </div>
        <button
          type="button"
          onClick={() => a.openFolder(f)}
          className="min-w-0 text-left text-sm font-medium outline-none after:absolute after:inset-0 after:rounded-md focus-visible:after:ring-2 focus-visible:after:ring-ring"
        >
          <span className="block truncate">{f.name}</span>
        </button>
        <div className="flex min-h-5 items-center gap-1.5 text-caption text-muted-foreground">
          <span className="truncate">Cartella · {formatDate(f.createdAt)}</span>
          {readOnly && <ReadOnlyBadge folder />}
        </div>
      </div>
    )
  }

  return (
    <div {...dnd} className={cn(rowBase, LIST_COLS, 'items-center gap-3 px-2 py-1.5', state)}>
      <div className="flex min-w-0 items-center gap-2.5">
        {canMove ? (
          <GripVertical className="-ml-1 h-3.5 w-3.5 shrink-0 text-muted-foreground/40 opacity-0 group-hover:opacity-100 max-sm:hidden" aria-hidden="true" />
        ) : (
          <span className="-ml-1 w-3.5 shrink-0 max-sm:hidden" />
        )}
        <FolderGlyph className="h-5 w-5" />
        <button
          type="button"
          onClick={() => a.openFolder(f)}
          className="min-w-0 truncate text-left text-sm font-medium outline-none after:absolute after:inset-0 after:rounded-md focus-visible:after:ring-2 focus-visible:after:ring-ring"
        >
          {f.name}
        </button>
        {readOnly && <ReadOnlyBadge folder />}
      </div>
      <OwnerCell name={ownerName} avatar={ownerAvatar} />
      <span className="hidden text-sm text-muted-foreground sm:block">—</span>
      <span className="hidden text-sm text-muted-foreground sm:block">{formatDate(f.createdAt)}</span>
      <div className="relative flex justify-end">{menu}</div>
    </div>
  )
})

// ---------------------------------------------------------------- File

export interface FileItemProps {
  file: DriveFile
  view: DriveView
  ownerName: string
  ownerAvatar?: string
  lockedByName?: string
  canEdit: boolean
  canMove: boolean
  canSetPermission: boolean
  dragging: boolean
  selected: boolean
  actions: DriveActions
}

export const FileItem = React.memo(function FileItem({
  file: f, view, ownerName, ownerAvatar, lockedByName, canEdit, canMove, canSetPermission, dragging, selected, actions: a,
}: FileItemProps) {
  const readOnly = f.editableByAll === false
  const meta = fileMeta(f.filename, f.contentType)
  const dnd = {
    draggable: canMove,
    onDragStart: (e: React.DragEvent) => a.dragStart(e, { kind: 'file', id: f.id, name: f.filename }),
    onDragEnd: a.dragEnd,
  }
  const state = cn(
    canMove && 'cursor-grab active:cursor-grabbing',
    dragging && 'opacity-50',
    selected && 'bg-primary/10 hover:bg-primary/10',
  )
  const menu = (
    <DropdownMenu>
      <MenuTrigger name={f.filename} />
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuItem onClick={() => a.openFile(f)}>
          <FileIcon filename={f.filename} contentType={f.contentType} /> Apri
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => a.downloadFile(f)}>
          <Download className="h-4 w-4" /> Scarica
        </DropdownMenuItem>
        {canEdit && (
          <DropdownMenuItem onClick={() => a.copyFile(f)}>
            <Copy className="h-4 w-4" /> Crea una copia
          </DropdownMenuItem>
        )}
        {canMove && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => a.rename('file', f.id, f.filename)}>
              <Pencil className="h-4 w-4" /> Rinomina
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => a.move({ kind: 'file', id: f.id, name: f.filename, currentFolderId: f.folderId })}>
              <FolderInput className="h-4 w-4" /> Sposta in…
            </DropdownMenuItem>
          </>
        )}
        {canSetPermission && (
          <DropdownMenuItem onClick={() => a.toggleFilePermission(f)}>
            {readOnly ? <><LockOpen className="h-4 w-4" /> Rendi modificabile</> : <><Lock className="h-4 w-4" /> Imposta sola lettura</>}
          </DropdownMenuItem>
        )}
        {canMove && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem destructive onClick={() => a.deleteFile(f)}>
              <Trash2 className="h-4 w-4" /> Elimina
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )

  const nameButton = (cls?: string) => (
    <button
      type="button"
      onClick={() => a.openFile(f)}
      title={f.filename}
      className={cn('min-w-0 truncate text-left text-sm outline-none after:absolute after:inset-0 after:rounded-md focus-visible:after:ring-2 focus-visible:after:ring-ring', cls)}
    >
      {f.filename}
    </button>
  )

  if (view === 'grid') {
    const Icon = meta.icon
    return (
      <div {...dnd} className={cn(rowBase, 'flex flex-col gap-2 border bg-card p-3', state)}>
        <div className="flex items-start justify-between gap-2">
          <span className="flex h-10 w-10 items-center justify-center rounded-md bg-surface-2">
            <Icon className={cn('h-5 w-5', meta.className)} aria-hidden="true" />
          </span>
          <div className="relative -mr-1 -mt-1">{menu}</div>
        </div>
        {nameButton('font-medium')}
        <div className="flex min-h-5 min-w-0 items-center gap-1.5 text-caption text-muted-foreground">
          <span className="truncate">{formatBytes(f.sizeBytes)} · {formatDate(f.createdAt)}</span>
          {lockedByName && <LockBadge name={lockedByName} />}
          {!lockedByName && readOnly && <ReadOnlyBadge />}
        </div>
      </div>
    )
  }

  return (
    <div {...dnd} className={cn(rowBase, LIST_COLS, 'items-center gap-3 px-2 py-1.5', state)}>
      <div className="flex min-w-0 items-center gap-2.5">
        {canMove ? (
          <GripVertical className="-ml-1 h-3.5 w-3.5 shrink-0 text-muted-foreground/40 opacity-0 group-hover:opacity-100 max-sm:hidden" aria-hidden="true" />
        ) : (
          <span className="-ml-1 w-3.5 shrink-0 max-sm:hidden" />
        )}
        <FileIcon filename={f.filename} contentType={f.contentType} className="h-5 w-5" />
        <div className="flex min-w-0 flex-1 flex-col sm:flex-row sm:items-center sm:gap-2">
          {nameButton()}
          {/* Su mobile le colonne sono nascoste: meta sotto il nome */}
          <span className="truncate text-caption text-muted-foreground sm:hidden">
            {formatBytes(f.sizeBytes)} · {formatDate(f.createdAt)}
          </span>
        </div>
        {lockedByName && <LockBadge name={lockedByName} />}
        {!lockedByName && readOnly && <ReadOnlyBadge />}
      </div>
      <OwnerCell name={ownerName} avatar={ownerAvatar} />
      <span className="hidden text-sm tabular-nums text-muted-foreground sm:block">{formatBytes(f.sizeBytes)}</span>
      <span className="hidden text-sm text-muted-foreground sm:block">{formatDate(f.createdAt)}</span>
      <div className="relative flex items-center justify-end">
        <IconButton
          label={`Scarica ${f.filename}`}
          icon={<Download />}
          className="hidden opacity-0 focus-visible:opacity-100 group-hover:opacity-100 sm:inline-flex"
          onClick={() => a.downloadFile(f)}
        />
        {menu}
      </div>
    </div>
  )
})
