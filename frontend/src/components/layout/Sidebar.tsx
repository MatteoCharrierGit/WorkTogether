import { useState, useEffect } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  ChevronDown, ChevronRight, KanbanSquare, GanttChartSquare, Calendar,
  Settings, LogOut, Plus, Building2, CheckSquare, Check, Palette, Folder, UserCog, Bot, Mail, MessagesSquare
} from 'lucide-react'
import { cn, TYPE_ICONS } from '@/lib/utils'
import { useAuthStore } from '@/store/authStore'
import { useWorkspaceStore } from '@/store/workspaceStore'
import { elementsApi, workspacesApi, aiApi, channelsApi } from '@/lib/api'
import { Channel, Element, Workspace } from '@/types'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Separator } from '@/components/ui/separator'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { getInitials } from '@/lib/utils'
import { CreateWorkspaceDialog } from '@/components/CreateWorkspaceDialog'
import { useTheme, THEMES } from '@/components/layout/ThemeProvider'
import { UserAvatar } from '@/components/UserAvatar'

function TreeNode({ element, elements, depth = 0 }: {
  element: Element
  elements: Element[]
  depth?: number
}) {
  const [open, setOpen] = useState(depth === 0)
  const location = useLocation()
  const wsId = useWorkspaceStore(s => s.current?.id)
  const children = elements.filter(e => e.parentId === element.id)
  const href = `/workspace/${wsId}/element/${element.id}`
  const isActive = location.pathname === href

  return (
    <div>
      <div
        className={cn(
          'group flex items-center gap-1.5 rounded-md px-2 py-1 text-sm cursor-pointer transition-colors select-none',
          isActive ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/60',
        )}
        style={{ paddingLeft: `${8 + depth * 14}px` }}
      >
        {children.length > 0 ? (
          <button
            onClick={() => setOpen(o => !o)}
            className="shrink-0 p-0.5 rounded hover:bg-accent"
          >
            {open
              ? <ChevronDown className="h-3 w-3" />
              : <ChevronRight className="h-3 w-3" />}
          </button>
        ) : (
          <span className="w-4 shrink-0" />
        )}
        <span className="text-xs shrink-0">{TYPE_ICONS[element.type]}</span>
        <Link to={href} className="truncate flex-1 leading-none py-0.5">
          {element.title}
        </Link>
      </div>
      {open && children.map(child => (
        <TreeNode key={child.id} element={child} elements={elements} depth={depth + 1} />
      ))}
    </div>
  )
}

export function Sidebar({ mobileOpen = false }: { mobileOpen?: boolean }) {
  const navigate = useNavigate()
  const location = useLocation()
  const { user, logout } = useAuthStore()
  const { current: workspace, setCurrent } = useWorkspaceStore()

  const { data: workspaces = [], isSuccess: workspacesLoaded } = useQuery<Workspace[]>({
    queryKey: ['workspaces'],
    queryFn: workspacesApi.list,
  })

  // Il workspace "attivo" vale solo se l'utente ne è davvero membro. `current` è persistito in
  // localStorage e potrebbe puntare a un workspace da cui è stato rimosso (o a quello di un altro
  // utente che ha usato lo stesso browser): in quei casi il menu non va mostrato. Finché la lista
  // non è caricata ci fidiamo di `current` per evitare uno sfarfallio del menu al primo render.
  const isMember = !!workspace && workspaces.some(w => w.id === workspace.id)
  const showWorkspaceNav = !!workspace && (!workspacesLoaded || isMember)
  // Una volta confermato che non è membro, ripulisce lo stato persistito (in effect, non in render).
  useEffect(() => {
    if (workspacesLoaded && workspace && !isMember) setCurrent(null)
  }, [workspacesLoaded, workspace, isMember, setCurrent])

  const { data: elements = [] } = useQuery<Element[]>({
    queryKey: ['elements', workspace?.id],
    queryFn: () => elementsApi.list(workspace!.id),
    enabled: !!workspace?.id,
  })

  const { data: aiStatus } = useQuery<{ enabled: boolean }>({
    queryKey: ['ai-status', workspace?.id],
    queryFn: () => aiApi.status(workspace!.id),
    enabled: !!workspace?.id,
  })

  const { data: channels = [] } = useQuery<Channel[]>({
    queryKey: ['channels', workspace?.id],
    queryFn: () => channelsApi.list(workspace!.id),
    enabled: !!workspace?.id,
  })
  const totalUnread = channels.reduce((sum, c) => sum + (c.unreadCount || 0), 0)

  const epics = elements.filter(e => e.type === 'EPICA')
  const currentWsAvatar = workspaces.find(w => w.id === workspace?.id)?.avatar

  const { theme, setTheme } = useTheme()
  const [wsDialogOpen, setWsDialogOpen] = useState(false)

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  const navLink = (to: string, icon: React.ReactNode, label: string, tourId?: string, badge?: number) => {
    const active = location.pathname === to
    return (
      <Link
        to={to}
        data-tour={tourId}
        className={cn(
          'flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors',
          active ? 'bg-accent text-accent-foreground font-medium' : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'
        )}
      >
        {icon}
        <span className="flex-1">{label}</span>
        {badge != null && badge > 0 && (
          <span className="shrink-0 rounded-full bg-primary text-primary-foreground text-[10px] font-semibold min-w-[18px] h-[18px] px-1 flex items-center justify-center">
            {badge > 99 ? '99+' : badge}
          </span>
        )}
      </Link>
    )
  }

  const wsBase = workspace ? `/workspace/${workspace.id}` : ''

  return (
    <aside
      className={cn(
        'flex h-screen w-60 shrink-0 flex-col border-r bg-sidebar',
        // Mobile: drawer fuori schermo, scorre dentro quando aperto e sta sopra il backdrop (z-40).
        'fixed inset-y-0 left-0 z-50 transition-transform duration-200',
        mobileOpen ? 'translate-x-0' : '-translate-x-full',
        // Desktop (≥ md): sidebar statica sempre visibile, nessuna traslazione.
        'md:static md:z-auto md:translate-x-0',
      )}
    >
      {/* Workspace switcher */}
      <div className="p-3 border-b border-sidebar-border">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button data-tour="workspace" className="flex w-full items-center gap-2 rounded-lg p-2 hover:bg-accent/60 transition-colors">
              {currentWsAvatar ? (
                <img src={currentWsAvatar} alt="" className="h-7 w-7 shrink-0 rounded-md object-cover" />
              ) : (
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground text-xs font-semibold">
                  {workspace?.name?.[0]?.toUpperCase() ?? <Building2 className="h-4 w-4" />}
                </div>
              )}
              <span className="flex-1 text-left text-sm font-medium truncate">
                {workspace?.name ?? 'Seleziona workspace'}
              </span>
              <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            <DropdownMenuLabel>Workspace</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {workspaces.map(ws => (
              <DropdownMenuItem
                key={ws.id}
                onClick={() => { setCurrent(ws); navigate(`/workspace/${ws.id}`) }}
                className={cn(workspace?.id === ws.id && 'font-medium')}
              >
                {ws.name}
                <span className="ml-auto text-xs text-muted-foreground">{ws.myRole}</span>
              </DropdownMenuItem>
            ))}
            {user?.systemAdmin && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => setWsDialogOpen(true)}>
                  <Plus className="h-4 w-4" />
                  Nuovo workspace
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <CreateWorkspaceDialog open={wsDialogOpen} onClose={() => setWsDialogOpen(false)} />

      {/* Cross-workspace */}
      <nav className="flex flex-col gap-0.5 p-2 border-b border-sidebar-border">
        {navLink('/my-tasks', <CheckSquare className="h-4 w-4" />, 'Le mie task', 'mytasks')}
      </nav>

      {/* Main nav */}
      {showWorkspaceNav && (
        <nav className="flex flex-col gap-0.5 p-2 border-b border-sidebar-border">
          {navLink(`${wsBase}/kanban`, <KanbanSquare className="h-4 w-4" />, 'Kanban', 'kanban')}
          {navLink(`${wsBase}/roadmap`, <GanttChartSquare className="h-4 w-4" />, 'Roadmap', 'roadmap')}
          {navLink(`${wsBase}/calendar`, <Calendar className="h-4 w-4" />, 'Calendario', 'calendar')}
          {navLink(`${wsBase}/drive`, <Folder className="h-4 w-4" />, 'File', 'files')}
          {navLink(`${wsBase}/chat`, <MessagesSquare className="h-4 w-4" />, 'Chat', 'chat', totalUnread)}
          {aiStatus?.enabled && navLink(`${wsBase}/assistant`, <Bot className="h-4 w-4" />, 'Akari', 'akari')}
          {(workspace.myRole === 'ADMIN') && navLink(`${wsBase}/mail`, <Mail className="h-4 w-4" />, 'Mail')}
          {(workspace.myRole === 'ADMIN') && navLink(`${wsBase}/admin`, <Settings className="h-4 w-4" />, 'Admin')}
        </nav>
      )}

      {/* Project tree */}
      {showWorkspaceNav && (
        <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
          <p className="px-2 py-1 text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Progetti
          </p>
          {epics.map(epic => (
            <TreeNode key={epic.id} element={epic} elements={elements} />
          ))}
          {epics.length === 0 && (
            <p className="px-2 text-xs text-muted-foreground italic">Nessun progetto</p>
          )}
        </div>
      )}

      {/* User footer */}
      <div className="border-t border-sidebar-border p-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button data-tour="settings" className="flex w-full items-center gap-2 rounded-md p-2 hover:bg-accent/60 transition-colors">
              <UserAvatar name={user?.displayName} avatar={user?.avatar} className="h-7 w-7" />
              <div className="flex-1 text-left min-w-0">
                <p className="text-xs font-medium truncate">{user?.displayName}</p>
                <p className="text-xs text-muted-foreground truncate">{user?.email}</p>
              </div>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" side="top" className="w-52">
            <DropdownMenuItem onClick={() => navigate('/settings')}>
              <UserCog className="h-4 w-4" />
              Impostazioni
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleLogout} className="text-destructive">
              <LogOut className="h-4 w-4" />
              Disconnetti
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </aside>
  )
}
