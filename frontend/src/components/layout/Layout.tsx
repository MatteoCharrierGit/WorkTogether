import { useEffect } from 'react'
import { Outlet, useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Sidebar } from './Sidebar'
import { Channel } from '@/types'
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
  const queryClient = useQueryClient()
  const navigate = useNavigate()

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
      // Presenza: gestita da PresenceManager, non tocca le query dei dati.
      if (ev.type === 'PRESENCE') return
      // Eventi chat: aggiornano solo la lista canali (badge non-letti in sidebar).
      if (ev.type === 'MESSAGE_CREATED' || ev.type.startsWith('CHANNEL_') || ev.type === 'TYPING') {
        if (ev.type !== 'TYPING') {
          queryClient.invalidateQueries({ queryKey: ['channels'] })
        }
        if (ev.type === 'MESSAGE_CREATED') notifyMessage(ev.payload)
        return
      }
      queryClient.invalidateQueries({ queryKey: ['elements'] })
      queryClient.invalidateQueries({ queryKey: ['element'] })
      queryClient.invalidateQueries({ queryKey: ['my-tasks'] })
      queryClient.invalidateQueries({ queryKey: ['drive-folders'] })
      queryClient.invalidateQueries({ queryKey: ['drive-files'] })
    })
    return unsub
  }, [workspaceId, queryClient, meId, navigate])

  return (
    <VoiceSessionProvider>
      <div className="flex h-screen overflow-hidden bg-background">
        <Sidebar />
        <main className="flex-1 overflow-hidden flex flex-col">
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
