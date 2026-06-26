import { useEffect, useState } from 'react'
import { Outlet, useNavigate, useLocation } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Menu } from 'lucide-react'
import { Sidebar } from './Sidebar'
import { Channel, Workspace } from '@/types'
import { workspacesApi } from '@/lib/api'
import {
  notificationsEnabled, requestNotificationPermission, notificationPermission,
  appIsForeground, getActiveChatChannel, showChatNotification,
} from '@/lib/notifications'
import { QuickCapture } from '@/components/QuickCapture'
import { WelcomeTour } from '@/components/WelcomeTour'
import { VoiceSessionProvider } from '@/contexts/VoiceSession'
import { VoiceBar } from '@/components/voice/VoiceBar'
import { ScreenShareOverlay } from '@/components/voice/ScreenShareOverlay'
import { PresenceManager } from '@/components/PresenceManager'
import { useAuthStore } from '@/store/authStore'
import { useWorkspaceStore } from '@/store/workspaceStore'
import { connectWS, subscribeWorkspace } from '@/lib/websocket'
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
  const token = useAuthStore(s => s.accessToken)
  const meId = useAuthStore(s => s.user?.id)
  const workspaceId = useWorkspaceStore(s => s.current?.id)
  const setCurrentWorkspace = useWorkspaceStore(s => s.setCurrent)
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const location = useLocation()

  // Lista autorevole dei workspace dell'utente. Serve a non mostrare info di un workspace
  // di cui non si fa (più) parte: se il "current" persistito non è tra i propri (login
  // nuovo, workspace eliminato o utente rimosso), lo si azzera e si torna alla home.
  const { data: myWorkspaces } = useQuery<Workspace[]>({
    queryKey: ['workspaces'],
    queryFn: workspacesApi.list,
    enabled: !!token,
  })
  useEffect(() => {
    if (!myWorkspaces || !workspaceId) return
    if (!myWorkspaces.some(w => w.id === workspaceId)) {
      setCurrentWorkspace(null)
      navigate('/', { replace: true })
    }
  }, [myWorkspaces, workspaceId, setCurrentWorkspace, navigate])

  // Drawer della sidebar su mobile (< md). Su desktop la sidebar è sempre visibile (statica).
  const [navOpen, setNavOpen] = useState(false)
  // Chiude il drawer a ogni cambio pagina: navigando da un link la sidebar si richiude da sola.
  useEffect(() => { setNavOpen(false) }, [location.pathname])

  useEffect(() => {
    if (token) connectWS(token)
  }, [token])

  // Chiede una volta il permesso per le notifiche desktop (se l'utente non l'ha negato).
  useEffect(() => {
    if (token && notificationsEnabled() && notificationPermission() === 'default') {
      requestNotificationPermission()
    }
  }, [token])

  // Sincronizzazione realtime centralizzata: qualsiasi evento sul workspace
  // corrente aggiorna board, dettaglio, "le mie task" e drive (anche da altri client).
  useEffect(() => {
    if (!workspaceId) return

    // Notifica un nuovo messaggio: notifica di sistema se la finestra non è in primo
    // piano, altrimenti un toast in-app (a meno che non si stia già leggendo quel canale).
    const notifyMessage = (p: any) => {
      if (!p || !p.channelId || p.authorId === meId) return
      if (!notificationsEnabled()) return
      // Solo per i canali visibili a questo utente (esclude le stanze di cui non è membro).
      const channels = queryClient.getQueryData<Channel[]>(['channels', workspaceId])
      const ch = channels?.find(c => c.id === p.channelId)
      if (!ch) return
      const reading = getActiveChatChannel() === p.channelId && appIsForeground()
      if (reading) return
      const author = p.authorName || 'Qualcuno'
      // Niente contenuto del messaggio nella notifica: il topic è di tutto il workspace,
      // quindi il backend non lo invia. Mostriamo solo chi ha scritto e dove.
      const title = ch.type === 'DM' ? author : `${author} · ${ch.name}`
      const body = ch.type === 'DM' ? 'Ti ha inviato un messaggio' : 'Nuovo messaggio'
      const open = () => navigate(`/workspace/${workspaceId}/chat?c=${p.channelId}`)
      if (appIsForeground()) {
        // Finestra attiva ma altrove: toast discreto, cliccabile non serve qui.
        toast(`💬 ${title}`)
      } else {
        showChatNotification({ title, body, tag: p.channelId, onClick: open })
      }
    }

    const unsub = subscribeWorkspace(workspaceId, ev => {
      // Rimuove subito un workspace dalla cache (dropdown aggiornato all'istante, senza
      // attendere il refetch) e poi invalida per riconciliare con il server.
      const dropWorkspace = (wsId?: string) => {
        const id = wsId ?? workspaceId
        queryClient.setQueryData<Workspace[]>(['workspaces'], old =>
          old ? old.filter(w => w.id !== id) : old)
        queryClient.invalidateQueries({ queryKey: ['workspaces'] })
      }
      // Workspace eliminato: chi è dentro esce subito (niente attesa di un refresh).
      if (ev.type === 'WORKSPACE_DELETED') {
        setCurrentWorkspace(null)
        dropWorkspace(ev.payload?.workspaceId)
        toast('Questo workspace è stato eliminato')
        navigate('/', { replace: true })
        return
      }
      // Membro rimosso: se sono io, vengo espulso dall'area del workspace.
      if (ev.type === 'MEMBER_REMOVED') {
        if (ev.payload?.userId === meId) {
          setCurrentWorkspace(null)
          dropWorkspace()
          toast('Sei stato rimosso da questo workspace')
          navigate('/', { replace: true })
        } else {
          queryClient.invalidateQueries({ queryKey: ['members'] })
        }
        return
      }
      // Presenza: gestita da PresenceManager, non tocca le query dei dati.
      if (ev.type === 'PRESENCE') return
      // Messaggi dell'assistente AI (chat condivise): li gestisce AssistantPage,
      // non riguardano elementi/drive/canali.
      if (ev.type === 'AI_MESSAGE') return
      // Eventi chat: aggiornano solo la lista canali (badge non-letti in sidebar).
      if (ev.type === 'MESSAGE_CREATED' || ev.type.startsWith('CHANNEL_') || ev.type === 'TYPING') {
        if (ev.type !== 'TYPING') {
          queryClient.invalidateQueries({ queryKey: ['channels'] })
        }
        if (ev.type === 'MESSAGE_CREATED') notifyMessage(ev.payload)
        return
      }
      // Tag creati/modificati/eliminati (anche dall'agente AI): aggiorna la lista tag e gli elementi
      // (le card mostrano i tag).
      if (ev.type === 'TAG_CHANGED') {
        queryClient.invalidateQueries({ queryKey: ['tags'] })
        queryClient.invalidateQueries({ queryKey: ['elements'] })
        return
      }
      if (ev.type === 'SPRINT_CHANGED') {
        queryClient.invalidateQueries({ queryKey: ['sprints'] })
        queryClient.invalidateQueries({ queryKey: ['sprint-active'] })
        return
      }
      queryClient.invalidateQueries({ queryKey: ['elements'] })
      queryClient.invalidateQueries({ queryKey: ['element'] })
      queryClient.invalidateQueries({ queryKey: ['my-tasks'] })
      queryClient.invalidateQueries({ queryKey: ['drive-folders'] })
      queryClient.invalidateQueries({ queryKey: ['drive-files'] })
      // Le transizioni di task (status/blocked/sprint) si riflettono anche sulle viste sprint.
      queryClient.invalidateQueries({ queryKey: ['sprints'] })
      queryClient.invalidateQueries({ queryKey: ['sprint-active'] })
    })
    return unsub
  }, [workspaceId, queryClient, meId, navigate])

  return (
    <VoiceSessionProvider>
      <div className="flex h-screen overflow-hidden bg-background">
        <Sidebar mobileOpen={navOpen} />
        {/* Backdrop del drawer su mobile. */}
        {navOpen && (
          <div
            className="fixed inset-0 z-40 bg-black/50 md:hidden"
            onClick={() => setNavOpen(false)}
            aria-hidden
          />
        )}
        <main className="flex-1 overflow-hidden flex flex-col min-w-0">
          {/* Header mobile con hamburger: la sidebar è nascosta sotto md. */}
          <header className="flex items-center gap-2 border-b px-3 py-2 md:hidden">
            <button
              onClick={() => setNavOpen(o => !o)}
              className="rounded-md p-1.5 hover:bg-accent/60"
              aria-label="Apri menu"
            >
              <Menu className="h-5 w-5" />
            </button>
          </header>
          <Outlet />
        </main>
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
