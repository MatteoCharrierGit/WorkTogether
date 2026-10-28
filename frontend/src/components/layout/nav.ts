import {
  Bot, CalendarDays, CheckSquare, Folder, GanttChartSquare, Home, KanbanSquare, LayoutDashboard, Mail, MessagesSquare,
  Settings, ShieldCheck, Target, type LucideIcon,
} from 'lucide-react'
import type { Workspace } from '@/types'

/** Voce di navigazione condivisa da Sidebar, CommandPalette e barra mobile. */
export interface NavItem {
  id: string
  label: string
  icon: LucideIcon
  to: string
  /** Prefissi di path che rendono attiva la voce (default: `to`). */
  match?: string[]
  /** Valore di data-tour per il WelcomeTour. */
  tour?: string
  /** Parole chiave extra per la ricerca nella palette. */
  keywords?: string[]
}

export interface NavGroup {
  id: string
  label: string
  items: NavItem[]
}

export interface NavContext {
  workspace: Workspace | null
  aiEnabled: boolean
}

export const MY_TASKS_ITEM: NavItem = {
  id: 'my-tasks', label: 'Le mie task', icon: CheckSquare, to: '/my-tasks', tour: 'mytasks', keywords: ['assegnate', 'todo'],
}

export const SETTINGS_ITEM: NavItem = {
  id: 'settings', label: 'Impostazioni', icon: Settings, to: '/settings', keywords: ['profilo', 'tema', 'account'],
}

/** Gruppi di navigazione del workspace corrente (vuoto se nessun workspace). */
export function workspaceNavGroups({ workspace, aiEnabled }: NavContext): NavGroup[] {
  if (!workspace) return []
  const base = `/workspace/${workspace.id}`
  const isAdmin = workspace.myRole === 'ADMIN'
  const plan: NavItem[] = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, to: `${base}/dashboard`, keywords: ['panoramica', 'home', 'statistiche', 'kpi'] },
    // Il dettaglio elemento nasce dalla board: tiene evidenziato Kanban.
    { id: 'kanban', label: 'Kanban', icon: KanbanSquare, to: `${base}/kanban`, match: [`${base}/kanban`, `${base}/element`], tour: 'kanban', keywords: ['board', 'task'] },
    { id: 'roadmap', label: 'Roadmap', icon: GanttChartSquare, to: `${base}/roadmap`, tour: 'roadmap', keywords: ['gantt', 'timeline'] },
    { id: 'calendar', label: 'Calendario', icon: CalendarDays, to: `${base}/calendar`, tour: 'calendar', keywords: ['eventi', 'scadenze'] },
  ]
  if (workspace.sprintEnabled) {
    plan.push({ id: 'sprint', label: 'Sprint', icon: Target, to: `${base}/sprint`, tour: 'sprint', keywords: ['scrum'] })
  }
  const collab: NavItem[] = [
    { id: 'chat', label: 'Chat', icon: MessagesSquare, to: `${base}/chat`, tour: 'chat', keywords: ['messaggi', 'voce', 'stanze'] },
    { id: 'drive', label: 'File', icon: Folder, to: `${base}/drive`, tour: 'files', keywords: ['drive', 'documenti', 'cartelle'] },
  ]
  if (aiEnabled) collab.push({ id: 'akari', label: 'Akari', icon: Bot, to: `${base}/assistant`, tour: 'akari', keywords: ['assistente', 'ai'] })
  if (isAdmin) collab.push({ id: 'mail', label: 'Mail', icon: Mail, to: `${base}/mail`, keywords: ['email', 'posta'] })

  const groups: NavGroup[] = [
    { id: 'plan', label: 'Pianifica', items: plan },
    { id: 'collab', label: 'Collabora', items: collab },
  ]
  if (isAdmin) {
    groups.push({
      id: 'manage', label: 'Gestisci',
      items: [{ id: 'admin', label: 'Amministrazione', icon: ShieldCheck, to: `${base}/admin`, keywords: ['membri', 'inviti', 'admin'] }],
    })
  }
  return groups
}

export function isNavActive(item: NavItem, pathname: string): boolean {
  return (item.match ?? [item.to]).some(p => pathname === p || pathname.startsWith(p + '/'))
}

const SEGMENT_TITLES: Record<string, string> = {
  dashboard: 'Dashboard',
  kanban: 'Kanban',
  roadmap: 'Roadmap',
  calendar: 'Calendario',
  sprint: 'Sprint',
  chat: 'Chat',
  drive: 'File',
  assistant: 'Akari',
  mail: 'Mail',
  admin: 'Amministrazione',
  element: 'Dettaglio',
}

/** Titolo della pagina corrente dal path (barra superiore mobile). */
export function routeTitle(pathname: string): string {
  if (pathname === '/my-tasks') return 'Le mie task'
  if (pathname === '/settings') return 'Impostazioni'
  const m = pathname.match(/^\/workspace\/[^/]+\/([^/]+)/)
  if (m) return SEGMENT_TITLES[m[1]] ?? 'WorkTogether'
  return 'Home'
}

export const HOME_ICON = Home

export const ROLE_LABELS: Record<string, string> = {
  ADMIN: 'Admin',
  COLLABORATORE: 'Collaboratore',
  GUEST: 'Ospite',
}

/** Etichetta della scorciatoia ⌘K / Ctrl K in base alla piattaforma. */
export const MOD_KEY = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent) ? '⌘' : 'Ctrl '

/** Sezioni che esistono in ogni workspace: cambiando workspace si resta nella stessa sezione. */
const PORTABLE_SECTIONS = ['dashboard', 'kanban', 'roadmap', 'calendar', 'chat', 'drive']

/** Path di destinazione quando si passa al workspace `wsId` partendo da `pathname`. */
export function workspaceSwitchPath(pathname: string, wsId: string): string {
  const m = pathname.match(/^\/workspace\/[^/]+\/([^/]+)/)
  const section = m && PORTABLE_SECTIONS.includes(m[1]) ? m[1] : 'dashboard'
  return `/workspace/${wsId}/${section}`
}
