import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Check, LogOut, Monitor, Moon, Plus, Sun } from 'lucide-react'
import {
  CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator, CommandShortcut,
} from '@/components/ui/command'
import { TypeIcon } from '@/components/shared'
import { useTheme } from '@/components/layout/ThemeProvider'
import { WorkspaceAvatar } from '@/components/layout/WorkspaceAvatar'
import {
  MY_TASKS_ITEM, SETTINGS_ITEM, workspaceNavGroups, workspaceSwitchPath, type NavItem,
} from '@/components/layout/nav'
import { aiApi, elementsApi, workspacesApi } from '@/lib/api'
import { TYPE_LABELS } from '@/lib/utils'
import { useUiStore } from '@/store/uiStore'
import { useAuthStore } from '@/store/authStore'
import { useWorkspaceStore } from '@/store/workspaceStore'
import type { Element, Workspace } from '@/types'

type SearchItem = Pick<Element, 'id' | 'title' | 'type' | 'status'>
// Select stabile: condivide cache e richiesta con Kanban/Sidebar (['elements', wsId]).
const selectSearchItems = (els: Element[]): SearchItem[] =>
  els.filter(e => e.status !== 'ARCHIVIATO').map(({ id, title, type, status }) => ({ id, title, type, status }))

const MAX_ELEMENTS = 50

/**
 * Palette comandi globale (⌘K / Ctrl+K): navigazione, cambio workspace, ricerca elementi del
 * workspace corrente per titolo e azioni rapide. Montata una volta nel Layout.
 */
export function CommandPalette() {
  const open = useUiStore(s => s.commandOpen)
  const setOpen = useUiStore(s => s.setCommandOpen)
  const setQuickCaptureOpen = useUiStore(s => s.setQuickCaptureOpen)
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const currentId = useWorkspaceStore(s => s.current?.id)
  const setCurrent = useWorkspaceStore(s => s.setCurrent)
  const mustReset = useAuthStore(s => !!s.user?.mustResetPassword)
  const logout = useAuthStore(s => s.logout)
  const { theme, setTheme } = useTheme()
  const [search, setSearch] = useState('')

  // Scorciatoia globale.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'k') {
        if (mustReset) return
        e.preventDefault()
        setOpen(!useUiStore.getState().commandOpen)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [mustReset, setOpen])

  useEffect(() => { if (!open) setSearch('') }, [open])

  const { data: workspaces = [] } = useQuery<Workspace[]>({ queryKey: ['workspaces'], queryFn: workspacesApi.list })
  const workspace = workspaces.find(w => w.id === currentId) ?? null
  const wsId = workspace?.id

  const { data: aiStatus } = useQuery<{ enabled: boolean }>({
    queryKey: ['ai-status', wsId],
    queryFn: () => aiApi.status(wsId!),
    enabled: !!wsId,
    staleTime: 5 * 60_000,
  })

  // Gli elementi si caricano solo a palette aperta (e di solito sono già in cache).
  const { data: elements = [] } = useQuery({
    queryKey: ['elements', wsId],
    queryFn: () => elementsApi.list(wsId!),
    enabled: open && !!wsId,
    select: selectSearchItems,
  })

  const pages: NavItem[] = useMemo(
    () => [MY_TASKS_ITEM, ...workspaceNavGroups({ workspace, aiEnabled: !!aiStatus?.enabled }).flatMap(g => g.items), SETTINGS_ITEM],
    [workspace, aiStatus?.enabled],
  )

  // Filtro elementi fatto qui (non da cmdk) per limitare i risultati renderizzati.
  const q = search.trim().toLowerCase()
  const matchedElements = useMemo(() => {
    if (!q) return []
    const out: SearchItem[] = []
    for (const e of elements) {
      if (e.title.toLowerCase().includes(q)) {
        out.push(e)
        if (out.length >= MAX_ELEMENTS) break
      }
    }
    return out
  }, [elements, q])

  const run = (fn: () => void) => {
    setOpen(false)
    fn()
  }

  return (
    <CommandDialog open={open} onOpenChange={setOpen} title="Palette comandi">
      <CommandInput value={search} onValueChange={setSearch} placeholder={wsId ? 'Cerca pagine, elementi, azioni…' : 'Cerca pagine e azioni…'} />
      <CommandList>
        <CommandEmpty>Nessun risultato.</CommandEmpty>

        {wsId && (
          <CommandGroup heading="Azioni">
            <CommandItem value="azione nuova task elemento crea" onSelect={() => run(() => setQuickCaptureOpen(true))}>
              <Plus className="h-4 w-4" /> Nuova task…
            </CommandItem>
          </CommandGroup>
        )}

        {matchedElements.length > 0 && (
          <CommandGroup heading="Elementi" forceMount>
            {matchedElements.map(e => (
              <CommandItem
                key={e.id}
                // Il valore include il testo cercato: l'elemento è già filtrato qui, cmdk non lo scarta.
                value={`elemento ${e.id} ${e.title} ${q}`}
                onSelect={() => run(() => navigate(`/workspace/${wsId}/element/${e.id}`))}
              >
                <TypeIcon type={e.type} />
                <span className="truncate">{e.title}</span>
                <CommandShortcut>{TYPE_LABELS[e.type] ?? e.type}</CommandShortcut>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        <CommandGroup heading="Vai a">
          {pages.map(item => {
            const Icon = item.icon
            return (
              <CommandItem
                key={item.id}
                value={`pagina ${item.label} ${(item.keywords ?? []).join(' ')}`}
                onSelect={() => run(() => navigate(item.to))}
              >
                <Icon className="h-4 w-4 text-muted-foreground" />
                {item.label}
              </CommandItem>
            )
          })}
        </CommandGroup>

        {workspaces.length > 1 && (
          <CommandGroup heading="Cambia workspace">
            {workspaces.map(ws => (
              <CommandItem
                key={ws.id}
                value={`workspace ${ws.name} ${ws.id}`}
                onSelect={() => run(() => {
                  setCurrent(ws)
                  navigate(workspaceSwitchPath(pathname, ws.id))
                })}
              >
                <WorkspaceAvatar name={ws.name} avatar={ws.avatar} size="sm" />
                <span className="truncate">{ws.name}</span>
                {ws.id === wsId && <Check className="ml-auto h-4 w-4 text-primary" aria-label="Attivo" />}
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        <CommandSeparator />
        <CommandGroup heading="Preferenze">
          {([
            { value: 'light', label: 'Tema chiaro', icon: Sun },
            { value: 'dark', label: 'Tema scuro', icon: Moon },
            { value: 'system', label: 'Tema di sistema', icon: Monitor },
          ] as const).map(t => (
            <CommandItem key={t.value} value={`tema ${t.label}`} onSelect={() => run(() => setTheme(t.value))}>
              <t.icon className="h-4 w-4 text-muted-foreground" />
              {t.label}
              {theme === t.value && <Check className="ml-auto h-4 w-4 text-primary" aria-label="Attivo" />}
            </CommandItem>
          ))}
          <CommandItem value="esci disconnetti logout" onSelect={() => run(() => { logout(); navigate('/login') })}>
            <LogOut className="h-4 w-4 text-muted-foreground" />
            Disconnetti
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  )
}
