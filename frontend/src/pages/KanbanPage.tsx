import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { subscribeWorkspace } from '@/lib/websocket'
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd'
import { Plus, ChevronDown, ChevronRight, Search, X, Filter, Trash2 } from 'lucide-react'
import { elementsApi, tagsApi, workspacesApi } from '@/lib/api'
import { useElementDelete } from '@/lib/useElementDelete'
import { Element, ElementStatus, Tag, Member, Workspace } from '@/types'
import { cn, STATUS_LABELS, TYPE_ICONS, TYPE_LABELS, formatDate } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { UserAvatar } from '@/components/UserAvatar'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useWorkspaceStore } from '@/store/workspaceStore'
import { CreateElementDialog } from '@/components/CreateElementDialog'

const COLUMNS: ElementStatus[] = ['DA_FARE', 'IN_CORSO', 'COMPLETATO']

const COLUMN_STYLE: Record<ElementStatus, string> = {
  DA_FARE: 'border-t-slate-300',
  IN_CORSO: 'border-t-blue-400',
  COMPLETATO: 'border-t-green-500',
  ARCHIVIATO: 'border-t-muted',
}

interface CardConfig { tags: boolean; assignees: boolean; dueDate: boolean }

function TaskCard({ task, index, cardConfig }: { task: Element; index: number; cardConfig: CardConfig }) {
  const wsId = useParams().wsId!
  const { canDelete, remove } = useElementDelete(wsId)
  const showTags = cardConfig.tags && task.tags.length > 0
  const showAssignees = cardConfig.assignees && task.assignees.length > 0
  const showDue = cardConfig.dueDate && !!task.endDate
  return (
    <Draggable draggableId={task.id} index={index}>
      {(provided, snapshot) => {
        const { style, ...draggableProps } = provided.draggableProps
        return (
        <div
          ref={provided.innerRef}
          {...draggableProps}
          {...provided.dragHandleProps}
          style={style as React.CSSProperties}
          className={cn(
            'group bg-card border rounded-xl p-3 space-y-2 cursor-grab active:cursor-grabbing transition-shadow',
            snapshot.isDragging && 'shadow-lg ring-1 ring-ring',
            // I task completati sono attenuati: restano consultabili ma non rubano l'attenzione.
            task.status === 'COMPLETATO' && !snapshot.isDragging && 'opacity-65 hover:opacity-100'
          )}
        >
          <div className="flex items-start gap-1.5">
            <a
              href={`/workspace/${wsId}/element/${task.id}`}
              onClick={e => e.stopPropagation()}
              className="flex-1 text-sm font-medium leading-snug hover:text-primary transition-colors line-clamp-2"
            >
              {task.title}
            </a>
            {canDelete(task) && (
              <button
                onClick={e => { e.stopPropagation(); e.preventDefault(); remove(task) }}
                className="shrink-0 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition"
                title="Elimina"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {/* Tags */}
          {showTags && (
            <div className="flex flex-wrap gap-1">
              {task.tags.map(tag => (
                <span
                  key={tag.id}
                  className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium"
                  style={{ backgroundColor: tag.color + '22', color: tag.color }}
                >
                  {tag.name}
                </span>
              ))}
            </div>
          )}

          {/* Footer */}
          {(showDue || showAssignees) && (
            <div className="flex items-center justify-between">
              {showDue && (
                <span className="text-xs text-muted-foreground">{formatDate(task.endDate)}</span>
              )}
              {showAssignees && (
                <div className="flex -space-x-1 ml-auto">
                  {task.assignees.slice(0, 3).map(u => (
                    <UserAvatar key={u.id} name={u.displayName} avatar={u.avatar} className="h-5 w-5 ring-1 ring-background" fallbackClassName="text-[9px]" />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
        )
      }}
    </Draggable>
  )
}

function SwimLane({
  story,
  epic,
  tasks,
  collapsed,
  onToggle,
  cardConfig,
}: {
  story: Element
  epic?: Element
  tasks: Element[]
  collapsed: boolean
  onToggle: () => void
  cardConfig: CardConfig
}) {
  const wsId = useParams().wsId!
  const [createOpen, setCreateOpen] = useState(false)

  return (
    <div className="mb-4">
      {/* Lane header */}
      <div
        className="flex items-center gap-2 py-2 px-3 cursor-pointer group select-none"
        onClick={onToggle}
      >
        <button className="shrink-0 text-muted-foreground">
          {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
        {epic && (
          <a
            href={`/workspace/${wsId}/element/${epic.id}`}
            onClick={e => e.stopPropagation()}
            className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground hover:text-primary transition-colors max-w-[40%]"
            title={`Epica: ${epic.title}`}
          >
            <span>{TYPE_ICONS['EPICA']}</span>
            <span className="truncate">{epic.title}</span>
          </a>
        )}
        <span className="text-xs">{TYPE_ICONS['STORIA']}</span>
        <span className={cn('text-sm font-medium', story.status === 'COMPLETATO' && 'text-muted-foreground line-through')}>{story.title}</span>
        <span className="text-xs text-muted-foreground ml-1">({tasks.length})</span>
        {story.status === 'COMPLETATO' && (
          <span className="inline-flex items-center gap-1 rounded-full bg-green-500/10 text-green-600 px-2 py-0.5 text-[11px] font-medium">
            ✓ Conclusa
          </span>
        )}
        {!collapsed && (
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto h-6 px-2 text-xs opacity-0 group-hover:opacity-100"
            onClick={e => { e.stopPropagation(); setCreateOpen(true) }}
          >
            <Plus className="h-3 w-3 mr-1" /> Task
          </Button>
        )}
      </div>

      {/* Columns */}
      {!collapsed && (
        <div className="grid grid-cols-3 gap-3 px-3">
          {COLUMNS.map(col => {
            const colTasks = tasks.filter(t => t.status === col)
            return (
              <Droppable key={col} droppableId={`${story.id}::${col}`}>
                {(provided, snapshot) => (
                  <div
                    ref={provided.innerRef}
                    {...provided.droppableProps}
                    className={cn(
                      'min-h-[80px] rounded-xl border border-t-2 bg-muted/30 p-2 space-y-2 transition-colors',
                      COLUMN_STYLE[col],
                      snapshot.isDraggingOver && 'bg-accent/40'
                    )}
                  >
                    {colTasks.map((task, i) => (
                      <TaskCard key={task.id} task={task} index={i} cardConfig={cardConfig} />
                    ))}
                    {provided.placeholder}
                  </div>
                )}
              </Droppable>
            )
          })}
        </div>
      )}

      <CreateElementDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        workspaceId={wsId}
        defaultType="TASK"
        defaultParentId={story.id}
      />
    </div>
  )
}

// Intestazione di una sezione Epica: raggruppa le storie di un'epica, con avanzamento e collasso.
function EpicHeader({ epic, storyCount, done, total, collapsed, onToggle }: {
  epic: Element
  storyCount: number
  done: number
  total: number
  collapsed: boolean
  onToggle: () => void
}) {
  const wsId = useParams().wsId!
  const pct = total > 0 ? Math.round((done / total) * 100) : 0
  const complete = epic.status === 'COMPLETATO' || (total > 0 && done === total)
  return (
    <div
      className="flex items-center gap-2 py-2 px-3 rounded-lg bg-muted/60 hover:bg-muted cursor-pointer select-none border"
      onClick={onToggle}
    >
      <button className="shrink-0 text-muted-foreground">
        {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
      </button>
      <span className="text-sm">{TYPE_ICONS['EPICA']}</span>
      <a
        href={`/workspace/${wsId}/element/${epic.id}`}
        onClick={e => e.stopPropagation()}
        className={cn('text-sm font-semibold hover:text-primary transition-colors truncate max-w-[40%]',
          complete && 'text-muted-foreground line-through')}
        title={epic.title}
      >
        {epic.title}
      </a>
      <span className="text-xs text-muted-foreground">{storyCount} stor{storyCount === 1 ? 'ia' : 'ie'}</span>
      {/* Avanzamento task dell'epica */}
      {total > 0 && (
        <div className="flex items-center gap-2 ml-auto">
          <div className="h-1.5 w-24 rounded-full bg-muted overflow-hidden">
            <div className={cn('h-full rounded-full', complete ? 'bg-green-500' : 'bg-primary')} style={{ width: `${pct}%` }} />
          </div>
          <span className="text-xs text-muted-foreground tabular-nums">{done}/{total}</span>
        </div>
      )}
      {complete && (
        <span className="inline-flex items-center gap-1 rounded-full bg-green-500/10 text-green-600 px-2 py-0.5 text-[11px] font-medium">
          ✓ Conclusa
        </span>
      )}
    </div>
  )
}

export default function KanbanPage() {
  const { wsId } = useParams<{ wsId: string }>()
  const queryClient = useQueryClient()
  const workspace = useWorkspaceStore(s => s.current)
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [collapsedEpics, setCollapsedEpics] = useState<Record<string, boolean>>({})
  const [createOpen, setCreateOpen] = useState(false)

  // Filtri
  const [search, setSearch] = useState('')
  const [assigneeFilter, setAssigneeFilter] = useState<string[]>([])
  const [tagFilter, setTagFilter] = useState<string[]>([])

  const { data: elements = [] } = useQuery<Element[]>({
    queryKey: ['elements', wsId],
    queryFn: () => elementsApi.list(wsId!),
    enabled: !!wsId,
  })

  // Aggiornamento in tempo reale: quando un elemento viene creato/aggiornato/eliminato
  // (anche da API esterna o dall'assistente), ricarichiamo gli elementi senza che l'utente
  // debba ricaricare la pagina, così la Kanban si riordina da sola.
  useEffect(() => {
    if (!wsId) return
    return subscribeWorkspace(wsId, ev => {
      if (ev.type.startsWith('ELEMENT_')) {
        queryClient.invalidateQueries({ queryKey: ['elements', wsId] })
        queryClient.invalidateQueries({ queryKey: ['my-tasks'] })
      }
    })
  }, [wsId, queryClient])
  const { data: tags = [] } = useQuery<Tag[]>({
    queryKey: ['tags', wsId],
    queryFn: () => tagsApi.list(wsId!),
    enabled: !!wsId,
  })
  const { data: members = [] } = useQuery<Member[]>({
    queryKey: ['members', wsId],
    queryFn: () => workspacesApi.getMembers(wsId!),
    enabled: !!wsId,
  })
  // Impostazioni card: lette dalla query workspaces (si aggiornano quando l'admin le cambia).
  const { data: workspaces = [] } = useQuery<Workspace[]>({
    queryKey: ['workspaces'],
    queryFn: workspacesApi.list,
  })
  const currentWs = workspaces.find(w => w.id === wsId)
  const cardConfig = {
    tags: currentWs?.cardShowTags ?? true,
    assignees: currentWs?.cardShowAssignees ?? true,
    dueDate: currentWs?.cardShowDueDate ?? true,
  }

  // Le storie concluse vanno in fondo (e collassate di default): il focus è sulle cose da fare.
  const stories = elements
    .filter(e => e.type === 'STORIA')
    .sort((a, b) => (a.status === 'COMPLETATO' ? 1 : 0) - (b.status === 'COMPLETATO' ? 1 : 0))
  const allTasks = elements.filter(e => e.type === 'TASK')
  const epicById = new Map(elements.filter(e => e.type === 'EPICA').map(e => [e.id, e]))

  // Avanzamento di un'epica: task completati / totali sotto le sue storie (esclusi gli archiviati).
  const epicProgress = (epicId: string) => {
    const storyIds = new Set(stories.filter(s => s.parentId === epicId).map(s => s.id))
    const ts = allTasks.filter(t => t.parentId && storyIds.has(t.parentId) && t.status !== 'ARCHIVIATO')
    return { done: ts.filter(t => t.status === 'COMPLETATO').length, total: ts.length }
  }

  // Raggruppa le storie per epica → sottodivisione chiara Epica ▸ Storia ▸ Task. Le epiche concluse
  // vanno in fondo; le storie senza epica finiscono in un gruppo "Senza epica".
  const epicGroups: { epic: Element | null; epicStories: Element[] }[] = [
    ...elements
      .filter(e => e.type === 'EPICA')
      .sort((a, b) => (a.status === 'COMPLETATO' ? 1 : 0) - (b.status === 'COMPLETATO' ? 1 : 0))
      .map(epic => ({ epic, epicStories: stories.filter(s => s.parentId === epic.id) }))
      .filter(g => g.epicStories.length > 0),
  ]
  const orphanStories = stories.filter(s => !s.parentId || !epicById.has(s.parentId))
  if (orphanStories.length > 0) epicGroups.push({ epic: null, epicStories: orphanStories })

  const hasFilters = search.trim() !== '' || assigneeFilter.length > 0 || tagFilter.length > 0
  const tasks = allTasks.filter(t => {
    if (search.trim() && !t.title.toLowerCase().includes(search.trim().toLowerCase())) return false
    if (assigneeFilter.length > 0 && !t.assignees.some(a => assigneeFilter.includes(a.id))) return false
    if (tagFilter.length > 0 && !t.tags.some(tg => tagFilter.includes(tg.id))) return false
    return true
  })

  const toggle = (arr: string[], id: string, set: (v: string[]) => void) =>
    set(arr.includes(id) ? arr.filter(x => x !== id) : [...arr, id])

  const clearFilters = () => { setSearch(''); setAssigneeFilter([]); setTagFilter([]) }

  // --- Chiusura automatica al 100% (solo admin) ---
  const isAdmin = workspace?.myRole === 'ADMIN'
  const [pendingClose, setPendingClose] = useState<Element | null>(null)
  const [closing, setClosing] = useState(false)

  // Una storia è "conclusa" se ha task e sono tutti completati.
  const storyComplete = (storyId: string, list: Element[]) => {
    const ts = list.filter(e => e.type === 'TASK' && e.parentId === storyId)
    return ts.length > 0 && ts.every(t => t.status === 'COMPLETATO')
  }
  // Un'epica è "conclusa" se tutti i task sotto le sue storie sono completati.
  const epicComplete = (epicId: string, list: Element[]) => {
    const storyIds = list.filter(e => e.type === 'STORIA' && e.parentId === epicId).map(s => s.id)
    const ts = list.filter(e => e.type === 'TASK' && e.parentId && storyIds.includes(e.parentId))
    return ts.length > 0 && ts.every(t => t.status === 'COMPLETATO')
  }

  const confirmClose = async () => {
    if (!pendingClose || !wsId) return
    setClosing(true)
    const el = pendingClose
    try {
      await elementsApi.update(wsId, el.id, { ...el, status: 'COMPLETATO' })
      queryClient.invalidateQueries({ queryKey: ['elements', wsId] })
      queryClient.invalidateQueries({ queryKey: ['my-tasks'] })
      // Dopo aver chiuso una storia, se anche l'epica è completa, proponi di chiuderla.
      const list = queryClient.getQueryData<Element[]>(['elements', wsId]) ?? elements
      const updated = list.map(e => e.id === el.id ? { ...e, status: 'COMPLETATO' as ElementStatus } : e)
      let next: Element | null = null
      if (el.type === 'STORIA' && el.parentId) {
        const epic = updated.find(e => e.id === el.parentId && e.type === 'EPICA')
        if (epic && epic.status !== 'COMPLETATO' && epicComplete(epic.id, updated)) next = epic
      }
      setPendingClose(next)
    } catch {
      setPendingClose(null)
    } finally {
      setClosing(false)
    }
  }

  const onDragEnd = async (result: DropResult) => {
    if (!result.destination || !wsId) return
    const taskId = result.draggableId
    const [, newStatus] = result.destination.droppableId.split('::') as [string, ElementStatus]
    const task = tasks.find(t => t.id === taskId)
    if (!task || task.status === newStatus) return

    // Optimistic update
    const updatedList = elements.map(e => e.id === taskId ? { ...e, status: newStatus } : e)
    queryClient.setQueryData<Element[]>(['elements', wsId], updatedList)

    try {
      await elementsApi.update(wsId, taskId, { ...task, status: newStatus })
      queryClient.invalidateQueries({ queryKey: ['my-tasks'] })
      // Se spostando il task la storia si completa, proponi all'admin di chiuderla.
      if (isAdmin && newStatus === 'COMPLETATO' && task.parentId) {
        const story = updatedList.find(e => e.id === task.parentId && e.type === 'STORIA')
        if (story && story.status !== 'COMPLETATO' && storyComplete(story.id, updatedList)) {
          setPendingClose(story)
        }
      }
    } catch {
      queryClient.invalidateQueries({ queryKey: ['elements', wsId] })
    }
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b shrink-0">
        <div>
          <h1 className="text-lg font-semibold">Kanban</h1>
          <p className="text-xs text-muted-foreground">{workspace?.name}</p>
        </div>
        {workspace?.myRole !== 'GUEST' && (
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4 mr-1" /> Nuovo task
          </Button>
        )}
      </div>

      {/* Filter bar */}
      <div className="flex items-center gap-2 px-6 py-2.5 border-b shrink-0 flex-wrap">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Cerca task..."
            className="h-8 w-56 pl-8 text-sm"
          />
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className={cn('h-8', assigneeFilter.length && 'border-primary text-primary')}>
              <Filter className="h-3.5 w-3.5 mr-1.5" /> Assegnatari
              {assigneeFilter.length > 0 && <span className="ml-1 text-xs">({assigneeFilter.length})</span>}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-52">
            <DropdownMenuLabel>Filtra per assegnatario</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {members.length === 0 && <div className="px-2 py-1 text-xs text-muted-foreground">Nessun membro</div>}
            {members.map(m => (
              <DropdownMenuItem key={m.userId} onClick={() => toggle(assigneeFilter, m.userId, setAssigneeFilter)} onSelect={e => e.preventDefault()}>
                <UserAvatar name={m.displayName} avatar={m.avatar} className="h-4 w-4" fallbackClassName="text-[8px]" />
                <span className="truncate flex-1">{m.displayName}</span>
                {assigneeFilter.includes(m.userId) && <span className="text-primary text-xs">✓</span>}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className={cn('h-8', tagFilter.length && 'border-primary text-primary')}>
              <Filter className="h-3.5 w-3.5 mr-1.5" /> Tag
              {tagFilter.length > 0 && <span className="ml-1 text-xs">({tagFilter.length})</span>}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-52">
            <DropdownMenuLabel>Filtra per tag</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {tags.length === 0 && <div className="px-2 py-1 text-xs text-muted-foreground">Nessun tag</div>}
            {tags.map(tg => (
              <DropdownMenuItem key={tg.id} onClick={() => toggle(tagFilter, tg.id, setTagFilter)} onSelect={e => e.preventDefault()}>
                <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: tg.color }} />
                <span className="truncate flex-1">{tg.name}</span>
                {tagFilter.includes(tg.id) && <span className="text-primary text-xs">✓</span>}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        {hasFilters && (
          <Button variant="ghost" size="sm" className="h-8 text-muted-foreground" onClick={clearFilters}>
            <X className="h-3.5 w-3.5 mr-1" /> Pulisci
          </Button>
        )}
      </div>

      {/* Column headers */}
      <div className="grid grid-cols-3 gap-3 px-6 py-2 shrink-0 border-b">
        {COLUMNS.map(col => (
          <div key={col} className="text-xs font-medium text-muted-foreground uppercase tracking-wide px-2">
            {STATUS_LABELS[col]}
          </div>
        ))}
      </div>

      {/* Board */}
      <div className="flex-1 overflow-y-auto px-3 py-3">
        <DragDropContext onDragEnd={onDragEnd}>
          {epicGroups.map(({ epic, epicStories }) => {
            // Storie visibili nel gruppo: con i filtri attivi mostra solo quelle con task corrispondenti.
            const visibleStories = epicStories.filter(story =>
              !hasFilters || tasks.some(t => t.parentId === story.id && t.status !== 'ARCHIVIATO'))
            if (visibleStories.length === 0) return null

            const epicCollapsed = epic ? (collapsedEpics[epic.id] ?? epic.status === 'COMPLETATO') : false
            const prog = epic ? epicProgress(epic.id) : { done: 0, total: 0 }

            return (
              <div key={epic?.id ?? 'no-epic'} className="mb-5">
                {epic ? (
                  <EpicHeader
                    epic={epic}
                    storyCount={visibleStories.length}
                    done={prog.done}
                    total={prog.total}
                    collapsed={epicCollapsed}
                    onToggle={() => setCollapsedEpics(c => ({
                      ...c,
                      [epic.id]: !(c[epic.id] ?? epic.status === 'COMPLETATO'),
                    }))}
                  />
                ) : (
                  <div className="flex items-center gap-2 py-2 px-3 text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    Senza epica
                  </div>
                )}

                {!epicCollapsed && (
                  <div className="mt-1 md:pl-3">
                    {visibleStories.map(story => {
                      const storyTasks = tasks.filter(t => t.parentId === story.id && t.status !== 'ARCHIVIATO')
                      return (
                        <SwimLane
                          key={story.id}
                          story={story}
                          epic={undefined /* l'epica è già nell'intestazione del gruppo */}
                          tasks={storyTasks}
                          collapsed={collapsed[story.id] ?? story.status === 'COMPLETATO'}
                          onToggle={() => setCollapsed(c => ({
                            ...c,
                            [story.id]: !(c[story.id] ?? story.status === 'COMPLETATO'),
                          }))}
                          cardConfig={cardConfig}
                        />
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
          {stories.length === 0 && (
            <div className="flex flex-col items-center justify-center h-64 text-center">
              <p className="text-muted-foreground text-sm">Nessuna storia trovata.</p>
              <p className="text-muted-foreground text-xs mt-1">Crea prima un'Epica, poi una Storia.</p>
            </div>
          )}
          {stories.length > 0 && hasFilters && tasks.length === 0 && (
            <div className="flex flex-col items-center justify-center h-64 text-center">
              <p className="text-muted-foreground text-sm">Nessun task corrisponde ai filtri.</p>
            </div>
          )}
        </DragDropContext>
      </div>

      <CreateElementDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        workspaceId={wsId!}
        defaultType="TASK"
      />

      {/* Conferma chiusura storia/epica al 100% (solo admin) */}
      <Dialog open={!!pendingClose} onOpenChange={v => { if (!v && !closing) setPendingClose(null) }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {pendingClose ? `${TYPE_LABELS[pendingClose.type]} completata` : 'Completata'}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {pendingClose && (
                <>
                  Tutti i task di <span className="font-medium text-foreground">«{pendingClose.title}»</span> sono completati.
                  Vuoi considerare conclusa questa {TYPE_LABELS[pendingClose.type].toLowerCase()} e segnarla come completata?
                </>
              )}
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setPendingClose(null)} disabled={closing}>
                Non ora
              </Button>
              <Button onClick={confirmClose} disabled={closing}>
                {closing ? 'Chiusura...' : 'Sì, concludi'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
