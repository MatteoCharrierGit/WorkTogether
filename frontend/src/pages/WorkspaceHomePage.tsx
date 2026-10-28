import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Building2, ChevronRight, Plus, SearchX } from 'lucide-react'
import { workspacesApi } from '@/lib/api'
import { Workspace } from '@/types'
import { useWorkspaceStore } from '@/store/workspaceStore'
import { useAuthStore } from '@/store/authStore'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState, QueryState } from '@/components/shared'
import { CreateWorkspaceDialog } from '@/components/CreateWorkspaceDialog'
import { WorkspaceAvatar } from '@/components/layout/WorkspaceAvatar'
import { ROLE_LABELS } from '@/components/layout/nav'

/**
 * Ingresso dell'area autenticata.
 *  - `/workspace/:wsId` → imposta il workspace corrente e apre la sua Kanban.
 *  - `/` → apre l'ultimo workspace usato (o il primo) sulla Kanban.
 * Mostra contenuto solo mentre carica, se non ci sono workspace, o se il workspace richiesto
 * non è tra quelli dell'utente.
 */
export default function WorkspaceHomePage() {
  const navigate = useNavigate()
  const { wsId } = useParams<{ wsId?: string }>()
  const currentId = useWorkspaceStore(s => s.current?.id)
  const setCurrent = useWorkspaceStore(s => s.setCurrent)
  const isSystemAdmin = useAuthStore(s => !!s.user?.systemAdmin)
  const [createOpen, setCreateOpen] = useState(false)

  const query = useQuery<Workspace[]>({
    queryKey: ['workspaces'],
    queryFn: workspacesApi.list,
  })
  const workspaces = query.data

  // Destinazione del redirect (null = restiamo qui e mostriamo la pagina).
  const target = !workspaces
    ? null
    : wsId
      ? workspaces.find(w => w.id === wsId) ?? null
      : (currentId && workspaces.find(w => w.id === currentId)) || workspaces[0] || null

  useEffect(() => {
    if (!target) return
    setCurrent(target)
    navigate(`/workspace/${target.id}/kanban`, { replace: true })
  }, [target, setCurrent, navigate])

  const createAction = isSystemAdmin && (
    <Button onClick={() => setCreateOpen(true)}>
      <Plus className="h-4 w-4" /> Crea workspace
    </Button>
  )

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6 sm:py-12">
        <QueryState
          query={query}
          loading={<HomeSkeleton />}
          errorTitle="Impossibile caricare i workspace"
          isEmpty={(d: Workspace[] | undefined) => !d || d.length === 0}
          empty={
            <EmptyState
              icon={Building2}
              title="Nessun workspace"
              description={isSystemAdmin
                ? 'Crea il primo workspace per iniziare a organizzare progetti, file e chat del team.'
                : 'Non fai ancora parte di nessun workspace. Chiedi a un amministratore di invitarti.'}
              action={createAction}
              bordered
            />
          }
        >
          {(list: Workspace[]) =>
            target ? (
              <HomeSkeleton />
            ) : (
              // Solo con un wsId non valido: il workspace non esiste o non se ne fa parte.
              <div className="space-y-6">
                <EmptyState
                  icon={SearchX}
                  title="Workspace non disponibile"
                  description="Il workspace richiesto non esiste più oppure non ne fai parte. Scegline uno dai tuoi."
                  size="sm"
                />
                <WorkspaceList workspaces={list} onPick={ws => setCurrent(ws)} />
                {createAction && <div className="flex justify-center">{createAction}</div>}
              </div>
            )
          }
        </QueryState>
      </div>
      <CreateWorkspaceDialog open={createOpen} onClose={() => setCreateOpen(false)} />
    </div>
  )
}

function WorkspaceList({ workspaces, onPick }: { workspaces: Workspace[]; onPick: (ws: Workspace) => void }) {
  return (
    <section aria-labelledby="ws-list-title" className="space-y-2">
      <h2 id="ws-list-title" className="px-1 text-caption font-medium uppercase tracking-wider text-muted-foreground">
        I tuoi workspace
      </h2>
      <ul className="divide-y overflow-hidden rounded-lg border bg-card">
        {workspaces.map(ws => (
          <li key={ws.id}>
            <Link
              to={`/workspace/${ws.id}/kanban`}
              onClick={() => onPick(ws)}
              className="flex items-center gap-3 px-3 py-3 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            >
              <WorkspaceAvatar name={ws.name} avatar={ws.avatar} size="lg" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{ws.name}</span>
                <span className="block truncate text-caption text-muted-foreground">
                  {ws.description || (ROLE_LABELS[ws.myRole] ?? ws.myRole)}
                </span>
              </span>
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}

function HomeSkeleton() {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="Caricamento">
      <Skeleton className="h-4 w-32" />
      <div className="divide-y rounded-lg border">
        {[0, 1, 2].map(i => (
          <div key={i} className="flex items-center gap-3 px-3 py-3">
            <Skeleton className="h-10 w-10 rounded-lg" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-3.5 w-1/3" />
              <Skeleton className="h-3 w-1/2" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
