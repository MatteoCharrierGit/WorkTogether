import { useCallback, useEffect, useMemo, useRef } from 'react'
import { Navigate, useParams, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Bot, Building2, DatabaseBackup, Hash, KeyRound, Shield, Tag as TagIcon, Users, type LucideIcon } from 'lucide-react'
import { workspacesApi, tagsApi, apiKeysApi } from '@/lib/api'
import type { ApiKey, Member, Tag, Workspace } from '@/types'
import { Skeleton } from '@/components/ui/skeleton'
import { PageHeader } from '@/components/shared'
import { cn } from '@/lib/utils'
import { MembersTab } from './MembersTab'
import { TagsTab } from './TagsTab'
import { WorkspaceTab } from './WorkspaceTab'
import { ApiKeysTab } from './ApiKeysTab'
import { RoomsTab } from './RoomsTab'
import { AiTab } from './AiTab'
import { BackupTab } from './BackupTab'

type TabId = 'members' | 'tags' | 'workspace' | 'integrations' | 'rooms' | 'ai' | 'backup'

interface TabDef { id: TabId; label: string; icon: LucideIcon; group: string }

const TABS: TabDef[] = [
  { id: 'workspace', label: 'Generale', icon: Building2, group: 'Workspace' },
  { id: 'members', label: 'Membri', icon: Users, group: 'Workspace' },
  { id: 'tags', label: 'Tag', icon: TagIcon, group: 'Workspace' },
  { id: 'rooms', label: 'Stanze', icon: Hash, group: 'Workspace' },
  { id: 'ai', label: 'Agente AI', icon: Bot, group: 'Integrazioni' },
  { id: 'integrations', label: 'API key', icon: KeyRound, group: 'Integrazioni' },
  { id: 'backup', label: 'Backup', icon: DatabaseBackup, group: 'Dati' },
]
const TAB_IDS = new Set<string>(TABS.map(t => t.id))
const GROUPS = Array.from(new Set(TABS.map(t => t.group)))

function NavItem({ tab, active, count, onSelect }: { tab: TabDef; active: boolean; count?: number; onSelect: (id: TabId) => void }) {
  const Icon = tab.icon
  return (
    <button
      type="button"
      role="tab"
      id={`admin-tab-${tab.id}`}
      aria-selected={active}
      aria-controls="admin-panel"
      data-active={active || undefined}
      onClick={() => onSelect(tab.id)}
      className={cn(
        'focus-ring group inline-flex shrink-0 items-center gap-2 whitespace-nowrap text-sm font-medium transition-colors',
        // mobile: tab orizzontali con indicatore sotto
        '-mb-px h-10 border-b-2 px-1',
        active ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground',
        // lg: voci verticali stile impostazioni
        'lg:mb-0 lg:h-8 lg:w-full lg:rounded-md lg:border-b-0 lg:px-2.5',
        active ? 'lg:bg-accent' : 'lg:hover:bg-accent/60'
      )}
    >
      <Icon className={cn('h-4 w-4 shrink-0', active ? 'text-foreground' : 'text-muted-foreground group-hover:text-foreground')} />
      <span className="flex-1 text-left">{tab.label}</span>
      {count !== undefined && (
        <span className="rounded bg-muted px-1.5 text-2xs tabular-nums text-muted-foreground lg:bg-transparent lg:px-0">{count}</span>
      )}
    </button>
  )
}

function AdminSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true">
      {[0, 1].map(i => (
        <div key={i} className="space-y-3 rounded-lg border p-5">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-3 w-2/3" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
        </div>
      ))}
    </div>
  )
}

// ─── Main Admin Page ──────────────────────────────────────────────────────────
export default function AdminPage() {
  const { wsId } = useParams<{ wsId: string }>()
  const [params, setParams] = useSearchParams()
  const rawTab = params.get('tab')
  const tab: TabId = rawTab && TAB_IDS.has(rawTab) ? (rawTab as TabId) : 'members'
  const navRef = useRef<HTMLDivElement>(null)

  // Ruolo dell'utente in questo workspace: serve a bloccare l'accesso diretto via URL.
  const { data: workspaces, isLoading: wsLoading } = useQuery<Workspace[]>({
    queryKey: ['workspaces'],
    queryFn: workspacesApi.list,
  })
  const currentWs = useMemo(() => workspaces?.find(w => w.id === wsId), [workspaces, wsId])

  // Solo per i contatori nella navigazione: stesse query key delle schede (cache condivisa).
  const { data: members } = useQuery<Member[]>({
    queryKey: ['members', wsId],
    queryFn: () => workspacesApi.getMembers(wsId!),
    enabled: !!wsId,
  })
  const { data: tags } = useQuery<Tag[]>({
    queryKey: ['tags', wsId],
    queryFn: () => tagsApi.list(wsId!),
    enabled: !!wsId,
  })
  const { data: apiKeys } = useQuery<ApiKey[]>({
    queryKey: ['api-keys', wsId],
    queryFn: () => apiKeysApi.list(wsId!),
    enabled: !!wsId,
  })
  const counts: Partial<Record<TabId, number | undefined>> = {
    members: members?.length,
    tags: tags?.length,
    integrations: apiKeys?.length,
  }

  const selectTab = useCallback((id: TabId) => {
    setParams(prev => {
      const next = new URLSearchParams(prev)
      next.set('tab', id)
      return next
    }, { replace: true })
  }, [setParams])

  // Su mobile la scheda attiva resta visibile nella barra scorrevole.
  useEffect(() => {
    const el = navRef.current?.querySelector<HTMLElement>('[data-active]')
    el?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [tab])

  // Appena conosciamo il ruolo, se non sei ADMIN del workspace torni alla board.
  if (!wsLoading && currentWs && currentWs.myRole !== 'ADMIN') {
    return <Navigate to={`/workspace/${wsId}/kanban`} replace />
  }

  const active = TABS.find(t => t.id === tab)!

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-5xl px-4 pb-10 pt-5 sm:px-6 lg:pt-8">
        <PageHeader
          icon={Shield}
          title="Amministrazione"
          description={currentWs ? `Impostazioni, membri e integrazioni di ${currentWs.name}` : 'Gestione workspace, utenti e integrazioni'}
          className="pb-2 sm:pb-4"
        />

        <div className="lg:grid lg:grid-cols-[12rem_minmax(0,1fr)] lg:gap-8">
          <nav aria-label="Sezioni amministrazione" className="lg:sticky lg:top-6 lg:self-start">
            <div
              ref={navRef}
              role="tablist"
              aria-orientation="horizontal"
              className="scrollbar-none -mx-4 mb-5 flex gap-4 overflow-x-auto border-b px-4 sm:-mx-6 sm:px-6 lg:mx-0 lg:mb-0 lg:flex-col lg:gap-0 lg:overflow-visible lg:border-b-0 lg:px-0"
            >
              {GROUPS.map(group => (
                <div key={group} role="presentation" className="contents lg:mb-4 lg:block lg:space-y-0.5">
                  <p className="hidden px-2.5 pb-1 text-2xs font-medium uppercase tracking-wide text-muted-foreground lg:block">
                    {group}
                  </p>
                  {TABS.filter(t => t.group === group).map(t => (
                    <NavItem key={t.id} tab={t} active={t.id === tab} count={counts[t.id]} onSelect={selectTab} />
                  ))}
                </div>
              ))}
            </div>
          </nav>

          <section id="admin-panel" role="tabpanel" aria-labelledby={`admin-tab-${tab}`} aria-label={active.label} className="min-w-0">
            {!wsId || wsLoading ? (
              <AdminSkeleton />
            ) : (
              <>
                {tab === 'workspace' && <WorkspaceTab wsId={wsId} workspace={currentWs} />}
                {tab === 'members' && <MembersTab wsId={wsId} />}
                {tab === 'tags' && <TagsTab wsId={wsId} />}
                {tab === 'integrations' && <ApiKeysTab wsId={wsId} />}
                {tab === 'rooms' && <RoomsTab wsId={wsId} />}
                {tab === 'ai' && <AiTab wsId={wsId} />}
                {tab === 'backup' && <BackupTab wsId={wsId} wsName={currentWs?.name ?? 'workspace'} />}
              </>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}
