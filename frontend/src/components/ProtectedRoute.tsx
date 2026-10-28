import { Navigate, Outlet } from 'react-router-dom'
import { useAuthStore } from '@/store/authStore'

// Decodifica la scadenza (exp) di un JWT senza librerie. true se scaduto o illeggibile.
function isJwtExpired(token: string): boolean {
  try {
    const base64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
    const payload = JSON.parse(atob(base64))
    return typeof payload.exp === 'number' && payload.exp * 1000 <= Date.now()
  } catch {
    return true
  }
}

export function ProtectedRoute() {
  // Selettori granulari: nessun re-render per cambi non rilevanti (es. updateUser di altri campi).
  const hasUser = useAuthStore(s => !!s.user)
  const mustResetPassword = useAuthStore(s => !!s.user?.mustResetPassword)
  const accessToken = useAuthStore(s => s.accessToken)
  const hasRefreshToken = useAuthStore(s => !!s.refreshToken)

  // Nessuna sessione: vai al login.
  if (!accessToken || !hasUser) return <Navigate to="/login" replace />

  // Access token scaduto e nessun refresh token utile: sessione morta → login.
  // (Se c'è il refresh token lasciamo entrare: l'interceptor rinnova al primo 401.)
  if (isJwtExpired(accessToken) && !hasRefreshToken) {
    return <Navigate to="/login" replace />
  }

  if (mustResetPassword) return <Navigate to="/force-reset" replace />

  return <Outlet />
}
