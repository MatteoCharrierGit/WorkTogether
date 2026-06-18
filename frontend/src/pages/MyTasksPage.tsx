import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { usersApi, workspacesApi } from '@/lib/api'
import { Element, Workspace } from '@/types'
import { cn, STATUS_LABELS, STATUS_COLORS, TYPE_ICONS, formatDate } from '@/lib/utils'
import { CheckSquare } from 'lucide-react'

function TaskRow({ task, wsName }: { task: Element; wsName: string }) {
  const overdue =
    task.endDate &&
    task.status !== 'COMPLETATO' &&
    task.status !== 'ARCHIVIATO' &&
    new Date(task.endDate) < new Date()

  return (
    <Link
      to={`/workspace/${task.workspaceId}/element/${task.id}`}
      className="flex items-center gap-3 rounded-lg border px-4 py-2.5 hover:bg-muted/40 transition-colors"
    >
      <span className="text-sm shrink-0">{TYPE_ICONS[task.type]}</span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{task.title}</p>
        <p className="text-xs text-muted-foreground truncate">{wsName}</p>
      </div>
      {task.endDate && (
        <span className={cn('text-xs shrink-0', overdue ? 'text-destructive font-medium' : 'text-muted-foreground')}>
          {overdue ? 'Scaduto · ' : ''}{formatDate(task.endDate)}
        </span>
      )}
      <span className={cn('text-xs font-medium shrink-0 w-24 text-right', STATUS_COLORS[task.status])}>
        {STATUS_LABELS[task.status]}
      </span>
    </Link>
  )
}

export default function MyTasksPage() {
  const { data: tasks = [], isLoading } = useQuery<Element[]>({
    queryKey: ['my-tasks'],
    queryFn: usersApi.myTasks,
  })
  const { data: workspaces = [] } = useQuery<Workspace[]>({
    queryKey: ['workspaces'],
    queryFn: workspacesApi.list,
  })
  const wsName = (id: string) => workspaces.find(w => w.id === id)?.name ?? 'Workspace'

  const open = tasks.filter(t => t.status !== 'COMPLETATO' && t.status !== 'ARCHIVIATO')
  const done = tasks.filter(t => t.status === 'COMPLETATO' || t.status === 'ARCHIVIATO')

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="px-6 py-4 border-b shrink-0">
        <h1 className="text-lg font-semibold flex items-center gap-2">
          <CheckSquare className="h-5 w-5" /> Le mie task
        </h1>
        <p className="text-xs text-muted-foreground">Tutto ciò che ti è assegnato, in tutti i workspace</p>
      </div>

      <div className="flex-1 overflow-y-auto p-6 max-w-3xl w-full mx-auto space-y-6">
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Caricamento...</p>
        ) : tasks.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-center gap-2">
            <CheckSquare className="h-10 w-10 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">Nessun elemento assegnato a te.</p>
          </div>
        ) : (
          <>
            <section className="space-y-2">
              <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Da fare ({open.length})
              </h2>
              {open.length === 0 ? (
                <p className="text-sm text-muted-foreground">Niente in sospeso. 🎉</p>
              ) : (
                <div className="space-y-1.5">
                  {open.map(t => <TaskRow key={t.id} task={t} wsName={wsName(t.workspaceId)} />)}
                </div>
              )}
            </section>

            {done.length > 0 && (
              <section className="space-y-2">
                <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  Completate ({done.length})
                </h2>
                <div className="space-y-1.5 opacity-70">
                  {done.map(t => <TaskRow key={t.id} task={t} wsName={wsName(t.workspaceId)} />)}
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </div>
  )
}
