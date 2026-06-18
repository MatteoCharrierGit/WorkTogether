import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ThemeProvider } from '@/components/layout/ThemeProvider'
import { Layout } from '@/components/layout/Layout'
import { ProtectedRoute } from '@/components/ProtectedRoute'
import LoginPage from '@/pages/LoginPage'
import ForceResetPage from '@/pages/ForceResetPage'
import WorkspaceHomePage from '@/pages/WorkspaceHomePage'
import KanbanPage from '@/pages/KanbanPage'
import RoadmapPage from '@/pages/RoadmapPage'
import CalendarPage from '@/pages/CalendarPage'
import ElementDetailPage from '@/pages/ElementDetailPage'
import AdminPage from '@/pages/AdminPage'
import MyTasksPage from '@/pages/MyTasksPage'
import SettingsPage from '@/pages/SettingsPage'
import DrivePage from '@/pages/DrivePage'

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
          <Routes>
            {/* Public */}
            <Route path="/login" element={<LoginPage />} />
            <Route path="/force-reset" element={<ForceResetPage />} />

            {/* Protected */}
            <Route element={<ProtectedRoute />}>
              <Route element={<Layout />}>
                <Route path="/" element={<WorkspaceHomePage />} />
                <Route path="/my-tasks" element={<MyTasksPage />} />
                <Route path="/settings" element={<SettingsPage />} />
                <Route path="/workspace/:wsId/drive" element={<DrivePage />} />
                <Route path="/workspace/:wsId" element={<WorkspaceHomePage />} />
                <Route path="/workspace/:wsId/kanban" element={<KanbanPage />} />
                <Route path="/workspace/:wsId/roadmap" element={<RoadmapPage />} />
                <Route path="/workspace/:wsId/calendar" element={<CalendarPage />} />
                <Route path="/workspace/:wsId/element/:elementId" element={<ElementDetailPage />} />
                <Route path="/workspace/:wsId/admin" element={<AdminPage />} />
              </Route>
            </Route>

            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </ThemeProvider>
    </QueryClientProvider>
  )
}
