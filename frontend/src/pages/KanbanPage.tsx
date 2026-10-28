import { memo, useCallback, useDeferredValue, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd'
import { Check, ChevronRight, KanbanSquare, Plus, Search, SearchX, Tag as TagIcon, Trash2, Users, X } from 'lucide-react'
import { elementsApi, tagsApi, workspacesApi } from '@/lib/api'
import { useElementDelete } from '@/lib/useElementDelete'
import { Element, ElementStatus, Tag, Member, Workspace } from '@/types'
import { cn, getErrorMessage, STATUS_LABELS, TYPE_LABELS } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { toast } from '@/components/ui/toast'
import {
  DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  EmptyState, LoadingSkeleton, PageHeader, QueryState, StatusIcon, TaskCard, TypeIcon, UserAvatar, useConfirm,
} from '@/components/shared'
import { useWorkspaceStore } from '@/store/workspaceStore'
import { CreateElementDialog } from '@/components/CreateElementDialog'

const COLUMNS: ElementStatus[] = ['DA_FARE', 'IN_CORSO', 'COMPLETATO']
const NO_TASKS: Element[] = []

interface CardConfig { tags: boolean; assignees: boolean; dueDate: boolean }
type ByStatus = Record<ElementStatus, Element[]>

const emptyByStatus = (): ByStatus => ({ DA_FARE: [], IN_CORSO: [], COMPLETATO: [], ARCHIVIATO: [] })

/* ------------------------------------------------------------------- Card */

interface KanbanCardProps {
  task: Element
  index: number
  wsId: string
  cardConfig: CardConfig
  deletable: boolean
  dragDisabled: boolean
  onDelete: (task: Element) => void
}

// memo: durante il drag o la digitazione nella ricerca si ri-renderizzano solo le card cambiate
// (react-query mantiene l'identità degli oggetti invariati grazie allo structural sharing).
const KanbanCard = memo(function KanbanCard({ task, index, wsId, cardConfig, deletable, dragDisabled, onDelete }: KanbanCardProps) {
  return (
    <Draggable draggableId={task.id} index={index} isDragDisabled={dragDisabled}>
      {(provided, snapshot) => (
        <TaskCard
          ref={provided.innerRef}
          {...provided.draggableProps}
          {...provided.dragHandleProps}
          style={provided.draggableProps.style as React.CSSProperties}
          title={task.title}
          href={`/workspace/${wsId}/element/${task.id}`}
          status={task.status}
          tags={cardConfig.tags ? task.tags : undefined}
          assignees={cardConfig.assignees ? task.assignees : undefined}
          dueDate={cardConfig.dueDate ? task.endDate : undefined}
          blocked={task.blocked}
          dragging={snapshot.isDragging}
          aria-label={`${task.title} — ${STATUS_LABELS[task.status]}`}
          className={cn(
            'outline-none focus-visible:ring-2 focus-visible:ring-ring',
            !dragDisabled && 'cursor-grab active:cursor-grabbing',
            snapshot.isDragging && 'ring-1 ring-primary/30'
          )}
          actions={
            deletable ? (
              <IconButton
                size="xs"
                label="Elimina task"
                icon={<Trash2 />}
                className="hover:text-destructive"
                onClick={e => { e.stopPropagation(); e.preventDefault(); onDelete(task) }}
              />
            ) : undefined
          }
        />
      )}
    </Draggable>
  )
})

/* ------------------------------------------------------------- Swim lane */

interface SwimLaneProps {
  story: Element
  tasks: Element[]
  collapsed: boolean
  wsId: string
  cardConfig: CardConfig
  canCreate: boolean
  canDelete: (el: Pick<Element, 'type' | 'createdBy'>) => boolean
  onDelete: (task: Element) => void
  onToggle: (storyId: string, defaultCollapsed: boolean) => void
  onAddTask: (storyId: string) => void
}

const SwimLane = memo(function SwimLane({
  story, tasks, collapsed, wsId, cardConfig, canCreate, canDelete, onDelete, onToggle, onAddTask,
}: SwimLaneProps) {
  const byStatus = useMemo(() => {
    const m = emptyByStatus()
    for (const t of tasks) m[t.status]?.push(t)
    return m
  }, [tasks])
  const done = story.status === 'COMPLETATO'
  const contentId = `lane-${story.id}`

  return (
    <section aria-label={`Storia: ${story.title}`}>
      <div className="group flex items-center gap-1 py-1">
        <button
          type="button"
          onClick={() => onToggle(story.id, done)}
          aria-expanded={!collapsed}
          aria-controls={contentId}
          className="focus-ring flex min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 py-1 text-left transition-colors hover:bg-accent"
        >
          <ChevronRight className={cn('h-4 w-4 shrink-0 text-muted-foreground transition-transform', !collapsed && 'rotate-90')} aria-hidden="true" />
          <TypeIcon type="STORIA" size="sm" />
          <span className={cn('truncate text-sm font-medium', done && 'text-muted-foreground line-through')}>{story.title}</span>
          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{tasks.length}</span>
          {done && (
            <Badge variant="success" size="sm" className="shrink-0">
              <Check className="h-3 w-3" aria-hidden="true" /> Conclusa
            </Badge>
          )}
        </button>
        {canCreate && !collapsed && (
          <Button
            size="xs"
            variant="ghost"
            className="shrink-0 text-muted-foreground [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:focus-visible:opacity-100 [@media(hover:hover)]:group-hover:opacity-100"
            onClick={() => onAddTask(story.id)}
            aria-label={`Aggiungi task a ${story.title}`}
          >
            <Plus className="h-3.5 w-3.5" /> Task
          </Button>
        )}
      </div>

      {!collapsed && (
        <div
          id={contentId}
          className="-mx-3 flex snap-x snap-mandatory scroll-px-3 gap-2 overflow-x-auto px-3 pb-2 md:mx-0 md:grid md:grid-cols-3 md:gap-3 md:overflow-visible md:px-0 md:pb-1"
        >
          {COLUMNS.map(col => {
            const colTasks = byStatus[col]
            return (
              <Droppable key={col} droppableId={`${story.id}::${col}`}>
                {(provided, snapshot) => (
                  <div className="flex w-[82%] max-w-xs shrink-0 snap-start flex-col sm:w-[46%] md:w-auto md:max-w-none">
                    {/* Su mobile le colonne scorrono in orizzontale: ognuna ha la sua intestazione. */}
                    <div className="mb-1.5 flex items-center gap-1.5 px-1 text-xs font-medium text-muted-foreground md:hidden">
                      <StatusIcon status={col} size="sm" />
                      {STATUS_LABELS[col]}
                      <span className="tabular-nums">{colTasks.length}</span>
                    </div>
                    <div
                      ref={provided.innerRef}
                      {...provided.droppableProps}
                      aria-label={`${STATUS_LABELS[col]} — ${story.title}`}
                      className={cn(
                        'min-h-20 flex-1 space-y-2 rounded-lg border border-transparent bg-surface-2 p-1.5 transition-colors',
                        snapshot.isDraggingOver && 'border-dashed border-primary/50 bg-primary/5'
                      )}
                    >
                      {colTasks.map((task, i) => (
                        <KanbanCard
                          key={task.id}
                          task={task}
                          index={i}
                          wsId={wsId}
                          cardConfig={cardConfig}
                          deletable={canDelete(task)}
                          dragDisabled={!canCreate}
                          onDelete={onDelete}
                        />
                      ))}
                      {provided.placeholder}
                      {colTasks.length === 0 && !snapshot.isDraggingOver && (
                        <p className="select-none py-4 text-center text-2xs text-muted-foreground/70">
                          {canCreate ? 'Trascina qui un task' : 'Nessun task'}
                        </p>
                      )}
                    </div>
                  </div>
                )}
              </Droppable>
            )
          })}
        </div>
      )}
    </section>
  )
})

/* ------------------------------------------------------------ Epic header */

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
      className="flex cursor-pointer select-none items-center gap-2 rounded-lg border bg-card px-1.5 py-1.5 shadow-xs transition-colors hover:border-border-strong"
      onClick={onToggle}
    >
      <IconButton
        size="xs"
        label={collapsed ? 'Espandi epica' : 'Comprimi epica'}
        aria-expanded={!collapsed}
        icon={<ChevronRight className={cn('transition-transform', !collapsed && 'rotate-90')} />}
        onClick={e => { e.stopPropagation(); onToggle() }}
        noTooltip
      />
      <TypeIcon type="EPICA" size="sm" />
      <Link
        to={`/workspace/${wsId}/element/${epic.id}`}
        onClick={e => e.stopPropagation()}
        className={cn(
          'min-w-0 truncate rounded-sm text-sm font-semibold transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          complete && 'text-muted-foreground line-through'
        )}
        title={epic.title}
      >
        {epic.title}
      </Link>
      <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">
        {storyCount} {storyCount === 1 ? 'storia' : 'storie'}
      </span>
      {complete && (
        <Badge variant="success" size="sm" className="shrink-0">
          <Check className="h-3 w-3" aria-hidden="true" /> Conclusa
        </Badge>
      )}
      {total > 0 && (
        <div className="ml-auto flex shrink-0 items-center gap-2 pr-1.5" title={`${done} di ${total} task completati`}>
          <div className="h-1.5 w-12 overflow-hidden rounded-full bg-muted sm:w-24" aria-hidden="true">
            <div className={cn('h-full rounded-full', complete ? 'bg-success' : 'bg-primary')} style={{ width: `${pct}%` }} />
          </div>
          <span className="text-xs tabular-nums text-muted-foreground">{done}/{total}</span>
        </div>
      )}
    </div>
  )
}

/* ---------------------------------------------------------------- Filters */

function FilterMenu<T>({ label, icon: Icon, items, selected, getId, renderItem, onToggle, emptyLabel, menuLabel }: {
  label: string
  icon: typeof Users
  items: T[]
  selected: string[]
  getId: (item: T) => string
  renderItem: (item: T) => React.ReactNode
  onToggle: (id: string) => void
  emptyLabel: string
  menuLabel: string
}) {
  const active = selected.length > 0
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className={cn(active && 'border-primary/60 bg-primary/5 text-primary')}>
          <Icon className="h-3.5 w-3.5" /> {label}
          {active && (
            <span className="rounded-full bg-primary px-1.5 text-2xs font-semibold tabular-nums text-primary-foreground">
              {selected.length}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-80 w-56 overflow-y-auto">
        <DropdownMenuLabel>{menuLabel}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {items.length === 0 && <div className="px-2 py-1.5 text-xs text-muted-foreground">{emptyLabel}</div>}
        {items.map(item => {
          const id = getId(item)
          return (
            <DropdownMenuCheckboxItem
              key={id}
              checked={selected.includes(id)}
              onCheckedChange={() => onToggle(id)}
              onSelect={e => e.preventDefault()}
            >
              {renderItem(item)}
            </DropdownMenuCheckboxItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/* ------------------------------------------------------------------- Page */

export default function KanbanPage() {
  const { wsId } = useParams<{ wsId: string }>()
  const queryClient = useQueryClient()
  const confirm = useConfirm()
  const workspaceName = useWorkspaceStore(s => s.current?.name)
  const myRole = useWorkspaceStore(s => s.current?.myRole)
  const isAdmin = myRole === 'ADMIN'
  const canCreate = myRole !== 'GUEST'
  const { canDelete, remove } = useElementDelete(wsId)

  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [collapsedEpics, setCollapsedEpics] = useState<Record<string, boolean>>({})
  // Dialog di creazione unico per la pagina: type/parent decidono cosa precompilare.
  const [create, setCreate] = useState<{ open: boolean; type: 'TASK' | 'STORIA'; parentId?: string }>({ open: false, type: 'TASK' })

  // Filtri. La ricerca è "differita": l'input resta reattivo, il filtraggio della board segue.
  const [search, setSearch] = useState('')
  const deferredSearch = useDeferredValue(search)
  const [assigneeFilter, setAssigneeFilter] = useState<string[]>([])
  const [tagFilter, setTagFilter] = useState<string[]>([])

  // Gli eventi realtime (ELEMENT_*) sono già gestiti dal Layout, che invalida ['elements'].
  const elementsQuery = useQuery<Element[]>({
    queryKey: ['elements', wsId],
    queryFn: () => elementsApi.list(wsId!),
    enabled: !!wsId,
  })
  const elements = elementsQuery.data ?? NO_TASKS

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
  const { data: workspaces } = useQuery<Workspace[]>({
    queryKey: ['workspaces'],
    queryFn: workspacesApi.list,
  })
  const currentWs = workspaces?.find(w => w.id === wsId)
  const showTags = currentWs?.cardShowTags ?? true
  const showAssignees = currentWs?.cardShowAssignees ?? true
  const showDue = currentWs?.cardShowDueDate ?? true
  const cardConfig = useMemo<CardConfig>(
    () => ({ tags: showTags, assignees: showAssignees, dueDate: showDue }),
    [showTags, showAssignees, showDue]
  )

  // --- Struttura Epica ▸ Storia ▸ Task (indipendente dai filtri) ---
  const structure = useMemo(() => {
    const byDone = (a: Element, b: Element) => (a.status === 'COMPLETATO' ? 1 : 0) - (b.status === 'COMPLETATO' ? 1 : 0)
    // Le storie concluse vanno in fondo (e collassate di default): il focus è sulle cose da fare.
    const stories = elements.filter(e => e.type === 'STORIA').sort(byDone)
    const epics = elements.filter(e => e.type === 'EPICA').sort(byDone)
    const allTasks = elements.filter(e => e.type === 'TASK')
    const epicIds = new Set(epics.map(e => e.id))

    const storiesByEpic = new Map<string, Element[]>()
    const orphanStories: Element[] = []
    for (const s of stories) {
      if (s.parentId && epicIds.has(s.parentId)) {
        const list = storiesByEpic.get(s.parentId) ?? []
        list.push(s)
        storiesByEpic.set(s.parentId, list)
      } else orphanStories.push(s)
    }

    // Avanzamento di un'epica: task completati / totali sotto le sue storie (esclusi gli archiviati).
    const storyToEpic = new Map<string, string>()
    stories.forEach(s => { if (s.parentId && epicIds.has(s.parentId)) storyToEpic.set(s.id, s.parentId) })
    const epicProgress = new Map<string, { done: number; total: number }>()
    for (const t of allTasks) {
      if (t.status === 'ARCHIVIATO' || !t.parentId) continue
      const epicId = storyToEpic.get(t.parentId)
      if (!epicId) continue
      const p = epicProgress.get(epicId) ?? { done: 0, total: 0 }
      p.total++
      if (t.status === 'COMPLETATO') p.done++
      epicProgress.set(epicId, p)
    }

    // Le epiche concluse vanno in fondo; le storie senza epica finiscono in un gruppo "Senza epica".
    const groups: { epic: Element | null; stories: Element[] }[] = epics
      .map(epic => ({ epic, stories: storiesByEpic.get(epic.id) ?? [] }))
      .filter(g => g.stories.length > 0)
    if (orphanStories.length > 0) groups.push({ epic: null, stories: orphanStories })

    return { stories, allTasks, groups, epicProgress }
  }, [elements])

  // --- Filtri: task visibili raggruppati per storia ---
  const query = deferredSearch.trim().toLowerCase()
  const hasFilters = query !== '' || assigneeFilter.length > 0 || tagFilter.length > 0
  const { tasksByStory, statusCounts, visibleCount } = useMemo(() => {
    const map = new Map<string, Element[]>()
    const counts = emptyByStatus()
    let n = 0
    for (const t of structure.allTasks) {
      if (t.status === 'ARCHIVIATO' || !t.parentId) continue
      if (query && !t.title.toLowerCase().includes(query)) continue
      if (assigneeFilter.length > 0 && !t.assignees.some(a => assigneeFilter.includes(a.id))) continue
      if (tagFilter.length > 0 && !t.tags.some(tg => tagFilter.includes(tg.id))) continue
      const list = map.get(t.parentId) ?? []
      list.push(t)
      map.set(t.parentId, list)
      counts[t.status].push(t)
      n++
    }
    return { tasksByStory: map, statusCounts: counts, visibleCount: n }
  }, [structure.allTasks, query, assigneeFilter, tagFilter])

  // Storie visibili per gruppo: con i filtri attivi solo quelle con task corrispondenti.
  const visibleGroups = useMemo(
    () =>
      structure.groups
        .map(g => ({ ...g, stories: hasFilters ? g.stories.filter(s => tasksByStory.has(s.id)) : g.stories }))
        .filter(g => g.stories.length > 0),
    [structure.groups, tasksByStory, hasFilters]
  )

  const toggleIn = (set: React.Dispatch<React.SetStateAction<string[]>>) => (id: string) =>
    set(arr => (arr.includes(id) ? arr.filter(x => x !== id) : [...arr, id]))
  const clearFilters = () => { setSearch(''); setAssigneeFilter([]); setTagFilter([]) }

  // --- Callback stabili per le lane/card memo ---
  const toggleStory = useCallback((id: string, def: boolean) => setCollapsed(c => ({ ...c, [id]: !(c[id] ?? def) })), [])
  const addTask = useCallback((storyId: string) => setCreate({ open: true, type: 'TASK', parentId: storyId }), [])
  const deleteTask = useCallback((task: Element) => { void remove(task) }, [remove])

  // --- Chiusura automatica al 100% (solo admin) ---
  // Un'epica è "conclusa" se tutti i task sotto le sue storie sono completati.
  const epicComplete = (epicId: string, list: Element[]) => {
    const storyIds = new Set(list.filter(e => e.type === 'STORIA' && e.parentId === epicId).map(s => s.id))
    const ts = list.filter(e => e.type === 'TASK' && e.parentId && storyIds.has(e.parentId))
    return ts.length > 0 && ts.every(t => t.status === 'COMPLETATO')
  }
  // Una storia è "conclusa" se ha task e sono tutti completati.
  const storyComplete = (storyId: string, list: Element[]) => {
    const ts = list.filter(e => e.type === 'TASK' && e.parentId === storyId)
    return ts.length > 0 && ts.every(t => t.status === 'COMPLETATO')
  }

  const proposeClose = async (el: Element): Promise<void> => {
    if (!wsId) return
    const label = TYPE_LABELS[el.type]
    const ok = await confirm({
      title: `${label} completata`,
      description: (
        <>
          Tutti i task di <span className="font-medium text-foreground">«{el.title}»</span> sono completati.
          Vuoi considerare conclusa questa {label.toLowerCase()} e segnarla come completata?
        </>
      ),
      confirmLabel: 'Sì, concludi',
      cancelLabel: 'Non ora',
    })
    if (!ok) return
    try {
      await elementsApi.update(wsId, el.id, { status: 'COMPLETATO' })
      const list = (queryClient.getQueryData<Element[]>(['elements', wsId]) ?? elements)
        .map(e => (e.id === el.id ? { ...e, status: 'COMPLETATO' as ElementStatus } : e))
      queryClient.setQueryData<Element[]>(['elements', wsId], list)
      queryClient.invalidateQueries({ queryKey: ['elements', wsId] })
      queryClient.invalidateQueries({ queryKey: ['my-tasks'] })
      toast(`${label} conclusa`, 'success')
      // Dopo aver chiuso una storia, se anche l'epica è completa, proponi di chiuderla.
      if (el.type === 'STORIA' && el.parentId) {
        const epic = list.find(e => e.id === el.parentId && e.type === 'EPICA')
        if (epic && epic.status !== 'COMPLETATO' && epicComplete(epic.id, list)) await proposeClose(epic)
      }
    } catch (err) {
      toast(getErrorMessage(err, 'Impossibile completare'), 'destructive')
    }
  }

  const onDragEnd = async (result: DropResult) => {
    if (!result.destination || !wsId) return
    const [, newStatus] = result.destination.droppableId.split('::') as [string, ElementStatus]
    const list = queryClient.getQueryData<Element[]>(['elements', wsId]) ?? elements
    const task = list.find(t => t.id === result.draggableId)
    if (!task || task.status === newStatus) return

    // Aggiornamento ottimistico (sincrono, così la card non "rimbalza" al rilascio).
    void queryClient.cancelQueries({ queryKey: ['elements', wsId] })
    const updatedList = list.map(e => (e.id === task.id ? { ...e, status: newStatus } : e))
    queryClient.setQueryData<Element[]>(['elements', wsId], updatedList)

    try {
      // Solo il campo cambiato: le liste non contengono il body e il backend ignora i campi assenti.
      await elementsApi.update(wsId, task.id, { status: newStatus })
      queryClient.invalidateQueries({ queryKey: ['my-tasks'] })
      // Se spostando il task la storia si completa, proponi all'admin di chiuderla.
      if (isAdmin && newStatus === 'COMPLETATO' && task.parentId) {
        const story = updatedList.find(e => e.id === task.parentId && e.type === 'STORIA')
        if (story && story.status !== 'COMPLETATO' && storyComplete(story.id, updatedList)) await proposeClose(story)
      }
    } catch (err) {
      toast(getErrorMessage(err, 'Impossibile spostare il task'), 'destructive')
      queryClient.invalidateQueries({ queryKey: ['elements', wsId] })
    }
  }

  const hasStories = structure.stories.length > 0

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="shrink-0 border-b px-3 pt-4 md:px-6">
        <PageHeader
          title="Kanban"
          description={workspaceName}
          icon={KanbanSquare}
          hideTitleOnMobile
          className="pb-3 sm:pb-3"
          actions={
            canCreate && (
              <>
                <Button size="sm" variant="outline" onClick={() => setCreate({ open: true, type: 'STORIA' })}>
                  <Plus className="h-3.5 w-3.5" /> Storia
                </Button>
                <Button size="sm" onClick={() => setCreate({ open: true, type: 'TASK' })}>
                  <Plus className="h-3.5 w-3.5" /> Nuovo task
                </Button>
              </>
            )
          }
        >
          {/* Barra filtri: va a capo su mobile */}
          <div className="flex flex-wrap items-center gap-2" role="search">
            <div className="relative w-full sm:w-64">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <Input
                value={search}
                onChange={e => setSearch(e.target.value)}
                onKeyDown={e => { if (e.key === 'Escape' && search) { e.stopPropagation(); setSearch('') } }}
                placeholder="Cerca task…"
                aria-label="Cerca task"
                className="h-8 pl-8 pr-8 text-sm"
              />
              {search && (
                <IconButton
                  size="xs"
                  label="Cancella ricerca"
                  icon={<X />}
                  noTooltip
                  className="absolute right-0.5 top-1/2 h-6 w-6 -translate-y-1/2"
                  onClick={() => setSearch('')}
                />
              )}
            </div>
            <FilterMenu
              label="Assegnatari"
              icon={Users}
              menuLabel="Filtra per assegnatario"
              emptyLabel="Nessun membro"
              items={members}
              selected={assigneeFilter}
              getId={m => m.userId}
              onToggle={toggleIn(setAssigneeFilter)}
              renderItem={m => (
                <span className="flex min-w-0 items-center gap-2">
                  <UserAvatar name={m.displayName} avatar={m.avatar} size="xs" />
                  <span className="truncate">{m.displayName}</span>
                </span>
              )}
            />
            <FilterMenu
              label="Tag"
              icon={TagIcon}
              menuLabel="Filtra per tag"
              emptyLabel="Nessun tag"
              items={tags}
              selected={tagFilter}
              getId={tg => tg.id}
              onToggle={toggleIn(setTagFilter)}
              renderItem={tg => (
                <span className="flex min-w-0 items-center gap-2">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: tg.color }} aria-hidden="true" />
                  <span className="truncate">{tg.name}</span>
                </span>
              )}
            />
            {(hasFilters || search) && (
              <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={clearFilters}>
                <X className="h-3.5 w-3.5" /> Pulisci
              </Button>
            )}
            {elementsQuery.isSuccess && hasStories && (
              <span className="ml-auto text-xs tabular-nums text-muted-foreground" aria-live="polite">
                {visibleCount} task{hasFilters ? (visibleCount === 1 ? ' trovato' : ' trovati') : ''}
              </span>
            )}
          </div>
        </PageHeader>
      </div>

      <div className="flex-1 overflow-y-auto">
        <QueryState
          query={elementsQuery}
          className="p-3 md:p-6"
          loading={<LoadingSkeleton kind="cards" rows={6} />}
          isEmpty={!hasStories}
          empty={{
            icon: KanbanSquare,
            title: 'Nessuna storia',
            description: "Il Kanban mostra i task raggruppati per storia. Crea prima un'Epica, poi una Storia.",
            action: canCreate ? (
              <Button size="sm" onClick={() => setCreate({ open: true, type: 'STORIA' })}>
                <Plus className="h-3.5 w-3.5" /> Nuova storia
              </Button>
            ) : undefined,
          }}
        >
          {/* Intestazioni colonne (desktop): sticky, con il conteggio dei task visibili */}
          <div className="sticky top-0 z-sticky hidden grid-cols-3 gap-3 border-b bg-background/95 py-2 pl-[3.0625rem] pr-6 backdrop-blur supports-[backdrop-filter]:bg-background/80 md:grid">
            {COLUMNS.map(col => (
              <div key={col} className="flex items-center gap-1.5 px-1 text-xs font-medium text-muted-foreground">
                <StatusIcon status={col} size="sm" />
                <span>{STATUS_LABELS[col]}</span>
                <span className="rounded-full bg-muted px-1.5 text-2xs tabular-nums">{statusCounts[col].length}</span>
              </div>
            ))}
          </div>

          <div className="space-y-5 px-3 py-3 md:px-6 md:py-4">
            <DragDropContext onDragEnd={onDragEnd}>
              {visibleGroups.map(({ epic, stories }) => {
                const epicCollapsed = epic ? (collapsedEpics[epic.id] ?? epic.status === 'COMPLETATO') : false
                const prog = (epic && structure.epicProgress.get(epic.id)) || { done: 0, total: 0 }
                return (
                  <div key={epic?.id ?? 'no-epic'} className="space-y-1">
                    {epic ? (
                      <EpicHeader
                        epic={epic}
                        storyCount={stories.length}
                        done={prog.done}
                        total={prog.total}
                        collapsed={epicCollapsed}
                        onToggle={() => setCollapsedEpics(c => ({ ...c, [epic.id]: !(c[epic.id] ?? epic.status === 'COMPLETATO') }))}
                      />
                    ) : (
                      <div className="flex items-center gap-2 px-1.5 py-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        Senza epica <span className="tabular-nums normal-case">{stories.length}</span>
                      </div>
                    )}

                    {!epicCollapsed && (
                      <div className="space-y-2 md:border-l md:pl-3 md:ml-3">
                        {stories.map(story => (
                          <SwimLane
                            key={story.id}
                            story={story}
                            tasks={tasksByStory.get(story.id) ?? NO_TASKS}
                            collapsed={collapsed[story.id] ?? story.status === 'COMPLETATO'}
                            wsId={wsId!}
                            cardConfig={cardConfig}
                            canCreate={canCreate}
                            canDelete={canDelete}
                            onDelete={deleteTask}
                            onToggle={toggleStory}
                            onAddTask={addTask}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </DragDropContext>

            {hasFilters && visibleCount === 0 && (
              <EmptyState
                icon={SearchX}
                title="Nessun task corrisponde ai filtri"
                description="Prova a cambiare la ricerca o a rimuovere qualche filtro."
                action={<Button size="sm" variant="outline" onClick={clearFilters}>Pulisci filtri</Button>}
                bordered
              />
            )}
          </div>
        </QueryState>
      </div>

      <CreateElementDialog
        open={create.open}
        onClose={() => setCreate(c => ({ ...c, open: false }))}
        workspaceId={wsId!}
        defaultType={create.type}
        defaultParentId={create.parentId}
      />
    </div>
  )
}
