import { useEffect } from 'react'
import { Outlet } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Sidebar } from './Sidebar'
import { QuickCapture } from '@/components/QuickCapture'
import { useAuthStore } from '@/store/authStore'
import { useWorkspaceStore } from '@/store/workspaceStore'
import { connectWS, subscribeWorkspace } from '@/lib/websocket'
import {
  ToastProvider, ToastViewport, Toast, ToastTitle, ToastClose, useToasts
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
  const workspaceId = useWorkspaceStore(s => s.current?.id)
  const queryClient = useQueryClient()

  useEffect(() => {
    if (token) connectWS(token)
  }, [token])

  // Sincronizzazione realtime centralizzata: qualsiasi evento sul workspace
  // corrente aggiorna board, dettaglio, "le mie task" e drive (anche da altri client).
  useEffect(() => {
    if (!workspaceId) return
    const unsub = subscribeWorkspace(workspaceId, () => {
      queryClient.invalidateQueries({ queryKey: ['elements'] })
      queryClient.invalidateQueries({ queryKey: ['element'] })
      queryClient.invalidateQueries({ queryKey: ['my-tasks'] })
      queryClient.invalidateQueries({ queryKey: ['drive-folders'] })
      queryClient.invalidateQueries({ queryKey: ['drive-files'] })
    })
    return unsub
  }, [workspaceId, queryClient])

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar />
      <main className="flex-1 overflow-hidden flex flex-col">
        <Outlet />
      </main>
      <QuickCapture />
      <Toaster />
    </div>
  )
}
