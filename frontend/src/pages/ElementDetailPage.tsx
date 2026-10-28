import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ChevronDown, Download, FileQuestion, Link2, MoreHorizontal, Paperclip, Plus, Settings2, Trash2, Upload,
} from 'lucide-react'
import { elementsApi, tagsApi, workspacesApi, attachmentsApi, sprintApi } from '@/lib/api'
import type { Element, Attachment, Member, Tag, Sprint } from '@/types'
import { BlockEditor } from '@/components/editor/BlockEditor'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { Skeleton, SkeletonText } from '@/components/ui/skeleton'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { toast } from '@/components/ui/toast'
import {
  AvatarStack, BlockedBadge, Callout, EmptyState, PriorityIndicator, StatusBadge, StatusIcon, TypeIcon, TYPE_META, useConfirm,
} from '@/components/shared'
import { ElementBreadcrumb, type ElementCrumb } from '@/components/element/ElementBreadcrumb'
import { ElementProperties } from '@/components/element/ElementProperties'
import { SaveIndicator } from '@/components/element/SaveIndicator'
import { useElementAutosave } from '@/components/element/useElementAutosave'
import { CreateElementDialog } from '@/components/CreateElementDialog'
import { useWorkspaceStore } from '@/store/workspaceStore'
import { useElementDelete } from '@/lib/useElementDelete'
import { cn, formatBytes, formatDate, getErrorMessage } from '@/lib/utils'

const PROPS_OPEN_KEY = 'wt:element-props-open'

export default function ElementDetailPage() {
  const { wsId, elementId } = useParams<{ wsId: string; elementId: string }>()
  // key: cambiando elemento si smonta la vista precedente (che salva le bozze pendenti).
  return <ElementDetail key={elementId} wsId={wsId!} elementId={elementId!} />
}

function ElementDetail({ wsId, elementId }: { wsId: string; elementId: string }) {
  const query = useQuery<Element>({
    queryKey: ['element', wsId, elementId],
    queryFn: () => elementsApi.get(wsId, elementId),
    enabled: !!wsId && !!elementId,
  })

  if (query.isLoading) return <DetailSkeleton />
  // Con dati in cache un refetch fallito (isError + data) NON smonta l'editor: si perderebbero le bozze.
  if (!query.data) {
    const notFound = (query.error as any)?.response?.status === 404 || (!query.isError && !query.data)
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center p-4">
        {notFound ? (
          <EmptyState
            icon={FileQuestion}
            title="Elemento non trovato"
            description="Potrebbe essere stato eliminato o spostato in un altro workspace."
            action={<Button asChild variant="outline" size="sm"><Link to={`/workspace/${wsId}/kanban`}>Torna alla board</Link></Button>}
          />
        ) : (
          <Callout
            variant="destructive"
            title="Impossibile caricare l'elemento"
            className="w-full max-w-md"
            action={<Button size="sm" variant="outline" onClick={() => query.refetch()} loading={query.isFetching}>Riprova</Button>}
          >
            {getErrorMessage(query.error)}
          </Callout>
        )}
      </div>
    )
  }
  return <ElementDocument wsId={wsId} element={query.data} />
}

function DetailSkeleton() {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden" aria-busy="true" aria-label="Caricamento elemento">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b px-4 sm:px-6">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-4 w-40" />
      </div>
      <div className="flex min-h-0 flex-1">
        <div className="mx-auto w-full max-w-3xl space-y-6 px-4 py-8 sm:px-8 lg:py-12">
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-9 w-3/4" />
          <SkeletonText lines={6} />
        </div>
        <div className="hidden w-80 shrink-0 space-y-4 border-l p-5 lg:block">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3">
              <Skeleton className="h-3.5 w-20" />
              <Skeleton className="h-6 flex-1" />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function ElementDocument({ wsId, element }: { wsId: string; element: Element }) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const confirm = useConfirm()
  const workspace = useWorkspaceStore(s => s.current)
  const isGuest = workspace?.myRole === 'GUEST'
  const isAdmin = workspace?.myRole === 'ADMIN'
  // Il backend permette di modificare le epiche solo agli admin.
  const readOnly = isGuest || (element.type === 'EPICA' && !isAdmin)
  const { canDelete } = useElementDelete(wsId)

  const { data: allElements = [] } = useQuery<Element[]>({
    queryKey: ['elements', wsId],
    queryFn: () => elementsApi.list(wsId),
  })
  const { data: tags = [] } = useQuery<Tag[]>({ queryKey: ['tags', wsId], queryFn: () => tagsApi.list(wsId) })
  const { data: members = [] } = useQuery<Member[]>({ queryKey: ['members', wsId], queryFn: () => workspacesApi.getMembers(wsId) })
  const { data: sprints = [] } = useQuery<Sprint[]>({
    queryKey: ['sprints', wsId],
    queryFn: () => sprintApi.list(wsId),
    enabled: !!element.sprintId,
  })
  const attachmentsQuery = useQuery<Attachment[]>({
    queryKey: ['attachments', wsId, element.id],
    queryFn: () => attachmentsApi.list(wsId, element.id),
  })

  const save = useElementAutosave(wsId, element, readOnly)

  const byId = useMemo(() => new Map(allElements.map(e => [e.id, e])), [allElements])
  const parent = element.parentId ? byId.get(element.parentId) : undefined
  const children = useMemo(
    () => allElements.filter(e => e.parentId === element.id).sort((a, b) => a.position - b.position),
    [allElements, element.id]
  )
  const sprint = element.sprintId ? sprints.find(s => s.id === element.sprintId) : undefined
  const creatorName = members.find(m => m.userId === element.createdBy)?.displayName

  const crumbs = useMemo<ElementCrumb[]>(() => {
    const base = `/workspace/${wsId}`
    const chain: Element[] = []
    let p = element.parentId ? byId.get(element.parentId) : undefined
    while (p && chain.length < 4) {
      chain.unshift(p)
      p = p.parentId ? byId.get(p.parentId) : undefined
    }
    return [
      { label: workspace?.name ?? 'Workspace', href: `${base}/kanban` },
      ...chain.map(e => ({ label: e.title, type: e.type, href: `${base}/element/${e.id}` })),
      { label: save.title || element.title, type: element.type },
    ]
  }, [byId, element.parentId, element.title, element.type, save.title, workspace?.name, wsId])

  // Pannello proprietà su mobile: sezione comprimibile (stato ricordato).
  const [propsOpen, setPropsOpen] = useState(() => {
    try { return localStorage.getItem(PROPS_OPEN_KEY) === '1' } catch { return false }
  })
  const togglePropsOpen = () => {
    setPropsOpen(o => {
      try { localStorage.setItem(PROPS_OPEN_KEY, o ? '0' : '1') } catch { /* ignore */ }
      return !o
    })
  }

  // Titolo: textarea che cresce con il testo, Invio sposta il focus nel corpo.
  const titleRef = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    const el = titleRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [save.title])

  const [createChildOpen, setCreateChildOpen] = useState(false)
  const childType = element.type === 'EPICA' ? 'STORIA' : 'TASK'
  const canHaveChildren = element.type === 'EPICA' || element.type === 'STORIA'

  const handleDelete = async () => {
    const what = TYPE_META[element.type]?.label.toLowerCase() ?? 'elemento'
    const ok = await confirm({
      title: `Eliminare ${what}?`,
      description: `"${element.title}" verrà eliminato definitivamente. L'azione non è reversibile.`,
      confirmLabel: 'Elimina',
      destructive: true,
    })
    if (!ok) return
    try {
      await elementsApi.delete(wsId, element.id)
      // Elemento eliminato: niente PUT delle bozze pendenti (allo smontaggio darebbe 404).
      save.discard()
      queryClient.invalidateQueries({ queryKey: ['elements', wsId] })
      queryClient.invalidateQueries({ queryKey: ['my-tasks'] })
      toast('Elemento eliminato')
      navigate(-1)
    } catch (err) {
      toast(getErrorMessage(err, 'Impossibile eliminare'), 'destructive')
    }
  }

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href)
      toast('Link copiato')
    } catch {
      toast('Impossibile copiare il link', 'destructive')
    }
  }

  const properties = (
    <ElementProperties
      element={element}
      wsId={wsId}
      readOnly={readOnly}
      members={members}
      tags={tags}
      parent={parent}
      sprint={sprint}
      creatorName={creatorName}
      onPatch={save.patch}
    />
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {/* Barra superiore */}
      <div className="flex h-12 shrink-0 items-center gap-2 border-b px-2 sm:px-4">
        <ElementBreadcrumb items={crumbs} className="flex-1" />
        {!readOnly && <SaveIndicator status={save.status} error={save.error} onRetry={save.retry} />}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton label="Altre azioni" icon={<MoreHorizontal />} />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={copyLink}>
              <Link2 className="h-4 w-4" /> Copia link
            </DropdownMenuItem>
            {canDelete(element) && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem destructive onClick={handleDelete}>
                  <Trash2 className="h-4 w-4" /> Elimina
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* Documento */}
        <div className="min-w-0 flex-1 overflow-y-auto">
          <article className="mx-auto w-full max-w-3xl px-4 pb-16 pt-6 sm:px-8 lg:pt-12">
            {/* Tipo + badge */}
            <div className="mb-2 flex flex-wrap items-center gap-2 text-caption text-muted-foreground">
              <span className="inline-flex items-center gap-1.5 font-medium uppercase tracking-wide">
                <TypeIcon type={element.type} size="sm" labelled />
                {TYPE_META[element.type]?.label ?? element.type}
              </span>
              {element.blocked && <BlockedBadge size="sm" />}
              <PriorityIndicator priority={element.priority} variant="badge" size="sm" />
              {readOnly && <span className="rounded-full bg-muted px-1.5 text-2xs font-medium">Sola lettura</span>}
            </div>

            {/* Titolo */}
            {readOnly ? (
              <h1 className="mb-4 break-words text-display">{element.title}</h1>
            ) : (
              <textarea
                ref={titleRef}
                rows={1}
                value={save.title}
                onChange={e => save.setTitle(e.target.value.replace(/\n/g, ' '))}
                onFocus={save.onTitleFocus}
                onBlur={save.onTitleBlur}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    ;(document.querySelector('.ProseMirror') as HTMLElement | null)?.focus()
                  }
                }}
                aria-label="Titolo"
                placeholder="Senza titolo"
                className="-mx-2 mb-4 block w-[calc(100%+1rem)] resize-none overflow-hidden rounded-md bg-transparent px-2 py-1 text-display text-foreground outline-none transition-colors placeholder:text-muted-foreground/60 hover:bg-accent/50 focus-visible:bg-transparent focus-visible:ring-2 focus-visible:ring-ring/40"
              />
            )}

            {/* Proprietà su mobile/tablet: sezione comprimibile */}
            <section className="mb-6 rounded-lg border lg:hidden">
              <button
                type="button"
                onClick={togglePropsOpen}
                aria-expanded={propsOpen}
                className="focus-ring flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left"
              >
                <Settings2 className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="text-sm font-medium">Proprietà</span>
                {!propsOpen && (
                  <span className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
                    <StatusBadge status={element.status} size="sm" />
                    {element.assignees.length > 0 && <AvatarStack users={element.assignees} max={3} size="xs" />}
                    {element.endDate && <span className="truncate text-caption text-muted-foreground">{formatDate(element.endDate)}</span>}
                  </span>
                )}
                <ChevronDown className={cn('ml-auto h-4 w-4 shrink-0 text-muted-foreground transition-transform', propsOpen && 'rotate-180')} />
              </button>
              {propsOpen && <div className="border-t px-2 py-2">{properties}</div>}
            </section>

            {/* Corpo */}
            <BlockEditor
              content={save.body}
              onChange={save.setBody}
              onFocus={save.onBodyFocus}
              onBlur={save.onBodyBlur}
              readOnly={readOnly}
              placeholder={readOnly ? '' : 'Scrivi una descrizione, una checklist, note…'}
              toolbarClassName="sticky top-0 z-sticky -mx-1 px-1"
            />

            {/* Figli (storie dell'epica / task della storia) */}
            {canHaveChildren && (
              <section className="mt-10" aria-labelledby="children-heading">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <h2 id="children-heading" className="flex items-center gap-2 text-heading">
                    {element.type === 'EPICA' ? 'Storie' : 'Task'}
                    <span className="text-sm font-normal text-muted-foreground">{children.length}</span>
                  </h2>
                  {!isGuest && (element.type !== 'EPICA' || isAdmin) && (
                    <Button size="sm" variant="ghost" onClick={() => setCreateChildOpen(true)}>
                      <Plus className="h-4 w-4" /> {element.type === 'EPICA' ? 'Nuova storia' : 'Nuovo task'}
                    </Button>
                  )}
                </div>
                {children.length === 0 ? (
                  <p className="rounded-lg border border-dashed px-3 py-4 text-center text-sm text-muted-foreground">
                    {element.type === 'EPICA' ? 'Nessuna storia collegata.' : 'Nessun task collegato.'}
                  </p>
                ) : (
                  <ul className="divide-y rounded-lg border">
                    {children.map(c => (
                      <li key={c.id}>
                        <Link
                          to={`/workspace/${wsId}/element/${c.id}`}
                          className="focus-ring flex items-center gap-2.5 px-3 py-2 text-sm transition-colors first:rounded-t-lg last:rounded-b-lg hover:bg-accent"
                        >
                          <StatusIcon status={c.status} size="sm" />
                          <TypeIcon type={c.type} size="sm" />
                          <PriorityIndicator priority={c.priority} />
                          <span className={cn('min-w-0 flex-1 truncate', c.status === 'COMPLETATO' && 'text-muted-foreground line-through')}>
                            {c.title}
                          </span>
                          {c.blocked && <BlockedBadge size="sm" className="hidden sm:inline-flex" />}
                          {c.endDate && <span className="hidden text-caption text-muted-foreground sm:inline">{formatDate(c.endDate)}</span>}
                          <AvatarStack users={c.assignees} max={3} size="xs" />
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )}

            <Attachments wsId={wsId} elementId={element.id} readOnly={isGuest} query={attachmentsQuery} />
          </article>
        </div>

        {/* Proprietà su desktop: colonna destra */}
        <aside className="hidden w-80 shrink-0 overflow-y-auto border-l bg-surface-2/40 px-3 py-5 lg:block" aria-label="Proprietà">
          <h2 className="mb-2 px-1 text-caption font-medium uppercase tracking-wide text-muted-foreground">Proprietà</h2>
          {properties}
        </aside>
      </div>

      {canHaveChildren && (
        <CreateElementDialog
          open={createChildOpen}
          onClose={() => setCreateChildOpen(false)}
          workspaceId={wsId}
          defaultType={childType}
          defaultParentId={element.id}
        />
      )}
    </div>
  )
}

function Attachments({
  wsId, elementId, readOnly, query,
}: {
  wsId: string
  elementId: string
  readOnly: boolean
  query: ReturnType<typeof useQuery<Attachment[]>>
}) {
  const queryClient = useQueryClient()
  const confirm = useConfirm()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const attachments = query.data ?? []

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      await attachmentsApi.upload(wsId, elementId, file)
      queryClient.invalidateQueries({ queryKey: ['attachments', wsId, elementId] })
      toast('File caricato', 'success')
    } catch (err) {
      toast(getErrorMessage(err, 'Errore nel caricamento'), 'destructive')
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const handleDownload = async (att: Attachment) => {
    try {
      await attachmentsApi.download(wsId, elementId, att.id, att.filename)
    } catch {
      toast('Errore nel download', 'destructive')
    }
  }

  const handleDelete = async (att: Attachment) => {
    const ok = await confirm({
      title: 'Eliminare l\'allegato?',
      description: `"${att.filename}" verrà eliminato definitivamente.`,
      confirmLabel: 'Elimina',
      destructive: true,
    })
    if (!ok) return
    try {
      await attachmentsApi.delete(wsId, elementId, att.id)
      queryClient.invalidateQueries({ queryKey: ['attachments', wsId, elementId] })
      toast('Allegato eliminato')
    } catch (err) {
      toast(getErrorMessage(err), 'destructive')
    }
  }

  return (
    <section className="mt-10" aria-labelledby="attachments-heading">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 id="attachments-heading" className="flex items-center gap-2 text-heading">
          Allegati
          {attachments.length > 0 && <span className="text-sm font-normal text-muted-foreground">{attachments.length}</span>}
        </h2>
        {!readOnly && (
          <>
            <input ref={fileInputRef} type="file" className="hidden" onChange={handleUpload} />
            <Button size="sm" variant="ghost" loading={uploading} onClick={() => fileInputRef.current?.click()}>
              {!uploading && <Upload className="h-4 w-4" />} {uploading ? 'Caricamento…' : 'Carica file'}
            </Button>
          </>
        )}
      </div>
      {query.isLoading ? (
        <Skeleton className="h-12 w-full" />
      ) : query.isError ? (
        <Callout
          variant="destructive"
          title="Impossibile caricare gli allegati"
          action={<Button size="sm" variant="outline" onClick={() => query.refetch()}>Riprova</Button>}
        />
      ) : attachments.length === 0 ? (
        <p className="rounded-lg border border-dashed px-3 py-4 text-center text-sm text-muted-foreground">Nessun allegato.</p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {attachments.map(att => (
            <li key={att.id} className="flex items-center gap-3 px-3 py-2">
              <Paperclip className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm">{att.filename}</p>
                <p className="text-caption text-muted-foreground">{formatBytes(att.sizeBytes)} · {formatDate(att.createdAt)}</p>
              </div>
              <IconButton label={`Scarica ${att.filename}`} icon={<Download />} onClick={() => handleDownload(att)} />
              {!readOnly && (
                <IconButton
                  label={`Elimina ${att.filename}`}
                  icon={<Trash2 />}
                  className="hover:text-destructive"
                  onClick={() => handleDelete(att)}
                />
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
