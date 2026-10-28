import { memo, useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  Check, ChevronRight, ChevronsUpDown, LogOut, Monitor, Moon, PanelLeftClose, PanelLeftOpen, Plus, Search, Sun, UserCog,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/store/authStore'
import { useWorkspaceStore } from '@/store/workspaceStore'
import { useIsOnline } from '@/store/presenceStore'
import { useUiStore } from '@/store/uiStore'
import { elementsApi, workspacesApi, aiApi, channelsApi } from '@/lib/api'
import type { Channel, Element, Workspace } from '@/types'
import { IconButton } from '@/components/ui/icon-button'
import { Kbd } from '@/components/ui/kbd'
import { Skeleton } from '@/components/ui/skeleton'
import { SimpleTooltip } from '@/components/ui/tooltip'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioGroup,
  DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { TypeIcon, UserAvatar } from '@/components/shared'
import { CreateWorkspaceDialog } from '@/components/CreateWorkspaceDialog'
import { useTheme } from '@/components/layout/ThemeProvider'
import { WorkspaceAvatar } from './WorkspaceAvatar'
import {
  MOD_KEY, MY_TASKS_ITEM, ROLE_LABELS, isNavActive, workspaceNavGroups, workspaceSwitchPath, type NavItem,
} from './nav'

// ---------------------------------------------------------------- dati

type TreeItem = Pick<Element, 'id' | 'title' | 'type' | 'parentId'>
interface ProjectTree {
  nodes: TreeItem[]
  /** id → parentId per TUTTI gli elementi (per espandere il ramo dell'elemento aperto). */
  parentOf: Record<string, string | undefined>
}

// `select` stabile (fuori dal componente): stessa chiave e queryFn della Kanban → nessuna
// richiesta in più, e la sidebar si ri-renderizza solo se epiche/storie cambiano davvero.
function selectProjectTree(elements: Element[]): ProjectTree {
  const nodes: TreeItem[] = []
  const parentOf: Record<string, string | undefined> = {}
  for (const e of elements) {
    parentOf[e.id] = e.parentId
    if (e.type === 'EPICA' || e.type === 'STORIA') {
      nodes.push({ id: e.id, title: e.title, type: e.type, parentId: e.parentId })
    }
  }
  return { nodes, parentOf }
}

const selectUnread = (channels: Channel[]) => channels.reduce((sum, c) => sum + (c.unreadCount || 0), 0)

// ---------------------------------------------------------------- voci

const itemBase =
  'relative flex h-8 items-center gap-2.5 rounded-md text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
const itemIdle = 'text-muted-foreground hover:bg-sidebar-accent hover:text-foreground'
const itemActive = 'bg-sidebar-accent text-foreground font-medium'

function CountBadge({ count, collapsed }: { count: number; collapsed?: boolean }) {
  if (count <= 0) return null
  if (collapsed) {
    return <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-primary ring-2 ring-sidebar" aria-hidden="true" />
  }
  return (
    <span className="ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-2xs font-semibold tabular-nums text-primary-foreground">
      {count > 99 ? '99+' : count}
    </span>
  )
}

function NavLinkItem({
  item, active, collapsed, badge = 0,
}: { item: NavItem; active: boolean; collapsed: boolean; badge?: number }) {
  const Icon = item.icon
  const link = (
    <Link
      to={item.to}
      data-tour={item.tour}
      aria-current={active ? 'page' : undefined}
      aria-label={collapsed ? (badge > 0 ? `${item.label} (${badge} non letti)` : item.label) : undefined}
      className={cn(itemBase, active ? itemActive : itemIdle, collapsed ? 'mx-auto w-9 justify-center' : 'px-2')}
    >
      <Icon className={cn('h-4 w-4 shrink-0', active && 'text-primary')} aria-hidden="true" />
      {!collapsed && <span className="flex-1 truncate">{item.label}</span>}
      <CountBadge count={badge} collapsed={collapsed} />
    </Link>
  )
  return collapsed ? <SimpleTooltip content={item.label} side="right">{link}</SimpleTooltip> : link
}

// ---------------------------------------------------------------- albero progetti

interface TreeCtx {
  byParent: Map<string | undefined, TreeItem[]>
  activeId: string | null
  openPath: Set<string>
  wsId: string
}

const TreeNode = memo(function TreeNode({ node, depth, ctx }: { node: TreeItem; depth: number; ctx: TreeCtx }) {
  const children = ctx.byParent.get(node.id) ?? []
  const inPath = ctx.openPath.has(node.id)
  const [open, setOpen] = useState(inPath)
  // Quando si apre un elemento dentro questo ramo, il ramo si espande da solo.
  useEffect(() => { if (inPath) setOpen(true) }, [inPath])
  const active = ctx.activeId === node.id

  return (
    <li>
      <div
        className={cn(
          'group flex h-7 items-center gap-1 rounded-md pr-2 text-sm transition-colors',
          active ? 'bg-sidebar-accent text-foreground font-medium' : 'text-muted-foreground hover:bg-sidebar-accent hover:text-foreground',
        )}
        style={{ paddingLeft: 4 + depth * 12 }}
      >
        {children.length > 0 ? (
          <IconButton
            size="xs"
            noTooltip
            label={open ? `Comprimi ${node.title}` : `Espandi ${node.title}`}
            aria-expanded={open}
            onClick={() => setOpen(o => !o)}
            className="h-5 w-5 shrink-0"
            icon={<ChevronRight className={cn('transition-transform duration-150', open && 'rotate-90')} />}
          />
        ) : (
          <span className="w-5 shrink-0" aria-hidden="true" />
        )}
        <Link
          to={`/workspace/${ctx.wsId}/element/${node.id}`}
          aria-current={active ? 'page' : undefined}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <TypeIcon type={node.type} size="sm" />
          <span className="truncate">{node.title}</span>
        </Link>
      </div>
      {open && children.length > 0 && (
        <ul role="group">
          {children.map(child => (
            <TreeNode key={child.id} node={child} depth={depth + 1} ctx={ctx} />
          ))}
        </ul>
      )}
    </li>
  )
})

function ProjectsTree({ wsId, pathname }: { wsId: string; pathname: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['elements', wsId],
    queryFn: () => elementsApi.list(wsId),
    select: selectProjectTree,
  })

  const activeId = pathname.match(/\/element\/([^/]+)/)?.[1] ?? null

  const ctx = useMemo<TreeCtx | null>(() => {
    if (!data) return null
    const byParent = new Map<string | undefined, TreeItem[]>()
    const ids = new Set(data.nodes.map(n => n.id))
    for (const n of data.nodes) {
      // Le storie senza epica (o con genitore non nell'albero) restano fuori: l'albero parte dalle epiche.
      const key = n.type === 'EPICA' ? undefined : n.parentId && ids.has(n.parentId) ? n.parentId : null
      if (key === null) continue
      const list = byParent.get(key)
      if (list) list.push(n)
      else byParent.set(key, [n])
    }
    const openPath = new Set<string>()
    let cur = activeId ? data.parentOf[activeId] : undefined
    for (let guard = 0; cur && guard < 20; guard++) {
      openPath.add(cur)
      cur = data.parentOf[cur]
    }
    return { byParent, activeId, openPath, wsId }
  }, [data, activeId, wsId])

  const epics = ctx?.byParent.get(undefined) ?? []

  return (
    <div className="px-2 pb-2">
      <p className="flex h-7 items-center px-2 text-2xs font-medium uppercase tracking-wider text-muted-foreground/80">
        Progetti
      </p>
      {isLoading ? (
        <div className="space-y-2 px-2 py-1" aria-busy="true">
          <Skeleton className="h-3.5 w-4/5" />
          <Skeleton className="h-3.5 w-3/5" />
          <Skeleton className="h-3.5 w-2/3" />
        </div>
      ) : epics.length === 0 ? (
        <p className="px-2 py-1 text-caption text-muted-foreground">Nessuna epica ancora.</p>
      ) : (
        <ul role="tree" aria-label="Progetti">
          {epics.map(epic => (
            <TreeNode key={epic.id} node={epic} depth={0} ctx={ctx!} />
          ))}
        </ul>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- sidebar

export interface SidebarProps {
  /** Rail di sole icone (solo desktop). */
  collapsed?: boolean
  /** "drawer" = dentro lo Sheet mobile: niente toggle di compattazione. */
  variant?: 'desktop' | 'drawer'
}

export function Sidebar({ collapsed = false, variant = 'desktop' }: SidebarProps) {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const user = useAuthStore(s => s.user)
  const logout = useAuthStore(s => s.logout)
  const currentId = useWorkspaceStore(s => s.current?.id)
  const persistedCurrent = useWorkspaceStore(s => s.current)
  const setCurrent = useWorkspaceStore(s => s.setCurrent)
  const toggleSidebar = useUiStore(s => s.toggleSidebar)
  const setCommandOpen = useUiStore(s => s.setCommandOpen)
  const meOnline = useIsOnline(user?.id)
  const { theme, resolvedTheme, setTheme } = useTheme()
  const [wsDialogOpen, setWsDialogOpen] = useState(false)

  const { data: workspaces = [], isSuccess: workspacesLoaded } = useQuery<Workspace[]>({
    queryKey: ['workspaces'],
    queryFn: workspacesApi.list,
  })

  // Il workspace attivo è quello della lista autorevole (dati freschi: ruolo, sprint, avatar).
  // Finché la lista non è caricata ci si fida di quello persistito per evitare sfarfallii;
  // se l'utente non ne è (più) membro, il Layout azzera lo stato e torna alla home.
  const workspace = workspaces.find(w => w.id === currentId) ?? (workspacesLoaded ? null : persistedCurrent)
  const wsId = workspace?.id

  const { data: aiStatus } = useQuery<{ enabled: boolean }>({
    queryKey: ['ai-status', wsId],
    queryFn: () => aiApi.status(wsId!),
    enabled: !!wsId,
    staleTime: 5 * 60_000,
  })

  const { data: totalUnread = 0 } = useQuery({
    queryKey: ['channels', wsId],
    queryFn: () => channelsApi.list(wsId!),
    enabled: !!wsId,
    select: selectUnread,
  })

  const groups = useMemo(
    () => workspaceNavGroups({ workspace: workspace ?? null, aiEnabled: !!aiStatus?.enabled }),
    [workspace, aiStatus?.enabled],
  )

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  const isDark = resolvedTheme === 'dark'
  const themeToggle = (
    <IconButton
      label={isDark ? 'Passa al tema chiaro' : 'Passa al tema scuro'}
      tooltipSide={collapsed ? 'right' : 'top'}
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
      icon={isDark ? <Sun /> : <Moon />}
    />
  )
  const collapseToggle = variant === 'desktop' && (
    <IconButton
      label={collapsed ? 'Espandi barra laterale' : 'Comprimi barra laterale'}
      tooltipSide={collapsed ? 'right' : 'top'}
      onClick={toggleSidebar}
      icon={collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
    />
  )

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-sidebar text-sidebar-foreground">
      {/* Workspace switcher */}
      <div className={cn('flex shrink-0 items-center border-b border-sidebar-border', collapsed ? 'justify-center px-2 py-2.5' : 'p-2')}>
        <DropdownMenu>
          <SimpleTooltip content={workspace?.name ?? 'Seleziona workspace'} side="right" disabled={!collapsed}>
            <DropdownMenuTrigger asChild>
              <button
                data-tour="workspace"
                aria-label={collapsed ? `Workspace: ${workspace?.name ?? 'nessuno'}` : undefined}
                className={cn(
                  'flex items-center gap-2 rounded-md transition-colors hover:bg-sidebar-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:bg-sidebar-accent',
                  collapsed ? 'h-9 w-9 justify-center' : 'h-10 w-full px-2',
                )}
              >
                <WorkspaceAvatar name={workspace?.name} avatar={workspace?.avatar} />
                {!collapsed && (
                  <>
                    <span className="min-w-0 flex-1 text-left">
                      <span className="block truncate text-sm font-semibold">{workspace?.name ?? 'Seleziona workspace'}</span>
                      {workspace && (
                        <span className="block truncate text-2xs text-muted-foreground">{ROLE_LABELS[workspace.myRole] ?? workspace.myRole}</span>
                      )}
                    </span>
                    <ChevronsUpDown className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  </>
                )}
              </button>
            </DropdownMenuTrigger>
          </SimpleTooltip>
          <DropdownMenuContent align="start" side={collapsed ? 'right' : 'bottom'} className="w-64">
            <DropdownMenuLabel>Workspace</DropdownMenuLabel>
            {workspaces.length === 0 && (
              <p className="px-2 py-1.5 text-caption text-muted-foreground">Nessun workspace</p>
            )}
            {workspaces.map(ws => (
              <DropdownMenuItem
                key={ws.id}
                onSelect={() => {
                  setCurrent(ws)
                  navigate(workspaceSwitchPath(pathname, ws.id))
                }}
              >
                <WorkspaceAvatar name={ws.name} avatar={ws.avatar} size="sm" />
                <span className="min-w-0 flex-1 truncate">{ws.name}</span>
                {ws.id === wsId ? (
                  <Check className="h-4 w-4 text-primary" aria-label="Attivo" />
                ) : (
                  <span className="text-2xs text-muted-foreground">{ROLE_LABELS[ws.myRole] ?? ws.myRole}</span>
                )}
              </DropdownMenuItem>
            ))}
            {user?.systemAdmin && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => setWsDialogOpen(true)}>
                  <Plus className="h-4 w-4" />
                  Nuovo workspace
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <CreateWorkspaceDialog open={wsDialogOpen} onClose={() => setWsDialogOpen(false)} />

      {/* Ricerca + Le mie task */}
      <div className={cn('flex shrink-0 flex-col gap-0.5 p-2', collapsed && 'items-center')}>
        {collapsed ? (
          <IconButton
            label="Cerca"
            shortcut={`${MOD_KEY}K`}
            tooltipSide="right"
            onClick={() => setCommandOpen(true)}
            icon={<Search />}
          />
        ) : (
          <button
            type="button"
            onClick={() => setCommandOpen(true)}
            className="mb-1 flex h-8 w-full items-center gap-2 rounded-md border border-sidebar-border bg-background/60 px-2 text-sm text-muted-foreground shadow-xs transition-colors hover:bg-sidebar-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Search className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="flex-1 text-left">Cerca…</span>
            <Kbd className="hidden md:inline-flex">{MOD_KEY}K</Kbd>
          </button>
        )}
        <NavLinkItem item={MY_TASKS_ITEM} active={isNavActive(MY_TASKS_ITEM, pathname)} collapsed={collapsed} />
      </div>

      {/* Navigazione del workspace + progetti (area scorrevole) */}
      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
        {groups.map(group => (
          <nav key={group.id} aria-label={group.label} className={cn('px-2 pb-2', collapsed && 'flex flex-col items-center gap-0.5 border-t border-sidebar-border pt-2')}>
            {!collapsed && (
              <p className="flex h-7 items-center px-2 text-2xs font-medium uppercase tracking-wider text-muted-foreground/80">
                {group.label}
              </p>
            )}
            <div className={cn('flex flex-col gap-0.5', collapsed && 'items-center')}>
              {group.items.map(item => (
                <NavLinkItem
                  key={item.id}
                  item={item}
                  active={isNavActive(item, pathname)}
                  collapsed={collapsed}
                  badge={item.id === 'chat' ? totalUnread : 0}
                />
              ))}
            </div>
          </nav>
        ))}

        {!collapsed && wsId && <ProjectsTree wsId={wsId} pathname={pathname} />}
      </div>

      {/* Footer utente */}
      <div className={cn('flex shrink-0 border-t border-sidebar-border p-2', collapsed ? 'flex-col items-center gap-1' : 'items-center gap-1')}>
        <DropdownMenu>
          <SimpleTooltip content={user?.displayName ?? 'Account'} side="right" disabled={!collapsed}>
            <DropdownMenuTrigger asChild>
              <button
                data-tour="settings"
                aria-label={collapsed ? `Account: ${user?.displayName ?? ''}` : undefined}
                className={cn(
                  'flex items-center gap-2 rounded-md transition-colors hover:bg-sidebar-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:bg-sidebar-accent',
                  collapsed ? 'h-9 w-9 justify-center' : 'h-10 min-w-0 flex-1 px-1.5',
                )}
              >
                <UserAvatar name={user?.displayName} avatar={user?.avatar} size="sm" presence={wsId ? (meOnline ? 'online' : 'offline') : undefined} />
                {!collapsed && (
                  <span className="min-w-0 flex-1 text-left">
                    <span className="block truncate text-sm font-medium">{user?.displayName}</span>
                    <span className="block truncate text-2xs text-muted-foreground">{user?.email}</span>
                  </span>
                )}
              </button>
            </DropdownMenuTrigger>
          </SimpleTooltip>
          <DropdownMenuContent align="start" side={collapsed ? 'right' : 'top'} className="w-56">
            <DropdownMenuLabel className="font-normal">
              <span className="block truncate text-sm font-medium text-foreground">{user?.displayName}</span>
              <span className="block truncate text-xs text-muted-foreground">{user?.email}</span>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => navigate('/settings')}>
              <UserCog className="h-4 w-4" />
              Impostazioni
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Tema</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={theme} onValueChange={setTheme}>
              <DropdownMenuRadioItem value="light"><Sun className="h-4 w-4" /> Chiaro</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="dark"><Moon className="h-4 w-4" /> Scuro</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="system"><Monitor className="h-4 w-4" /> Sistema</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem destructive onSelect={handleLogout}>
              <LogOut className="h-4 w-4" />
              Disconnetti
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        {themeToggle}
        {collapseToggle}
      </div>
    </div>
  )
}
