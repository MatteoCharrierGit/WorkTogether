import { Link, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { KanbanSquare, LayoutDashboard, Rocket } from 'lucide-react'
import { dashboardApi } from '@/lib/api'
import type { DashboardData } from '@/types'
import { useWorkspaceStore } from '@/store/workspaceStore'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState, PageHeader, QueryState } from '@/components/shared'
import { cn } from '@/lib/utils'
import { StatTiles } from '@/components/dashboard/StatTiles'
import { MyPrioritiesCard } from '@/components/dashboard/MyPrioritiesCard'
import { SprintCard } from '@/components/dashboard/SprintCard'
import { ThroughputCard } from '@/components/dashboard/ThroughputCard'
import { EpicsCard, PriorityCard, WorkloadCard } from '@/components/dashboard/BreakdownCards'
import { AiUsageCard } from '@/components/dashboard/AiUsageCard'

/** Dashboard del workspace (pagina d'ingresso): KPI, mie priorità, sprint, throughput, priorità, epiche, carico. */
export default function DashboardPage() {
  const { wsId } = useParams<{ wsId: string }>()
  const workspace = useWorkspaceStore(s => (s.current?.id === wsId ? s.current : null))
  const isAdmin = workspace?.myRole === 'ADMIN'

  const query = useQuery<DashboardData>({
    queryKey: ['dashboard', wsId],
    queryFn: () => dashboardApi.get(wsId!),
    enabled: !!wsId,
    staleTime: 30_000,
  })

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-7xl px-3 py-4 md:px-6 md:py-6">
        <PageHeader
          title="Dashboard"
          icon={LayoutDashboard}
          hideTitleOnMobile
          description={workspace?.name ?? 'Panoramica del workspace'}
          actions={
            <Button asChild variant="outline" size="sm">
              <Link to={`/workspace/${wsId}/kanban`}><KanbanSquare className="h-4 w-4" /> Apri Kanban</Link>
            </Button>
          }
        />
        <QueryState
          query={query}
          loading={<DashboardSkeleton />}
          errorTitle="Impossibile caricare la dashboard"
          isEmpty={(d: DashboardData) => isFresh(d)}
          empty={
            <EmptyState
              icon={Rocket}
              title="Il workspace è pronto"
              description="Qui vedrai avanzamento, scadenze e carico del team non appena creerai epiche e task."
              action={<Button asChild><Link to={`/workspace/${wsId}/kanban`}>Crea il primo task</Link></Button>}
              bordered
            />
          }
        >
          {(d: DashboardData) => {
            const showSprint = !!workspace?.sprintEnabled || !!d.activeSprint
            return (
              <div className="grid grid-flow-row-dense grid-cols-1 gap-3 md:grid-cols-2 md:gap-4 xl:grid-cols-3">
                <div className="md:col-span-2 xl:col-span-3">
                  <StatTiles data={d} />
                </div>
                <MyPrioritiesCard wsId={wsId!} me={d.me} />
                {showSprint && <SprintCard wsId={wsId!} sprint={d.activeSprint} />}
                <ThroughputCard
                  throughput={d.throughput}
                  className={cn(!showSprint && 'md:col-span-2 xl:col-span-2')}
                />
                <PriorityCard data={d.openByPriority} />
                <EpicsCard wsId={wsId!} epics={d.epics} />
                <WorkloadCard workload={d.workload} unassigned={d.counts.unassigned} />
                {/* Estensione "Utilizzo IA" (solo admin): vedi components/dashboard/AiUsageCard.tsx */}
                {isAdmin && <AiUsageCard wsId={wsId!} />}
              </div>
            )
          }}
        </QueryState>
      </div>
    </div>
  )
}

/** Workspace appena creato: nessun task né epica. */
function isFresh(d: DashboardData): boolean {
  const c = d.counts
  return c.todo + c.inProgress + c.done === 0 && d.epics.length === 0
}

function DashboardSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 md:gap-4 xl:grid-cols-3" aria-busy="true" aria-label="Caricamento">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:col-span-2 lg:grid-cols-5 xl:col-span-3">
        {[0, 1, 2, 3, 4].map(i => (
          <div key={i} className={cn('space-y-2 rounded-lg border p-3 sm:p-4', i === 4 && 'col-span-2 lg:col-span-1')}>
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-8 w-12" />
            <Skeleton className="h-3 w-24" />
          </div>
        ))}
      </div>
      {[0, 1, 2, 3, 4, 5].map(i => (
        <div key={i} className="space-y-4 rounded-lg border p-4">
          <div className="flex items-center gap-2.5">
            <Skeleton className="h-6 w-6 rounded-md" />
            <Skeleton className="h-4 w-32" />
          </div>
          {[0, 1, 2, 3].map(j => <Skeleton key={j} className="h-4 w-full" />)}
        </div>
      ))}
    </div>
  )
}
