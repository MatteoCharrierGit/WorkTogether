import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { sprintApi, elementsApi, channelsApi } from '@/lib/api'
import { Sprint, SprintDetail, Element, ChatMessage, ElementStatus } from '@/types'
import { useWorkspaceStore } from '@/store/workspaceStore'
import { useAuthStore } from '@/store/authStore'
import { subscribeWorkspace } from '@/lib/websocket'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from '@/components/ui/select'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { toast } from '@/components/ui/toast'
import { cn } from '@/lib/utils'
import {
  Plus, Play, Flag, Trash2, X, AlertTriangle, Send, Target, CalendarDays, Pencil,
} from 'lucide-react'

const STATUS_LABEL: Record<string, string> = {
  DA_FARE: 'Backlog sprint',
  IN_CORSO: 'In corso',
  COMPLETATO: 'Completati',
}
const COLUMN_STATUSES: ElementStatus[] = ['DA_FARE', 'IN_CORSO', 'COMPLETATO']

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
  const queryClient = useQueryClient()
  const workspace = useWorkspaceStore(s => s.current)
  const isAdmin = workspace?.myRole === 'ADMIN'
  const canEdit = workspace?.myRole !== 'GUEST'

  const { data: sprints = [] } = useQuery<Sprint[]>({
    queryKey: ['sprints', wsId],
    queryFn: () => sprintApi.list(wsId!),
    enabled: !!wsId,
  })
  const { data: active } = useQuery<SprintDetail>({
    queryKey: ['sprint-active', wsId],
    queryFn: () => sprintApi.active(wsId!),
    enabled: !!wsId,
  })

  // Realtime: aggiorna le viste sprint sugli eventi del workspace.
  useEffect(() => {
    if (!wsId) return
    return subscribeWorkspace(wsId, ev => {
      if (ev.type === 'SPRINT_CHANGED' || ev.type.startsWith('ELEMENT_')) {
        queryClient.invalidateQueries({ queryKey: ['sprints', wsId] })
        queryClient.invalidateQueries({ queryKey: ['sprint-active', wsId] })
      }
    })
  }, [wsId, queryClient])

  const planned = sprints.filter(s => s.status === 'PLANNED')
  const closed = sprints.filter(s => s.status === 'CLOSED')
  const hasActive = !!active?.sprint

  const [tab, setTab] = useState('active')

  return (
    <div className="flex h-full flex-col p-4 md:p-6 gap-4 overflow-hidden">
      <div className="flex items-center gap-2">
        <Target className="h-5 w-5 text-primary" />
        <h1 className="text-lg font-semibold">Sprint</h1>
      </div>

      <Tabs value={tab} onValueChange={setTab} className="flex-1 flex flex-col overflow-hidden">
        <TabsList>
          <TabsTrigger value="active">Sprint attiva</TabsTrigger>
          <TabsTrigger value="planning">Planning{planned.length ? ` (${planned.length})` : ''}</TabsTrigger>
          <TabsTrigger value="archive">Archivio{closed.length ? ` (${closed.length})` : ''}</TabsTrigger>
        </TabsList>

        <TabsContent value="active" className="flex-1 overflow-y-auto mt-4">
          {hasActive
            ? <ActiveDashboard wsId={wsId!} detail={active!} isAdmin={isAdmin} canEdit={canEdit} planned={planned} />
            : <EmptyState message="Nessuna sprint attiva al momento." hint={isAdmin ? 'Vai in Planning per crearne e avviarne una.' : undefined} />}
        </TabsContent>

        <TabsContent value="planning" className="flex-1 overflow-y-auto mt-4">
          <PlanningTab wsId={wsId!} planned={planned} isAdmin={isAdmin} hasActive={hasActive} />
        </TabsContent>

        <TabsContent value="archive" className="flex-1 overflow-y-auto mt-4">
          {closed.length
            ? <div className="space-y-4 max-w-3xl">{closed.map(s => <ClosedSprintCard key={s.id} sprint={s} />)}</div>
            : <EmptyState message="Nessuna sprint chiusa." />}
        </TabsContent>
      </Tabs>
    </div>
  )
}

function EmptyState({ message, hint }: { message: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-16 text-muted-foreground">
      <Target className="h-10 w-10 mb-3 opacity-40" />
      <p className="text-sm">{message}</p>
      {hint && <p className="text-xs mt-1">{hint}</p>}
    </div>
  )
}

/* ----------------------------------------------------------------- Planning */

function PlanningTab({ wsId, planned, isAdmin, hasActive }: {
  wsId: string; planned: Sprint[]; isAdmin: boolean; hasActive: boolean
}) {
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState<Sprint | null>(null)
  const [creating, setCreating] = useState(false)

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['sprints', wsId] })
    queryClient.invalidateQueries({ queryKey: ['sprint-active', wsId] })
  }

  const start = async (s: Sprint) => {
    if (hasActive) { toast('C\'è già una sprint attiva: chiudila prima.', 'destructive'); return }
    if (!confirm(`Avviare la sprint "${s.name}"?`)) return
    try { await sprintApi.start(wsId, s.id); refresh(); toast('Sprint avviata') }
    catch (e: any) { toast(e.response?.data?.error ?? 'Errore nell\'avvio', 'destructive') }
  }
  const remove = async (s: Sprint) => {
    if (!confirm(`Eliminare la sprint pianificata "${s.name}"? I task collegati tornano al backlog.`)) return
    try { await sprintApi.delete(wsId, s.id); refresh(); toast('Sprint eliminata') }
    catch (e: any) { toast(e.response?.data?.error ?? 'Errore', 'destructive') }
  }

  return (
    <div className="space-y-4 max-w-3xl">
      {isAdmin && (
        <Button size="sm" onClick={() => setCreating(true)}>
          <Plus className="h-4 w-4 mr-1.5" /> Nuova sprint
        </Button>
      )}
      {planned.length === 0 && <EmptyState message="Nessuna sprint pianificata." />}
      {planned.map(s => (
        <div key={s.id} className="rounded-lg border p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="font-medium truncate">{s.name}</h3>
              {s.goal && <p className="text-sm text-muted-foreground mt-0.5">{s.goal}</p>}
              <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                <CalendarDays className="h-3 w-3" /> {fmtDate(s.startDate)} → {fmtDate(s.endDate)}
              </p>
            </div>
            {isAdmin && (
              <div className="flex items-center gap-1 shrink-0">
                <Button size="sm" onClick={() => start(s)}><Play className="h-4 w-4 mr-1" /> Avvia</Button>
                <Button size="sm" variant="ghost" onClick={() => setEditing(s)}><Pencil className="h-4 w-4" /></Button>
                <Button size="sm" variant="ghost" className="text-destructive" onClick={() => remove(s)}><Trash2 className="h-4 w-4" /></Button>
              </div>
            )}
          </div>
        </div>
      ))}

      {(creating || editing) && (
        <SprintFormDialog
          wsId={wsId}
          sprint={editing}
          onClose={() => { setCreating(false); setEditing(null) }}
          onSaved={() => { setCreating(false); setEditing(null); refresh() }}
        />
      )}
    </div>
  )
}

function SprintFormDialog({ wsId, sprint, onClose, onSaved }: {
  wsId: string; sprint: Sprint | null; onClose: () => void; onSaved: () => void
}) {
  const [name, setName] = useState(sprint?.name ?? '')
  const [goal, setGoal] = useState(sprint?.goal ?? '')
  const [startDate, setStartDate] = useState(sprint?.startDate ?? '')
  const [endDate, setEndDate] = useState(sprint?.endDate ?? '')
  const [saving, setSaving] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    setSaving(true)
    try {
      const payload = { name: name.trim(), goal: goal || undefined, startDate: startDate || undefined, endDate: endDate || undefined }
      if (sprint) await sprintApi.update(wsId, sprint.id, payload)
      else await sprintApi.create(wsId, payload)
      toast(sprint ? 'Sprint aggiornata' : 'Sprint creata')
      onSaved()
    } catch (err: any) {
      toast(err.response?.data?.error ?? 'Errore nel salvataggio', 'destructive')
    } finally { setSaving(false) }
  }

  return (
    <Dialog open onOpenChange={o => { if (!o) onClose() }}>
      <DialogContent>
        <DialogHeader><DialogTitle>{sprint ? 'Modifica sprint' : 'Nuova sprint'}</DialogTitle></DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div>
            <Label htmlFor="sp-name">Nome</Label>
            <Input id="sp-name" value={name} onChange={e => setName(e.target.value)} autoFocus />
          </div>
          <div>
            <Label htmlFor="sp-goal">Obiettivo (Sprint Goal)</Label>
            <Input id="sp-goal" value={goal} onChange={e => setGoal(e.target.value)} />
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <Label htmlFor="sp-start">Inizio previsto</Label>
              <Input id="sp-start" type="date" value={startDate} onChange={e => setStartDate(e.target.value)} />
            </div>
            <div className="flex-1">
              <Label htmlFor="sp-end">Fine prevista</Label>
              <Input id="sp-end" type="date" value={endDate} onChange={e => setEndDate(e.target.value)} />
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-2">
            <Button type="button" variant="ghost" onClick={onClose}>Annulla</Button>
            <Button type="submit" disabled={saving || !name.trim()}>{sprint ? 'Salva' : 'Crea'}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/* --------------------------------------------------------- Active dashboard */

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
    queryClient.invalidateQueries({ queryKey: ['elements'] })
  }

  const pct = sprint.taskTotal > 0 ? Math.round((sprint.taskCompleted / sprint.taskTotal) * 100) : 0
  const left = daysLeft(sprint.endDate)
  const blockedCount = tasks.filter(t => t.blocked && t.status !== 'COMPLETATO').length

  return (
    <div className="space-y-5 max-w-6xl">
      {/* Header */}
      <div className="rounded-lg border p-4">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <h2 className="text-base font-semibold">{sprint.name}</h2>
            {sprint.goal && <p className="text-sm text-muted-foreground mt-0.5 flex items-center gap-1"><Flag className="h-3.5 w-3.5" /> {sprint.goal}</p>}
            <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
              <CalendarDays className="h-3 w-3" /> {fmtDate(sprint.startDate)} → {fmtDate(sprint.endDate)}
              {left !== null && <span className="ml-1">· {left >= 0 ? `${left} giorni rimanenti` : `${-left} giorni di ritardo`}</span>}
            </p>
          </div>
          {isAdmin && <Button size="sm" variant="destructive" onClick={() => setClosing(true)}>Chiudi sprint</Button>}
        </div>
        <div className="mt-3">
          <div className="flex items-center justify-between text-xs mb-1">
            <span className="text-muted-foreground">{sprint.taskCompleted}/{sprint.taskTotal} task completati</span>
            <span className="font-medium">{pct}%</span>
          </div>
          <Progress value={pct} />
          {blockedCount > 0 && (
            <p className="text-xs text-destructive mt-2 flex items-center gap-1">
              <AlertTriangle className="h-3.5 w-3.5" /> {blockedCount} task {blockedCount === 1 ? 'bloccante' : 'bloccanti'}
            </p>
          )}
        </div>
      </div>

      {/* Board + chat */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-4">
          {canEdit && <AddTaskControl wsId={wsId} sprintId={sprint.id} onAdded={refresh} />}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {COLUMN_STATUSES.map(status => (
              <SprintColumn
                key={status}
                wsId={wsId}
                status={status}
                tasks={tasks.filter(t => t.status === status)}
                sprintId={sprint.id}
                canEdit={canEdit}
                onChange={refresh}
              />
            ))}
          </div>
          <SprintTimeline sprint={sprint} tasks={tasks} />
        </div>

        <div className="lg:col-span-1">
          {sprint.channelId
            ? <SprintChat wsId={wsId} channelId={sprint.channelId} />
            : <div className="rounded-lg border p-4 text-sm text-muted-foreground">Chat non disponibile.</div>}
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

function SprintColumn({ wsId, status, tasks, sprintId, canEdit, onChange }: {
  wsId: string; status: ElementStatus; tasks: Element[]; sprintId: string; canEdit: boolean; onChange: () => void
}) {
  return (
    <div className="rounded-lg border bg-muted/20 p-2">
      <div className="text-xs font-medium text-muted-foreground px-1 pb-2">{STATUS_LABEL[status]} · {tasks.length}</div>
      <div className="space-y-2">
        {tasks.map(t => <TaskCard key={t.id} wsId={wsId} task={t} sprintId={sprintId} canEdit={canEdit} onChange={onChange} />)}
        {tasks.length === 0 && <div className="text-xs text-muted-foreground/60 px-1 py-3 text-center">—</div>}
      </div>
    </div>
  )
}

function TaskCard({ wsId, task, sprintId, canEdit, onChange }: {
  wsId: string; task: Element; sprintId: string; canEdit: boolean; onChange: () => void
}) {
  const [busy, setBusy] = useState(false)

  const setStatus = async (status: string) => {
    setBusy(true)
    try { await elementsApi.update(wsId, task.id, { status }); onChange() }
    catch (e: any) { toast(e.response?.data?.error ?? 'Errore', 'destructive') }
    finally { setBusy(false) }
  }
  const toggleBlocked = async () => {
    setBusy(true)
    try { await elementsApi.update(wsId, task.id, { blocked: !task.blocked }); onChange() }
    catch (e: any) { toast(e.response?.data?.error ?? 'Errore', 'destructive') }
    finally { setBusy(false) }
  }
  const removeFromSprint = async () => {
    setBusy(true)
    try { await sprintApi.removeTask(wsId, sprintId, task.id); onChange() }
    catch (e: any) { toast(e.response?.data?.error ?? 'Errore', 'destructive') }
    finally { setBusy(false) }
  }

  return (
    <div className={cn('rounded-md border bg-background p-2 text-sm', task.blocked && task.status !== 'COMPLETATO' && 'border-destructive/50')}>
      <div className="flex items-start justify-between gap-2">
        <span className={cn('flex-1', task.status === 'COMPLETATO' && 'line-through text-muted-foreground')}>{task.title}</span>
        {canEdit && (
          <button onClick={removeFromSprint} disabled={busy} title="Rimuovi dalla sprint" className="text-muted-foreground hover:text-destructive shrink-0">
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      {task.blocked && <Badge variant="destructive" className="mt-1.5 text-[10px] py-0"><AlertTriangle className="h-2.5 w-2.5 mr-0.5" /> Bloccante</Badge>}
      {canEdit && (
        <div className="flex items-center gap-1 mt-2">
          <Select value={task.status} onValueChange={setStatus} disabled={busy}>
            <SelectTrigger className="h-7 text-xs flex-1"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="DA_FARE">Da fare</SelectItem>
              <SelectItem value="IN_CORSO">In corso</SelectItem>
              <SelectItem value="COMPLETATO">Completato</SelectItem>
            </SelectContent>
          </Select>
          <Button size="sm" variant="ghost" className="h-7 px-2" onClick={toggleBlocked} disabled={busy} title={task.blocked ? 'Sblocca' : 'Segna come bloccante'}>
            <AlertTriangle className={cn('h-3.5 w-3.5', task.blocked ? 'text-destructive' : 'text-muted-foreground')} />
          </Button>
        </div>
      )}
    </div>
  )
}

function AddTaskControl({ wsId, sprintId, onAdded }: { wsId: string; sprintId: string; onAdded: () => void }) {
  const { data: elements = [] } = useQuery<Element[]>({
    queryKey: ['elements', wsId],
    queryFn: () => elementsApi.list(wsId),
    enabled: !!wsId,
  })
  const candidates = useMemo(
    () => elements.filter(e => e.type === 'TASK' && !e.sprintId && e.status !== 'ARCHIVIATO'),
    [elements],
  )
  const add = async (elementId: string) => {
    try { await sprintApi.addTask(wsId, sprintId, elementId); onAdded(); toast('Task aggiunto alla sprint') }
    catch (e: any) { toast(e.response?.data?.error ?? 'Errore', 'destructive') }
  }
  if (candidates.length === 0) {
    return <p className="text-xs text-muted-foreground">Nessun task disponibile da aggiungere (tutti i task sono già in una sprint).</p>
  }
  return (
    <Select value="" onValueChange={add}>
      <SelectTrigger className="h-9 w-full sm:w-72"><SelectValue placeholder="+ Aggiungi un task alla sprint" /></SelectTrigger>
      <SelectContent>
        {candidates.map(t => <SelectItem key={t.id} value={t.id}>{t.title}</SelectItem>)}
      </SelectContent>
    </Select>
  )
}

function SprintTimeline({ sprint, tasks }: { sprint: Sprint; tasks: Element[] }) {
  const done = tasks
    .filter(t => t.status === 'COMPLETATO' && t.completedAt)
    .sort((a, b) => new Date(a.completedAt!).getTime() - new Date(b.completedAt!).getTime())

  const start = sprint.actualStartAt ? new Date(sprint.actualStartAt).getTime() : (sprint.startDate ? new Date(sprint.startDate).getTime() : Date.now())
  const end = sprint.endDate ? new Date(sprint.endDate).getTime() : Date.now()
  const span = Math.max(end - start, 1)
  const pos = (d: string) => Math.min(100, Math.max(0, ((new Date(d).getTime() - start) / span) * 100))

  return (
    <div className="rounded-lg border p-4">
      <h3 className="text-sm font-medium mb-3">Timeline completamenti</h3>
      {done.length === 0
        ? <p className="text-xs text-muted-foreground">Nessun task ancora completato.</p>
        : (
          <div className="relative h-10">
            <div className="absolute top-1/2 left-0 right-0 h-px bg-border" />
            {done.map(t => (
              <div key={t.id} className="absolute -translate-x-1/2 group" style={{ left: `${pos(t.completedAt!)}%`, top: '50%' }}>
                <div className="h-3 w-3 rounded-full bg-primary -translate-y-1/2" />
                <div className="absolute bottom-4 left-1/2 -translate-x-1/2 hidden group-hover:block whitespace-nowrap text-[10px] bg-popover border rounded px-1.5 py-0.5 shadow">
                  {t.title} · {fmtDate(t.completedAt)}
                </div>
              </div>
            ))}
          </div>
        )}
      <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
        <span>{fmtDate(sprint.actualStartAt ?? sprint.startDate)}</span>
        <span>{fmtDate(sprint.endDate)}</span>
      </div>
    </div>
  )
}

function SprintChat({ wsId, channelId }: { wsId: string; channelId: string }) {
  const queryClient = useQueryClient()
  const meId = useAuthStore(s => s.user?.id)
  const [text, setText] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)

  const { data: messages = [] } = useQuery<ChatMessage[]>({
    queryKey: ['sprint-chat', channelId],
    queryFn: () => channelsApi.getMessages(wsId, channelId),
  })

  useEffect(() => {
    return subscribeWorkspace(wsId, ev => {
      if (ev.type === 'MESSAGE_CREATED' && (ev.payload as any)?.channelId === channelId) {
        queryClient.invalidateQueries({ queryKey: ['sprint-chat', channelId] })
      }
    })
  }, [wsId, channelId, queryClient])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [messages])

  const send = async (e: React.FormEvent) => {
    e.preventDefault()
    const content = text.trim()
    if (!content) return
    setText('')
    try {
      await channelsApi.sendMessage(wsId, channelId, content)
      queryClient.invalidateQueries({ queryKey: ['sprint-chat', channelId] })
    } catch { toast('Errore nell\'invio', 'destructive') }
  }

  return (
    <div className="rounded-lg border flex flex-col h-[28rem]">
      <div className="px-3 py-2 border-b text-sm font-medium">Chat della sprint</div>
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-2">
        {messages.length === 0 && <p className="text-xs text-muted-foreground text-center py-4">Nessun messaggio. Inizia la conversazione.</p>}
        {messages.map(m => (
          <div key={m.id} className={cn('text-sm', m.authorId === meId && 'text-right')}>
            <div className="text-[10px] text-muted-foreground">{m.authorName} · {new Date(m.createdAt).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}</div>
            <div className={cn('inline-block rounded-lg px-2.5 py-1.5 mt-0.5 max-w-[90%] text-left', m.authorId === meId ? 'bg-primary text-primary-foreground' : 'bg-muted')}>{m.content}</div>
          </div>
        ))}
      </div>
      <form onSubmit={send} className="flex items-center gap-2 p-2 border-t">
        <Input value={text} onChange={e => setText(e.target.value)} placeholder="Scrivi un messaggio…" className="h-9" />
        <Button type="submit" size="sm" className="h-9 px-3"><Send className="h-4 w-4" /></Button>
      </form>
    </div>
  )
}

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
      toast('Sprint chiusa')
      onClosed()
    } catch (e: any) {
      toast(e.response?.data?.error ?? 'Errore nella chiusura', 'destructive')
    } finally { setSaving(false) }
  }

  return (
    <Dialog open onOpenChange={o => { if (!o) onClose() }}>
      <DialogContent>
        <DialogHeader><DialogTitle>Chiudi sprint "{sprint.name}"</DialogTitle></DialogHeader>
        <div className="space-y-4">
          {incompleteCount > 0 && (
            <div className="space-y-2">
              <p className="text-sm">Ci sono <strong>{incompleteCount}</strong> task non completati. Cosa farne?</p>
              <div className="space-y-1.5 text-sm">
                <label className="flex items-center gap-2">
                  <input type="radio" checked={carryOver === 'BACKLOG'} onChange={() => setCarryOver('BACKLOG')} />
                  Riporta nel backlog generale
                </label>
                <label className="flex items-center gap-2">
                  <input type="radio" checked={carryOver === 'NEXT_SPRINT'} onChange={() => setCarryOver('NEXT_SPRINT')} disabled={planned.length === 0} />
                  Sposta in una sprint successiva
                </label>
              </div>
              {carryOver === 'NEXT_SPRINT' && (
                <Select value={targetSprintId} onValueChange={setTargetSprintId}>
                  <SelectTrigger className="h-9"><SelectValue placeholder="Scegli sprint" /></SelectTrigger>
                  <SelectContent>
                    {planned.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}
              {planned.length === 0 && <p className="text-xs text-muted-foreground">Nessuna sprint pianificata: i task andranno nel backlog.</p>}
            </div>
          )}
          <Separator />
          <div>
            <Label htmlFor="retro">Note di retrospettiva (opzionale)</Label>
            <textarea
              id="retro"
              value={retrospective}
              onChange={e => setRetrospective(e.target.value)}
              rows={4}
              className="mt-1 w-full rounded-md border bg-background p-2 text-sm"
              placeholder="Cosa è andato bene, cosa migliorare…"
            />
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-2">
          <Button variant="ghost" onClick={onClose}>Annulla</Button>
          <Button variant="destructive" onClick={submit} disabled={saving}>Chiudi sprint</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/* ------------------------------------------------------------------ Archive */

function ClosedSprintCard({ sprint }: { sprint: Sprint }) {
  const pct = sprint.taskTotal > 0 ? Math.round((sprint.taskCompleted / sprint.taskTotal) * 100) : 0
  return (
    <div className="rounded-lg border p-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-medium">{sprint.name}</h3>
        <Badge variant="secondary">{sprint.taskCompleted}/{sprint.taskTotal} · {pct}%</Badge>
      </div>
      {sprint.goal && <p className="text-sm text-muted-foreground mt-0.5 flex items-center gap-1"><Flag className="h-3.5 w-3.5" /> {sprint.goal}</p>}
      <p className="text-xs text-muted-foreground mt-1">
        {fmtDate(sprint.actualStartAt ?? sprint.startDate)} → {fmtDate(sprint.actualEndAt ?? sprint.endDate)}
      </p>
      {sprint.retrospectiveMd && (
        <div className="mt-3 rounded-md bg-muted/40 p-3">
          <div className="text-xs font-medium mb-1">Retrospettiva</div>
          <p className="text-sm whitespace-pre-wrap">{sprint.retrospectiveMd}</p>
        </div>
      )}
    </div>
  )
}
