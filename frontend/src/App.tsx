import { Suspense, lazy } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ThemeProvider } from '@/components/layout/ThemeProvider'
import { Layout } from '@/components/layout/Layout'
import { ProtectedRoute } from '@/components/ProtectedRoute'

// Pagine caricate on-demand (code-splitting): ogni route diventa un chunk separato,
// così l'avvio non scarica tutto il codice di tutte le pagine in un colpo solo.
const LoginPage = lazy(() => import('@/pages/LoginPage'))
const ForceResetPage = lazy(() => import('@/pages/ForceResetPage'))
const OnboardingPage = lazy(() => import('@/pages/OnboardingPage'))
const ForgotPasswordPage = lazy(() => import('@/pages/ForgotPasswordPage'))
const AcceptInvitePage = lazy(() => import('@/pages/AcceptInvitePage'))
const WorkspaceHomePage = lazy(() => import('@/pages/WorkspaceHomePage'))
const KanbanPage = lazy(() => import('@/pages/KanbanPage'))
const RoadmapPage = lazy(() => import('@/pages/RoadmapPage'))
const CalendarPage = lazy(() => import('@/pages/CalendarPage'))
const ElementDetailPage = lazy(() => import('@/pages/ElementDetailPage'))
const AdminPage = lazy(() => import('@/pages/AdminPage'))
const MyTasksPage = lazy(() => import('@/pages/MyTasksPage'))
const SettingsPage = lazy(() => import('@/pages/SettingsPage'))
const DrivePage = lazy(() => import('@/pages/DrivePage'))
const AssistantPage = lazy(() => import('@/pages/AssistantPage'))
const ChatPage = lazy(() => import('@/pages/ChatPage'))
const SprintPage = lazy(() => import('@/pages/SprintPage'))
const MailPage = lazy(() => import('@/pages/MailPage'))

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 30,
      retry: 1,
    },
  },
})

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <BrowserRouter>
          <Suspense fallback={<RouteFallback />}>
          <Routes>
            {/* Public */}
            <Route path="/login" element={<LoginPage />} />
            <Route path="/force-reset" element={<ForceResetPage />} />
            <Route path="/onboarding" element={<OnboardingPage />} />
            <Route path="/forgot-password" element={<ForgotPasswordPage />} />
            <Route path="/invite/:token" element={<AcceptInvitePage />} />

            {/* Protected */}
            <Route element={<ProtectedRoute />}>
              <Route element={<Layout />}>
                <Route path="/" element={<WorkspaceHomePage />} />
                <Route path="/my-tasks" element={<MyTasksPage />} />
                <Route path="/settings" element={<SettingsPage />} />
                <Route path="/workspace/:wsId/drive" element={<DrivePage />} />
                <Route path="/workspace/:wsId/assistant" element={<AssistantPage />} />
                <Route path="/workspace/:wsId/chat" element={<ChatPage />} />
                <Route path="/workspace/:wsId/sprint" element={<SprintPage />} />
                <Route path="/workspace/:wsId" element={<WorkspaceHomePage />} />
                <Route path="/workspace/:wsId/kanban" element={<KanbanPage />} />
                <Route path="/workspace/:wsId/roadmap" element={<RoadmapPage />} />
                <Route path="/workspace/:wsId/calendar" element={<CalendarPage />} />
                <Route path="/workspace/:wsId/element/:elementId" element={<ElementDetailPage />} />
                <Route path="/workspace/:wsId/mail" element={<MailPage />} />
                <Route path="/workspace/:wsId/admin" element={<AdminPage />} />
              </Route>
            </Route>

            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
          </Suspense>
        </BrowserRouter>
      </ThemeProvider>
    </QueryClientProvider>
  )
}

// Fallback mostrato mentre il chunk della pagina viene scaricato.
function RouteFallback() {
  return (
    <div className="flex h-screen items-center justify-center bg-background">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-muted border-t-foreground" />
    </div>
  )
}
