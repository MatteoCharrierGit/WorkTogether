import { memo, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { usersApi, workspacesApi } from '@/lib/api'
import { Element, Workspace } from '@/types'
import { cn, formatDate } from '@/lib/utils'
import { CalendarDays, CheckSquare, ChevronRight, PartyPopper } from 'lucide-react'
import { EmptyState, PageHeader, PriorityIndicator, priorityRank, QueryState, StatusBadge, TypeIcon } from '@/components/shared'

type GroupKey = 'overdue' | 'today' | 'week' | 'later' | 'none'

const GROUPS: { key: GroupKey; label: string; tone?: string }[] = [
  { key: 'overdue', label: 'Scadute', tone: 'text-destructive' },
  { key: 'today', label: 'Oggi', tone: 'text-warning' },
  { key: 'week', label: 'Questa settimana' },
  { key: 'later', label: 'Più avanti' },
  { key: 'none', label: 'Senza scadenza' },
]

const DAY = 86_400_000

function startOfDay(d: Date) {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x.getTime()
}

/** Raggruppa per scadenza rispetto a oggi; "questa settimana" = fino a domenica compresa. */
function groupOf(task: Element, today: number, endOfWeek: number): GroupKey {
  if (!task.endDate) return 'none'
  const d = new Date(task.endDate)
  if (isNaN(d.getTime())) return 'none'
  const day = startOfDay(d)
  if (day < today) return 'overdue'
  if (day === today) return 'today'
  if (day <= endOfWeek) return 'week'
  return 'later'
}

const TaskRow = memo(function TaskRow({ task, wsName, overdue }: { task: Element; wsName: string; overdue?: boolean }) {
  const done = task.status === 'COMPLETATO' || task.status === 'ARCHIVIATO'
  return (
    <li>
      <Link
        to={`/workspace/${task.workspaceId}/element/${task.id}`}
        className="group flex items-start gap-3 px-3 py-2.5 transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none sm:items-center"
      >
        <TypeIcon type={task.type} size="sm" labelled className="mt-0.5 sm:mt-0" />
        {!done && task.priority && task.priority !== 'NONE' && (
          <PriorityIndicator priority={task.priority} className="mt-0.5 sm:mt-0" />
        )}
        <div className="min-w-0 flex-1 sm:flex sm:items-center sm:gap-3">
          <p className={cn('truncate text-sm font-medium sm:flex-1', done && 'text-muted-foreground line-through')}>{task.title}</p>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 sm:mt-0 sm:shrink-0 sm:flex-nowrap">
            <span className="max-w-40 truncate rounded-sm border bg-surface-2 px-1.5 text-2xs text-muted-foreground" title={wsName}>
              {wsName}
            </span>
            {task.endDate && (
              <span className={cn('inline-flex items-center gap-1 text-xs tabular-nums', overdue ? 'font-medium text-destructive' : 'text-muted-foreground')}>
                <CalendarDays className="h-3 w-3" aria-hidden="true" />
                {formatDate(task.endDate)}
                {overdue && <span className="sr-only">(scaduto)</span>}
              </span>
            )}
            <StatusBadge status={task.status} size="sm" className="sm:w-24 sm:justify-center" />
          </div>
        </div>
      </Link>
    </li>
  )
})

function Section({ title, count, tone, children, collapsible, defaultOpen = true }: {
  title: string; count: number; tone?: string; children: React.ReactNode; collapsible?: boolean; defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  const heading = (
    <>
      {collapsible && <ChevronRight className={cn('h-3.5 w-3.5 transition-transform', open && 'rotate-90')} aria-hidden="true" />}
      <span className={tone}>{title}</span>
      <span className="rounded-full bg-muted px-1.5 text-2xs tabular-nums text-muted-foreground">{count}</span>
    </>
  )
  return (
    <section className="space-y-2">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {collapsible ? (
          <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open} className="focus-ring -mx-1 flex items-center gap-1.5 rounded-sm px-1 hover:text-foreground">
            {heading}
          </button>
        ) : (
          <span className="flex items-center gap-1.5">{heading}</span>
        )}
      </h2>
      {open && <ul className="divide-y overflow-hidden rounded-lg border bg-card shadow-xs">{children}</ul>}
    </section>
  )
}

export default function MyTasksPage() {
  const tasksQuery = useQuery<Element[]>({
    queryKey: ['my-tasks'],
    queryFn: usersApi.myTasks,
  })
  const { data: workspaces } = useQuery<Workspace[]>({
    queryKey: ['workspaces'],
    queryFn: workspacesApi.list,
  })

  const wsNames = useMemo(() => new Map((workspaces ?? []).map(w => [w.id, w.name])), [workspaces])
  const wsName = (id: string) => wsNames.get(id) ?? 'Workspace'

  const { groups, done, openCount } = useMemo(() => {
    const tasks = tasksQuery.data ?? []
    const now = new Date()
    const today = startOfDay(now)
    // Domenica della settimana corrente (lunedì = primo giorno).
    const dow = (now.getDay() + 6) % 7
    const endOfWeek = today + (6 - dow) * DAY
    const g: Record<GroupKey, Element[]> = { overdue: [], today: [], week: [], later: [], none: [] }
    const completed: Element[] = []
    for (const t of tasks) {
      if (t.status === 'COMPLETATO' || t.status === 'ARCHIVIATO') completed.push(t)
      else g[groupOf(t, today, endOfWeek)].push(t)
    }
    // In ogni gruppo: priorità più alta prima, poi scadenza più vicina.
    const due = (t: Element) => (t.endDate ? new Date(t.endDate).getTime() : Infinity)
    const byPriorityThenDue = (a: Element, b: Element) =>
      priorityRank(b.priority) - priorityRank(a.priority) || (due(a) === due(b) ? 0 : due(a) < due(b) ? -1 : 1)
    for (const k of Object.keys(g) as GroupKey[]) g[k].sort(byPriorityThenDue)
    return { groups: g, done: completed, openCount: tasks.length - completed.length }
  }, [tasksQuery.data])

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl px-3 py-4 md:px-6 md:py-6">
          <PageHeader
            title="Le mie task"
            icon={CheckSquare}
            hideTitleOnMobile
            description="Tutto ciò che ti è assegnato, in tutti i workspace"
          />
          <QueryState
            query={tasksQuery}
            skeleton="list"
            rows={6}
            empty={{
              icon: CheckSquare,
              title: 'Nessun elemento assegnato a te',
              description: 'Quando qualcuno ti assegna un task, lo trovi qui raggruppato per scadenza.',
              bordered: true,
            }}
          >
            <div className="space-y-6">
              {openCount === 0 ? (
                <EmptyState icon={PartyPopper} title="Niente in sospeso" description="Hai completato tutto quello che ti era assegnato." bordered size="sm" />
              ) : (
                GROUPS.map(({ key, label, tone }) =>
                  groups[key].length > 0 ? (
                    <Section key={key} title={label} count={groups[key].length} tone={tone}>
                      {groups[key].map(t => (
                        <TaskRow key={t.id} task={t} wsName={wsName(t.workspaceId)} overdue={key === 'overdue'} />
                      ))}
                    </Section>
                  ) : null
                )
              )}

              {done.length > 0 && (
                <Section title="Completate" count={done.length} collapsible defaultOpen={false}>
                  {done.map(t => <TaskRow key={t.id} task={t} wsName={wsName(t.workspaceId)} />)}
                </Section>
              )}
            </div>
          </QueryState>
        </div>
      </div>
    </div>
  )
}
