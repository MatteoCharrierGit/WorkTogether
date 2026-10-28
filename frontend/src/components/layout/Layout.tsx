import { useCallback, useEffect, useState } from 'react'
import { Outlet, useNavigate, useLocation } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Menu, Search } from 'lucide-react'
import { Sidebar } from './Sidebar'
import { routeTitle } from './nav'
import { useRealtimeSync } from './useRealtimeSync'
import { Channel, Workspace } from '@/types'
import { workspacesApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import {
  notificationsEnabled, requestNotificationPermission, notificationPermission,
  appIsForeground, getActiveChatChannel, showChatNotification,
} from '@/lib/notifications'
import { QuickCapture } from '@/components/QuickCapture'
import { WelcomeTour } from '@/components/WelcomeTour'
import { CommandPalette } from '@/components/CommandPalette'
import { VoiceSessionProvider } from '@/contexts/VoiceSession'
import { VoiceBar } from '@/components/voice/VoiceBar'
import { ScreenShareOverlay } from '@/components/voice/ScreenShareOverlay'
import { PresenceManager } from '@/components/PresenceManager'
import { NotificationBell } from '@/components/notifications/NotificationBell'
import { IconButton } from '@/components/ui/icon-button'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'
import { useAuthStore } from '@/store/authStore'
import { useWorkspaceStore } from '@/store/workspaceStore'
import { useUiStore } from '@/store/uiStore'
import { connectWS } from '@/lib/websocket'
import {
  ToastProvider, ToastViewport, Toast, ToastTitle, ToastClose, useToasts, toast
} from '@/components/ui/toast'

function Toaster() {
  const toasts = useToasts()
  return (
    <ToastProvider>
      {toasts.map(t => (
        <Toast key={t.id} variant={t.variant}>
          <ToastTitle>{t.title}</ToastTitle>
          <ToastClose />
        </Toast>
      ))}
      <ToastViewport />
    </ToastProvider>
  )
}

export function Layout() {
  const hasToken = useAuthStore(s => !!s.accessToken)
  const meId = useAuthStore(s => s.user?.id)
  const workspaceId = useWorkspaceStore(s => s.current?.id)
  const setCurrentWorkspace = useWorkspaceStore(s => s.setCurrent)
  const collapsed = useUiStore(s => s.sidebarCollapsed)
  const setCommandOpen = useUiStore(s => s.setCommandOpen)
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const location = useLocation()

  // Lista autorevole dei workspace dell'utente. Serve a non mostrare info di un workspace
  // di cui non si fa (più) parte: se il "current" persistito non è tra i propri (login
  // nuovo, workspace eliminato o utente rimosso), lo si azzera e si torna alla home.
  const { data: myWorkspaces } = useQuery<Workspace[]>({
    queryKey: ['workspaces'],
    queryFn: workspacesApi.list,
    enabled: hasToken,
  })
  useEffect(() => {
    if (!myWorkspaces || !workspaceId) return
    if (!myWorkspaces.some(w => w.id === workspaceId)) {
      setCurrentWorkspace(null)
      navigate('/', { replace: true })
    }
  }, [myWorkspaces, workspaceId, setCurrentWorkspace, navigate])

  // Drawer della sidebar su mobile (< md); si richiude a ogni cambio pagina.
  const [navOpen, setNavOpen] = useState(false)
  useEffect(() => { setNavOpen(false) }, [location.pathname])

  // Connessione unica: il token corrente viene letto a ogni (ri)connessione (beforeConnect).
  useEffect(() => {
    if (hasToken) connectWS()
  }, [hasToken])

  // Chiede una volta il permesso per le notifiche desktop (se l'utente non l'ha negato).
  useEffect(() => {
    if (hasToken && notificationsEnabled() && notificationPermission() === 'default') {
      requestNotificationPermission()
    }
  }, [hasToken])

  // Notifica un nuovo messaggio: notifica di sistema se la finestra non è in primo
  // piano, altrimenti un toast in-app (a meno che non si stia già leggendo quel canale).
  const notifyMessage = useCallback((p: any) => {
    if (!workspaceId || !p || !p.channelId || p.authorId === meId) return
    if (!notificationsEnabled()) return
    // Solo per i canali visibili a questo utente (esclude le stanze di cui non è membro).
    const channels = queryClient.getQueryData<Channel[]>(['channels', workspaceId])
    const ch = channels?.find(c => c.id === p.channelId)
    if (!ch) return
    if (getActiveChatChannel() === p.channelId && appIsForeground()) return
    const author = p.authorName || 'Qualcuno'
    // Niente contenuto: il topic è di tutto il workspace, quindi il backend non lo invia.
    const title = ch.type === 'DM' ? author : `${author} · ${ch.name}`
    const body = ch.type === 'DM' ? 'Ti ha inviato un messaggio' : 'Nuovo messaggio'
    const open = () => navigate(`/workspace/${workspaceId}/chat?c=${p.channelId}`)
    if (appIsForeground()) toast(`Nuovo messaggio da ${title}`, 'info')
    else showChatNotification({ title, body, tag: p.channelId, onClick: open })
  }, [workspaceId, meId, queryClient, navigate])

  // Sincronizzazione realtime: invalidazioni mirate per evento (scoped per wsId, raggruppate).
  useRealtimeSync({ workspaceId, meId, onMessage: notifyMessage })

  const title = routeTitle(location.pathname)

  return (
    <VoiceSessionProvider>
      <div className="flex h-dvh overflow-hidden bg-background">
        {/* Link "salta al contenuto": primo elemento raggiungibile con Tab, visibile solo a fuoco. */}
        <a
          href="#main-content"
          onClick={e => { e.preventDefault(); document.getElementById('main-content')?.focus() }}
          className="sr-only z-toast rounded-md bg-background px-3 py-2 text-sm font-medium shadow-md focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus-ring"
        >
          Vai al contenuto
        </a>
        {/* Sidebar desktop: piena o rail di icone (preferenza persistita). */}
        <aside
          aria-label="Navigazione principale"
          className={cn(
            'hidden shrink-0 border-r border-sidebar-border transition-[width] duration-200 ease-out md:flex',
            collapsed ? 'w-14' : 'w-60',
          )}
        >
          <Sidebar collapsed={collapsed} />
        </aside>

        {/* Sidebar mobile: drawer. */}
        <Sheet open={navOpen} onOpenChange={setNavOpen}>
          <SheetContent side="left" hideClose className="w-72 max-w-[85vw] p-0 md:hidden" aria-describedby={undefined} onOpenAutoFocus={e => e.preventDefault()}>
            <SheetTitle className="sr-only">Menu di navigazione</SheetTitle>
            <Sidebar variant="drawer" />
          </SheetContent>
        </Sheet>

        <main id="main-content" tabIndex={-1} className="flex min-w-0 flex-1 flex-col overflow-hidden outline-none">
          {/* Barra mobile minimale: le pagine hanno già il proprio PageHeader. */}
          <header className="z-header flex h-12 shrink-0 items-center gap-1 border-b bg-background/95 px-2 backdrop-blur md:hidden">
            <IconButton label="Apri menu" onClick={() => setNavOpen(true)} icon={<Menu />} />
            <span className="min-w-0 flex-1 truncate px-1 text-sm font-semibold">{title}</span>
            <IconButton label="Cerca" onClick={() => setCommandOpen(true)} icon={<Search />} />
            <NotificationBell />
          </header>
          <Outlet />
        </main>
        <CommandPalette />
        <QuickCapture />
        <Toaster />
        <WelcomeTour />
        {/* Voce/screen share: barra di controllo e visualizzatore persistenti su tutte le pagine. */}
        <VoiceBar />
        <ScreenShareOverlay />
        {/* Presenza online / in chiamata (heartbeat + realtime). */}
        <PresenceManager />
      </div>
    </VoiceSessionProvider>
  )
}
