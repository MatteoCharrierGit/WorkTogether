import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { useParams, Navigate, Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { DragDropContext, Draggable, Droppable, DropResult } from '@hello-pangea/dnd'
import { sprintApi, elementsApi, channelsApi } from '@/lib/api'
import { Sprint, SprintDetail, Element, ChatMessage, ElementStatus } from '@/types'
import { useWorkspaceStore } from '@/store/workspaceStore'
import { useAuthStore } from '@/store/authStore'
import { useWorkspaceEvents } from '@/lib/websocket'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Progress } from '@/components/ui/progress'
import { Badge } from '@/components/ui/badge'
import { SimpleTooltip } from '@/components/ui/tooltip'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from '@/components/ui/select'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { toast } from '@/components/ui/toast'
import {
  EmptyState, LoadingSkeleton, PageHeader, QueryState, StatusIcon, TaskCard, UserAvatar, useConfirm,
} from '@/components/shared'
import { cn, getErrorMessage } from '@/lib/utils'
import {
  Archive, CalendarDays, CircleCheck, Flag, History, ListTodo, MessageSquare, MoreHorizontal, Pencil, Play, Plus,
  Send, Target, Trash2, TriangleAlert, X,
} from 'lucide-react'

const STATUS_LABEL: Record<string, string> = {
  DA_FARE: 'Backlog sprint',
  IN_CORSO: 'In corso',
  COMPLETATO: 'Completati',
}
const COLUMN_STATUSES: ElementStatus[] = ['DA_FARE', 'IN_CORSO', 'COMPLETATO']
const MOVE_LABEL: Record<string, string> = { DA_FARE: 'Da fare', IN_CORSO: 'In corso', COMPLETATO: 'Completato' }

function fmtDate(d?: string) {
  if (!d) return '—'
  const date = new Date(d)
  return isNaN(date.getTime()) ? '—' : date.toLocaleDateString('it-IT', { day: '2-digit', month: 'short', year: 'numeric' })
}

function daysLeft(end?: string): number | null {
  if (!end) return null
  const e = new Date(end)
  if (isNaN(e.getTime())) return null
  return Math.ceil((e.getTime() - Date.now()) / 86_400_000)
}

export default function SprintPage() {
  const { wsId } = useParams<{ wsId: string }>()
  const myRole = useWorkspaceStore(s => s.current?.myRole)
  const sprintEnabled = useWorkspaceStore(s => s.current?.sprintEnabled)
  const isAdmin = myRole === 'ADMIN'
  const canEdit = !!myRole && myRole !== 'GUEST'
  const [tab, setTab] = useState('active')
  const [form, setForm] = useState<{ open: boolean; sprint: Sprint | null }>({ open: false, sprint: null })

  // Gli eventi realtime (SPRINT_CHANGED, ELEMENT_*) sono già gestiti dal Layout, che invalida
  // ['sprints'] e ['sprint-active'].
  const sprintsQuery = useQuery<Sprint[]>({
    queryKey: ['sprints', wsId],
    queryFn: () => sprintApi.list(wsId!),
    enabled: !!wsId,
  })
  const activeQuery = useQuery<SprintDetail>({
    queryKey: ['sprint-active', wsId],
    queryFn: () => sprintApi.active(wsId!),
    enabled: !!wsId,
  })

  const sprints = sprintsQuery.data
  const planned = useMemo(() => (sprints ?? []).filter(s => s.status === 'PLANNED'), [sprints])
  const closed = useMemo(() => (sprints ?? []).filter(s => s.status === 'CLOSED'), [sprints])
  const active = activeQuery.data
  const hasActive = !!active?.sprint

  // La sezione Sprint è attivabile/nascondibile dall'admin (Admin → Impostazioni). Se disattivata,
  // l'accesso diretto via URL reindirizza alla home del workspace.
  if (sprintEnabled === false) {
    return <Navigate to={`/workspace/${wsId ?? ''}`} replace />
  }

  return (
    <Tabs value={tab} onValueChange={setTab} className="flex h-full flex-col overflow-hidden">
      <div className="shrink-0 px-3 pt-4 md:px-6">
        <PageHeader
          title="Sprint"
          icon={Target}
          className="pb-0 sm:pb-0"
          hideTitleOnMobile
          description={hasActive ? <>In corso: <span className="text-foreground">{active!.sprint!.name}</span></> : 'Pianifica, esegui e chiudi le sprint del team'}
          actions={
            isAdmin && (
              <Button size="sm" onClick={() => setForm({ open: true, sprint: null })}>
                <Plus className="h-3.5 w-3.5" /> Nuova sprint
              </Button>
            )
          }
        >
          <TabsList variant="underline" className="-mx-3 px-3 md:-mx-6 md:px-6">
            <TabsTrigger value="active">
              <Play className="h-3.5 w-3.5" /> Sprint attiva
            </TabsTrigger>
            <TabsTrigger value="planning">
              <ListTodo className="h-3.5 w-3.5" /> Planning
              {planned.length > 0 && <Badge variant="muted" size="sm">{planned.length}</Badge>}
            </TabsTrigger>
            <TabsTrigger value="archive">
              <Archive className="h-3.5 w-3.5" /> Archivio
              {closed.length > 0 && <Badge variant="muted" size="sm">{closed.length}</Badge>}
            </TabsTrigger>
          </TabsList>
        </PageHeader>
      </div>

      <div className="flex-1 overflow-y-auto">
        <TabsContent value="active" className="mt-0 p-3 md:p-6">
          <QueryState
            query={activeQuery}
            loading={<LoadingSkeleton kind="cards" rows={3} />}
            isEmpty={!hasActive}
            empty={{
              icon: Target,
              title: 'Nessuna sprint attiva',
              description: isAdmin ? 'Crea una sprint in Planning e avviala per vedere qui board, avanzamento e chat.' : "Quando un admin avvia una sprint la troverai qui.",
              action: isAdmin ? <Button size="sm" variant="outline" onClick={() => setTab('planning')}>Vai al planning</Button> : undefined,
            }}
          >
            {hasActive && (
              <ActiveDashboard wsId={wsId!} detail={active!} isAdmin={isAdmin} canEdit={canEdit} planned={planned} />
            )}
          </QueryState>
        </TabsContent>

        <TabsContent value="planning" className="mt-0 p-3 md:p-6">
          <QueryState query={sprintsQuery} skeleton="list" rows={3} className="max-w-3xl">
            <PlanningTab
              wsId={wsId!}
              planned={planned}
              isAdmin={isAdmin}
              hasActive={hasActive}
              onCreate={() => setForm({ open: true, sprint: null })}
              onEdit={s => setForm({ open: true, sprint: s })}
            />
          </QueryState>
        </TabsContent>

        <TabsContent value="archive" className="mt-0 p-3 md:p-6">
          <QueryState
            query={sprintsQuery}
            skeleton="list"
            rows={3}
            className="max-w-3xl"
            isEmpty={closed.length === 0}
            empty={{ icon: History, title: 'Nessuna sprint chiusa', description: 'Le sprint concluse, con la loro retrospettiva, compariranno qui.' }}
          >
            <div className="max-w-3xl space-y-3">
              {closed.map(s => <ClosedSprintCard key={s.id} sprint={s} />)}
            </div>
          </QueryState>
        </TabsContent>
      </div>

      {form.open && (
        <SprintFormDialog
          wsId={wsId!}
          sprint={form.sprint}
          onClose={() => setForm({ open: false, sprint: null })}
        />
      )}
    </Tabs>
  )
}

/* ----------------------------------------------------------------- Planning */

function PlanningTab({ wsId, planned, isAdmin, hasActive, onCreate, onEdit }: {
  wsId: string; planned: Sprint[]; isAdmin: boolean; hasActive: boolean
  onCreate: () => void; onEdit: (s: Sprint) => void
}) {
  const queryClient = useQueryClient()
  const confirm = useConfirm()

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['sprints', wsId] })
    queryClient.invalidateQueries({ queryKey: ['sprint-active', wsId] })
  }

  const start = async (s: Sprint) => {
    if (hasActive) { toast("C'è già una sprint attiva: chiudila prima.", 'destructive'); return }
    const ok = await confirm({
      title: `Avviare «${s.name}»?`,
      description: 'La sprint diventa attiva: comparirà la board con avanzamento e chat dedicata.',
      confirmLabel: 'Avvia sprint',
    })
    if (!ok) return
    try { await sprintApi.start(wsId, s.id); refresh(); toast('Sprint avviata', 'success') }
    catch (e) { toast(getErrorMessage(e, "Errore nell'avvio"), 'destructive') }
  }
  const remove = async (s: Sprint) => {
    const ok = await confirm({
      title: `Eliminare «${s.name}»?`,
      description: 'La sprint pianificata viene eliminata e i task collegati tornano al backlog.',
      confirmLabel: 'Elimina',
      destructive: true,
    })
    if (!ok) return
    try { await sprintApi.delete(wsId, s.id); refresh(); toast('Sprint eliminata') }
    catch (e) { toast(getErrorMessage(e), 'destructive') }
  }

  if (planned.length === 0) {
    return (
      <EmptyState
        icon={ListTodo}
        title="Nessuna sprint pianificata"
        description={isAdmin ? 'Crea la prossima sprint: nome, obiettivo e date previste.' : 'Gli admin del workspace pianificano qui le prossime sprint.'}
        action={isAdmin ? <Button size="sm" onClick={onCreate}><Plus className="h-3.5 w-3.5" /> Nuova sprint</Button> : undefined}
        bordered
      />
    )
  }

  return (
    <ul className="max-w-3xl space-y-2">
      {planned.map(s => (
        <li key={s.id} className="rounded-lg border bg-card p-3 shadow-xs sm:p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0 space-y-1">
              <div className="flex items-center gap-2">
                <h3 className="truncate text-sm font-semibold">{s.name}</h3>
              </div>
              {s.goal && (
                <p className="flex items-start gap-1.5 text-sm text-muted-foreground">
                  <Flag className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" /> {s.goal}
                </p>
              )}
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <CalendarDays className="h-3.5 w-3.5" aria-hidden="true" /> {fmtDate(s.startDate)} → {fmtDate(s.endDate)}
                {s.taskTotal > 0 && <span>· {s.taskTotal} task</span>}
              </p>
            </div>
            {isAdmin && (
              <div className="flex shrink-0 items-center gap-1">
                <Button size="sm" onClick={() => start(s)} disabled={hasActive} title={hasActive ? "Chiudi prima la sprint attiva" : undefined}>
                  <Play className="h-3.5 w-3.5" /> Avvia
                </Button>
                <IconButton label="Modifica sprint" icon={<Pencil />} onClick={() => onEdit(s)} />
                <IconButton label="Elimina sprint" icon={<Trash2 />} className="hover:text-destructive" onClick={() => remove(s)} />
              </div>
            )}
          </div>
        </li>
      ))}
    </ul>
  )
}

function SprintFormDialog({ wsId, sprint, onClose }: { wsId: string; sprint: Sprint | null; onClose: () => void }) {
  const queryClient = useQueryClient()
  const [name, setName] = useState(sprint?.name ?? '')
  const [goal, setGoal] = useState(sprint?.goal ?? '')
  const [startDate, setStartDate] = useState(sprint?.startDate ?? '')
  const [endDate, setEndDate] = useState(sprint?.endDate ?? '')
  const [saving, setSaving] = useState(false)
  const datesInvalid = !!startDate && !!endDate && endDate < startDate

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim() || datesInvalid) return
    setSaving(true)
    try {
      const payload = { name: name.trim(), goal: goal || undefined, startDate: startDate || undefined, endDate: endDate || undefined }
      if (sprint) await sprintApi.update(wsId, sprint.id, payload)
      else await sprintApi.create(wsId, payload)
      queryClient.invalidateQueries({ queryKey: ['sprints', wsId] })
      queryClient.invalidateQueries({ queryKey: ['sprint-active', wsId] })
      toast(sprint ? 'Sprint aggiornata' : 'Sprint creata', 'success')
      onClose()
    } catch (err) {
      toast(getErrorMessage(err, 'Errore nel salvataggio'), 'destructive')
    } finally { setSaving(false) }
  }

  return (
    <Dialog open onOpenChange={o => { if (!o) onClose() }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{sprint ? 'Modifica sprint' : 'Nuova sprint'}</DialogTitle>
          <DialogDescription>Le date sono indicative: la sprint parte quando la avvii.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="sp-name">Nome</Label>
            <Input id="sp-name" value={name} onChange={e => setName(e.target.value)} placeholder="Es. Sprint 12" autoFocus required autoComplete="off" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="sp-goal">Obiettivo (Sprint Goal)</Label>
            <Input id="sp-goal" value={goal} onChange={e => setGoal(e.target.value)} placeholder="Cosa vogliamo ottenere?" autoComplete="off" />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="sp-start">Inizio previsto</Label>
              <Input id="sp-start" type="date" value={startDate} onChange={e => setStartDate(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="sp-end">Fine prevista</Label>
              <Input id="sp-end" type="date" value={endDate} min={startDate || undefined} onChange={e => setEndDate(e.target.value)} aria-invalid={datesInvalid || undefined} />
            </div>
          </div>
          {datesInvalid && <p className="text-xs text-destructive">La fine deve essere successiva all'inizio.</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Annulla</Button>
            <Button type="submit" loading={saving} disabled={!name.trim() || datesInvalid}>{sprint ? 'Salva' : 'Crea sprint'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/* --------------------------------------------------------- Active dashboard */

const TONE = { destructive: 'text-destructive', success: 'text-success', warning: 'text-warning' } as const

function Stat({ label, value, tone, icon: Icon }: { label: string; value: React.ReactNode; tone?: 'destructive' | 'success' | 'warning'; icon?: typeof Flag }) {
  return (
    <div className="rounded-md border bg-surface-2 px-3 py-2">
      <div className="flex items-center gap-1 text-2xs font-medium uppercase tracking-wide text-muted-foreground">
        {Icon && <Icon className="h-3 w-3" aria-hidden="true" />} {label}
      </div>
      <div className={cn('mt-0.5 text-heading tabular-nums', tone && TONE[tone])}>{value}</div>
    </div>
  )
}

function ActiveDashboard({ wsId, detail, isAdmin, canEdit, planned }: {
  wsId: string; detail: SprintDetail; isAdmin: boolean; canEdit: boolean; planned: Sprint[]
}) {
  const queryClient = useQueryClient()
  const sprint = detail.sprint!
  const tasks = detail.tasks
  const [closing, setClosing] = useState(false)

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['sprints', wsId] })
    queryClient.invalidateQueries({ queryKey: ['sprint-active', wsId] })
    queryClient.invalidateQueries({ queryKey: ['elements', wsId] })
  }

  const pct = sprint.taskTotal > 0 ? Math.round((sprint.taskCompleted / sprint.taskTotal) * 100) : 0
  const left = daysLeft(sprint.endDate)
  const blocked = useMemo(() => tasks.filter(t => t.blocked && t.status !== 'COMPLETATO'), [tasks])
  const inProgress = tasks.filter(t => t.status === 'IN_CORSO').length

  return (
    <div className="max-w-6xl space-y-4">
      {/* Avanzamento */}
      <section className="rounded-lg border bg-card p-4 shadow-xs" aria-label="Avanzamento sprint">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-heading">{sprint.name}</h2>
              {left !== null && (
                <Badge variant={left < 0 ? 'destructive' : left <= 2 ? 'warning' : 'muted'} size="sm">
                  {left >= 0 ? `${left} ${left === 1 ? 'giorno' : 'giorni'} rimanenti` : `${-left} ${left === -1 ? 'giorno' : 'giorni'} di ritardo`}
                </Badge>
              )}
            </div>
            {sprint.goal && (
              <p className="flex items-start gap-1.5 text-sm text-muted-foreground">
                <Flag className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" /> {sprint.goal}
              </p>
            )}
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <CalendarDays className="h-3.5 w-3.5" aria-hidden="true" /> {fmtDate(sprint.actualStartAt ?? sprint.startDate)} → {fmtDate(sprint.endDate)}
            </p>
          </div>
          {isAdmin && (
            <Button size="sm" variant="outline" className="shrink-0 self-start" onClick={() => setClosing(true)}>
              <CircleCheck className="h-3.5 w-3.5" /> Chiudi sprint
            </Button>
          )}
        </div>

        <div className="mt-4 space-y-1.5">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">{sprint.taskCompleted}/{sprint.taskTotal} task completati</span>
            <span className="font-medium tabular-nums">{pct}%</span>
          </div>
          <Progress value={pct} aria-label={`Avanzamento ${pct}%`} />
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="Completati" value={`${sprint.taskCompleted}/${sprint.taskTotal}`} tone={pct === 100 && sprint.taskTotal > 0 ? 'success' : undefined} />
          <Stat label="In corso" value={inProgress} />
          <Stat label="Bloccanti" value={blocked.length} tone={blocked.length > 0 ? 'destructive' : undefined} icon={blocked.length > 0 ? TriangleAlert : undefined} />
          <Stat label="Giorni" value={left === null ? '—' : left >= 0 ? left : `+${-left}`} tone={left !== null && left < 0 ? 'destructive' : undefined} />
        </div>
      </section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="min-w-0 space-y-4 lg:col-span-2">
          <section className="space-y-3" aria-label="Board della sprint">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold">Board</h3>
              {canEdit && <AddTaskControl wsId={wsId} sprintId={sprint.id} onAdded={refresh} />}
            </div>
            <SprintBoard wsId={wsId} sprintId={sprint.id} tasks={tasks} canEdit={canEdit} onChange={refresh} />
          </section>
          <SprintTimeline sprint={sprint} tasks={tasks} />
        </div>

        <div className="min-w-0 space-y-4">
          {blocked.length > 0 && <BlockedTasks wsId={wsId} tasks={blocked} />}
          {sprint.channelId
            ? <SprintChat wsId={wsId} channelId={sprint.channelId} />
            : (
              <EmptyState icon={MessageSquare} size="sm" bordered title="Chat non disponibile" description="Questa sprint non ha un canale collegato." />
            )}
        </div>
      </div>

      {closing && (
        <CloseSprintDialog
          wsId={wsId}
          sprint={sprint}
          incompleteCount={tasks.filter(t => t.status !== 'COMPLETATO').length}
          planned={planned}
          onClose={() => setClosing(false)}
          onClosed={() => { setClosing(false); refresh() }}
        />
      )}
    </div>
  )
}

/* -------------------------------------------------------------------- Board */

function SprintBoard({ wsId, sprintId, tasks, canEdit, onChange }: {
  wsId: string; sprintId: string; tasks: Element[]; canEdit: boolean; onChange: () => void
}) {
  const queryClient = useQueryClient()
  const byStatus = useMemo(() => {
    const m: Record<string, Element[]> = { DA_FARE: [], IN_CORSO: [], COMPLETATO: [] }
    for (const t of tasks) m[t.status]?.push(t)
    return m
  }, [tasks])

  const setStatus = async (task: Element, status: ElementStatus) => {
    if (task.status === status) return
    // Aggiornamento ottimistico della sprint attiva.
    const key = ['sprint-active', wsId]
    void queryClient.cancelQueries({ queryKey: key })
    const prev = queryClient.getQueryData<SprintDetail>(key)
    if (prev) {
      queryClient.setQueryData<SprintDetail>(key, {
        ...prev,
        tasks: prev.tasks.map(t => (t.id === task.id ? { ...t, status } : t)),
      })
    }
    try { await elementsApi.update(wsId, task.id, { status }); onChange() }
    catch (e) { toast(getErrorMessage(e), 'destructive'); onChange() }
  }
  const toggleBlocked = async (task: Element) => {
    try { await elementsApi.update(wsId, task.id, { blocked: !task.blocked }); onChange() }
    catch (e) { toast(getErrorMessage(e), 'destructive') }
  }
  const removeFromSprint = async (task: Element) => {
    try { await sprintApi.removeTask(wsId, sprintId, task.id); onChange(); toast('Task rimosso dalla sprint') }
    catch (e) { toast(getErrorMessage(e), 'destructive') }
  }

  const onDragEnd = (r: DropResult) => {
    if (!r.destination) return
    const task = tasks.find(t => t.id === r.draggableId)
    if (task) void setStatus(task, r.destination.droppableId as ElementStatus)
  }

  return (
    <DragDropContext onDragEnd={onDragEnd}>
      <div className="-mx-3 flex snap-x snap-mandatory scroll-px-3 gap-2 overflow-x-auto px-3 pb-2 sm:mx-0 sm:grid sm:grid-cols-3 sm:gap-3 sm:overflow-visible sm:px-0 sm:pb-0">
        {COLUMN_STATUSES.map(status => (
          <Droppable key={status} droppableId={status}>
            {(provided, snapshot) => (
              <div className="flex w-[82%] max-w-xs shrink-0 snap-start flex-col sm:w-auto sm:max-w-none">
                <div className="mb-1.5 flex items-center gap-1.5 px-1 text-xs font-medium text-muted-foreground">
                  <StatusIcon status={status} size="sm" />
                  {STATUS_LABEL[status]}
                  <span className="rounded-full bg-muted px-1.5 text-2xs tabular-nums">{byStatus[status].length}</span>
                </div>
                <div
                  ref={provided.innerRef}
                  {...provided.droppableProps}
                  aria-label={STATUS_LABEL[status]}
                  className={cn(
                    'min-h-24 flex-1 space-y-2 rounded-lg border border-transparent bg-surface-2 p-1.5 transition-colors',
                    snapshot.isDraggingOver && 'border-dashed border-primary/50 bg-primary/5'
                  )}
                >
                  {byStatus[status].map((t, i) => (
                    <SprintTaskCard
                      key={t.id}
                      index={i}
                      wsId={wsId}
                      task={t}
                      canEdit={canEdit}
                      onMove={setStatus}
                      onToggleBlocked={toggleBlocked}
                      onRemove={removeFromSprint}
                    />
                  ))}
                  {provided.placeholder}
                  {byStatus[status].length === 0 && !snapshot.isDraggingOver && (
                    <p className="select-none py-4 text-center text-2xs text-muted-foreground/70">Nessun task</p>
                  )}
                </div>
              </div>
            )}
          </Droppable>
        ))}
      </div>
    </DragDropContext>
  )
}

const SprintTaskCard = memo(function SprintTaskCard({ wsId, task, index, canEdit, onMove, onToggleBlocked, onRemove }: {
  wsId: string; task: Element; index: number; canEdit: boolean
  onMove: (t: Element, s: ElementStatus) => void
  onToggleBlocked: (t: Element) => void
  onRemove: (t: Element) => void
}) {
  return (
    <Draggable draggableId={task.id} index={index} isDragDisabled={!canEdit}>
      {(provided, snapshot) => (
        <TaskCard
          ref={provided.innerRef}
          {...provided.draggableProps}
          {...provided.dragHandleProps}
          style={provided.draggableProps.style as React.CSSProperties}
          density="compact"
          title={task.title}
          href={`/workspace/${wsId}/element/${task.id}`}
          status={task.status}
          tags={task.tags}
          assignees={task.assignees}
          dueDate={task.endDate}
          blocked={task.blocked}
          dragging={snapshot.isDragging}
          className={cn('outline-none focus-visible:ring-2 focus-visible:ring-ring', canEdit && 'cursor-grab active:cursor-grabbing')}
          actions={canEdit ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <IconButton size="xs" label="Azioni task" icon={<MoreHorizontal />} noTooltip onClick={e => e.stopPropagation()} />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52" onClick={e => e.stopPropagation()}>
                <DropdownMenuLabel>Sposta in</DropdownMenuLabel>
                {COLUMN_STATUSES.map(s => (
                  <DropdownMenuItem key={s} disabled={task.status === s} onSelect={() => onMove(task, s)}>
                    <StatusIcon status={s} size="sm" /> {MOVE_LABEL[s]}
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => onToggleBlocked(task)}>
                  <TriangleAlert className="h-3.5 w-3.5" /> {task.blocked ? 'Sblocca' : 'Segna come bloccante'}
                </DropdownMenuItem>
                <DropdownMenuItem destructive onSelect={() => onRemove(task)}>
                  <X className="h-3.5 w-3.5" /> Rimuovi dalla sprint
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : undefined}
        />
      )}
    </Draggable>
  )
})

function AddTaskControl({ wsId, sprintId, onAdded }: { wsId: string; sprintId: string; onAdded: () => void }) {
  const elementsQuery = useQuery<Element[]>({
    queryKey: ['elements', wsId],
    queryFn: () => elementsApi.list(wsId),
    enabled: !!wsId,
  })
  const elements = elementsQuery.data
  const candidates = useMemo(
    () => (elements ?? []).filter(e => e.type === 'TASK' && !e.sprintId && e.status !== 'ARCHIVIATO'),
    [elements],
  )
  const add = async (elementId: string) => {
    try { await sprintApi.addTask(wsId, sprintId, elementId); onAdded(); toast('Task aggiunto alla sprint', 'success') }
    catch (e) { toast(getErrorMessage(e), 'destructive') }
  }
  if (elementsQuery.isError) {
    return (
      <Button size="sm" variant="outline" onClick={() => void elementsQuery.refetch()}>
        Impossibile caricare i task · Riprova
      </Button>
    )
  }
  const disabled = elementsQuery.isLoading || candidates.length === 0
  return (
    <Select value="" onValueChange={add} disabled={disabled}>
      <SelectTrigger className="h-8 w-full text-sm sm:w-64" aria-label="Aggiungi un task alla sprint">
        <SelectValue
          placeholder={
            elementsQuery.isLoading ? 'Caricamento task…'
              : candidates.length === 0 ? 'Nessun task disponibile da aggiungere'
                : '+ Aggiungi un task alla sprint'
          }
        />
      </SelectTrigger>
      <SelectContent>
        {candidates.map(t => (
          <SelectItem key={t.id} value={t.id}>
            <span className="flex items-center gap-2"><StatusIcon status={t.status} size="sm" /> {t.title}</span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function BlockedTasks({ wsId, tasks }: { wsId: string; tasks: Element[] }) {
  return (
    <section className="rounded-lg border border-destructive/30 bg-card shadow-xs" aria-label="Task bloccanti">
      <div className="flex items-center gap-2 border-b px-3 py-2 text-sm font-medium">
        <TriangleAlert className="h-4 w-4 text-destructive" aria-hidden="true" />
        Task bloccanti
        <Badge variant="destructive" size="sm" className="ml-auto">{tasks.length}</Badge>
      </div>
      <ul className="divide-y">
        {tasks.map(t => (
          <li key={t.id}>
            <Link
              to={`/workspace/${wsId}/element/${t.id}`}
              className="flex items-center gap-2 px-3 py-2 text-sm transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
            >
              <StatusIcon status={t.status} size="sm" />
              <span className="min-w-0 flex-1 truncate">{t.title}</span>
              {t.assignees[0] && <UserAvatar name={t.assignees[0].displayName} avatar={t.assignees[0].avatar} size="xs" />}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}

function SprintTimeline({ sprint, tasks }: { sprint: Sprint; tasks: Element[] }) {
  const done = useMemo(
    () => tasks
      .filter(t => t.status === 'COMPLETATO' && t.completedAt)
      .sort((a, b) => new Date(a.completedAt!).getTime() - new Date(b.completedAt!).getTime()),
    [tasks]
  )

  const start = sprint.actualStartAt ? new Date(sprint.actualStartAt).getTime() : (sprint.startDate ? new Date(sprint.startDate).getTime() : Date.now())
  const end = sprint.endDate ? new Date(sprint.endDate).getTime() : Date.now()
  const span = Math.max(end - start, 1)
  const pos = (ms: number) => Math.min(100, Math.max(0, ((ms - start) / span) * 100))
  const today = pos(Date.now())

  return (
    <section className="rounded-lg border bg-card p-4 shadow-xs" aria-label="Timeline completamenti">
      <div className="mb-4 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Timeline completamenti</h3>
        <span className="text-xs tabular-nums text-muted-foreground">{done.length} completati</span>
      </div>
      {done.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nessun task ancora completato.</p>
      ) : (
        <div className="relative mx-1.5 h-8">
          <div className="absolute left-0 right-0 top-1/2 h-px bg-border" />
          <div className="absolute top-0 h-full w-px bg-primary/40" style={{ left: `${today}%` }} aria-hidden="true">
            <span className="absolute -top-3.5 left-1/2 -translate-x-1/2 text-2xs text-muted-foreground">oggi</span>
          </div>
          {done.map(t => (
            <SimpleTooltip key={t.id} content={`${t.title} · ${fmtDate(t.completedAt)}`}>
              <button
                type="button"
                aria-label={`${t.title}, completato il ${fmtDate(t.completedAt)}`}
                className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-card bg-success transition-transform hover:scale-125 focus-visible:scale-125 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                style={{ left: `${pos(new Date(t.completedAt!).getTime())}%` }}
              />
            </SimpleTooltip>
          ))}
        </div>
      )}
      <div className="mt-2 flex justify-between text-2xs text-muted-foreground">
        <span>{fmtDate(sprint.actualStartAt ?? sprint.startDate)}</span>
        <span>{fmtDate(sprint.endDate)}</span>
      </div>
    </section>
  )
}

/* --------------------------------------------------------------------- Chat */

function SprintChat({ wsId, channelId }: { wsId: string; channelId: string }) {
  const queryClient = useQueryClient()
  const meId = useAuthStore(s => s.user?.id)
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  const messagesQuery = useQuery<ChatMessage[]>({
    queryKey: ['sprint-chat', channelId],
    queryFn: () => channelsApi.getMessages(wsId, channelId),
  })
  const messages = messagesQuery.data

  // Il Layout aggiorna solo la lista canali sui MESSAGE_CREATED: qui ricarichiamo i messaggi
  // del solo canale della sprint.
  useWorkspaceEvents(wsId, ev => {
    if (ev.type === 'MESSAGE_CREATED' && (ev.payload as { channelId?: string } | undefined)?.channelId === channelId) {
      queryClient.invalidateQueries({ queryKey: ['sprint-chat', channelId] })
    }
  })

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [messages])

  const send = async (e: React.FormEvent) => {
    e.preventDefault()
    const content = text.trim()
    if (!content || sending) return
    setText('')
    setSending(true)
    try {
      await channelsApi.sendMessage(wsId, channelId, content)
      queryClient.invalidateQueries({ queryKey: ['sprint-chat', channelId] })
    } catch {
      setText(content)
      toast("Errore nell'invio", 'destructive')
    } finally { setSending(false) }
  }

  return (
    <section className="flex h-[28rem] flex-col rounded-lg border bg-card shadow-xs" aria-label="Chat della sprint">
      <div className="flex items-center gap-2 border-b px-3 py-2 text-sm font-medium">
        <MessageSquare className="h-4 w-4 text-muted-foreground" aria-hidden="true" /> Chat della sprint
      </div>
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-2" aria-live="polite">
        <QueryState
          query={messagesQuery}
          skeleton="spinner"
          empty={{ icon: MessageSquare, size: 'sm', title: 'Nessun messaggio', description: 'Inizia la conversazione con il team.' }}
        >
          {(list: ChatMessage[]) => (
            <ul className="space-y-1">
              {list.map((m, i) => {
                const mine = m.authorId === meId
                const prev = list[i - 1]
                const grouped = !!prev && prev.authorId === m.authorId &&
                  new Date(m.createdAt).getTime() - new Date(prev.createdAt).getTime() < 5 * 60_000
                const time = new Date(m.createdAt).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })
                return (
                  <li key={m.id} className={cn('flex gap-2', mine && 'flex-row-reverse', !grouped && i > 0 && 'pt-2')}>
                    <div className="w-6 shrink-0">
                      {!mine && !grouped && <UserAvatar name={m.authorName} avatar={m.authorAvatar} size="sm" />}
                    </div>
                    <div className={cn('flex min-w-0 max-w-[85%] flex-col', mine && 'items-end')}>
                      {!grouped && (
                        <div className="mb-0.5 text-2xs text-muted-foreground">
                          {mine ? 'Tu' : m.authorName} · {time}
                        </div>
                      )}
                      <div
                        className={cn(
                          'whitespace-pre-wrap break-words rounded-lg px-2.5 py-1.5 text-sm',
                          mine ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground'
                        )}
                      >
                        {m.content}
                      </div>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </QueryState>
      </div>
      <form onSubmit={send} className="flex items-center gap-2 border-t p-2">
        <Input
          value={text}
          onChange={e => setText(e.target.value)}
          placeholder="Scrivi un messaggio…"
          aria-label="Messaggio"
          className="h-9"
        />
        <IconButton type="submit" variant="default" size="default" label="Invia" icon={<Send />} disabled={!text.trim()} loading={sending} />
      </form>
    </section>
  )
}

/* -------------------------------------------------------------- Close sprint */

function CloseSprintDialog({ wsId, sprint, incompleteCount, planned, onClose, onClosed }: {
  wsId: string; sprint: Sprint; incompleteCount: number; planned: Sprint[]; onClose: () => void; onClosed: () => void
}) {
  const [retrospective, setRetrospective] = useState('')
  const [carryOver, setCarryOver] = useState<'BACKLOG' | 'NEXT_SPRINT'>('BACKLOG')
  const [targetSprintId, setTargetSprintId] = useState<string>(planned[0]?.id ?? '')
  const [saving, setSaving] = useState(false)

  const submit = async () => {
    if (carryOver === 'NEXT_SPRINT' && !targetSprintId) {
      toast('Seleziona la sprint di destinazione o scegli il backlog.', 'destructive'); return
    }
    setSaving(true)
    try {
      await sprintApi.close(wsId, sprint.id, {
        retrospective: retrospective || undefined,
        carryOver,
        targetSprintId: carryOver === 'NEXT_SPRINT' ? targetSprintId : undefined,
      })
      toast('Sprint chiusa', 'success')
      onClosed()
    } catch (e) {
      toast(getErrorMessage(e, 'Errore nella chiusura'), 'destructive')
    } finally { setSaving(false) }
  }

  const options: { value: 'BACKLOG' | 'NEXT_SPRINT'; title: string; desc: string; disabled?: boolean }[] = [
    { value: 'BACKLOG', title: 'Riporta nel backlog', desc: 'I task tornano nel backlog generale del workspace.' },
    {
      value: 'NEXT_SPRINT',
      title: 'Sposta in una sprint successiva',
      desc: planned.length ? 'Scegli una delle sprint pianificate.' : 'Nessuna sprint pianificata disponibile.',
      disabled: planned.length === 0,
    },
  ]

  return (
    <Dialog open onOpenChange={o => { if (!o && !saving) onClose() }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Chiudi «{sprint.name}»</DialogTitle>
          <DialogDescription>
            {sprint.taskCompleted}/{sprint.taskTotal} task completati. La sprint finirà nell'archivio con la sua retrospettiva.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-5">
          {incompleteCount > 0 && (
            <fieldset className="space-y-2">
              <legend className="text-sm">
                Ci sono <strong>{incompleteCount}</strong> task non completati. Cosa farne?
              </legend>
              <div className="grid gap-2">
                {options.map(o => (
                  <label
                    key={o.value}
                    className={cn(
                      'flex cursor-pointer items-start gap-3 rounded-md border p-3 transition-colors hover:bg-accent',
                      'has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring',
                      carryOver === o.value && 'border-primary bg-primary/5',
                      o.disabled && 'cursor-not-allowed opacity-50 hover:bg-transparent'
                    )}
                  >
                    <input
                      type="radio"
                      name="carry-over"
                      className="mt-0.5 accent-primary"
                      checked={carryOver === o.value}
                      onChange={() => setCarryOver(o.value)}
                      disabled={o.disabled}
                    />
                    <span className="space-y-0.5">
                      <span className="block text-sm font-medium">{o.title}</span>
                      <span className="block text-xs text-muted-foreground">{o.desc}</span>
                    </span>
                  </label>
                ))}
              </div>
              {carryOver === 'NEXT_SPRINT' && (
                <Select value={targetSprintId} onValueChange={setTargetSprintId}>
                  <SelectTrigger className="h-9" aria-label="Sprint di destinazione"><SelectValue placeholder="Scegli sprint" /></SelectTrigger>
                  <SelectContent>
                    {planned.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}
            </fieldset>
          )}
          <div className="space-y-2">
            <Label htmlFor="retro">Note di retrospettiva <span className="font-normal text-muted-foreground">(opzionale)</span></Label>
            <Textarea
              id="retro"
              value={retrospective}
              onChange={e => setRetrospective(e.target.value)}
              rows={4}
              autoResize
              placeholder="Cosa è andato bene, cosa migliorare…"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Annulla</Button>
          <Button variant="destructive" onClick={submit} loading={saving}>Chiudi sprint</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/* ------------------------------------------------------------------ Archive */

function ClosedSprintCard({ sprint }: { sprint: Sprint }) {
  const pct = sprint.taskTotal > 0 ? Math.round((sprint.taskCompleted / sprint.taskTotal) * 100) : 0
  return (
    <article className="rounded-lg border bg-card p-4 shadow-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{sprint.name}</h3>
        <Badge variant={pct === 100 ? 'success' : 'muted'} size="sm" className="tabular-nums">
          {sprint.taskCompleted}/{sprint.taskTotal} · {pct}%
        </Badge>
      </div>
      {sprint.goal && (
        <p className="mt-1 flex items-start gap-1.5 text-sm text-muted-foreground">
          <Flag className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" /> {sprint.goal}
        </p>
      )}
      <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
        <CalendarDays className="h-3.5 w-3.5" aria-hidden="true" />
        {fmtDate(sprint.actualStartAt ?? sprint.startDate)} → {fmtDate(sprint.actualEndAt ?? sprint.endDate)}
      </p>
      <Progress value={pct} className="mt-3" aria-label={`Completamento ${pct}%`} />
      {sprint.retrospectiveMd && (
        <div className="mt-3 rounded-md border bg-surface-2 p-3">
          <div className="mb-1 text-2xs font-medium uppercase tracking-wide text-muted-foreground">Retrospettiva</div>
          <p className="whitespace-pre-wrap text-sm">{sprint.retrospectiveMd}</p>
        </div>
      )}
    </article>
  )
}
