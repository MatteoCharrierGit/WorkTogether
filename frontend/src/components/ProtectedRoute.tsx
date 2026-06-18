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
  const { user, accessToken, refreshToken } = useAuthStore()

  // Nessuna sessione: vai al login.
  if (!accessToken || !user) return <Navigate to="/login" replace />

  // Access token scaduto e nessun refresh token utile: sessione morta → login.
  // (Se c'è il refresh token lasciamo entrare: l'interceptor rinnova al primo 401.)
  if (isJwtExpired(accessToken) && !refreshToken) {
    return <Navigate to="/login" replace />
  }

  if (user.mustResetPassword) return <Navigate to="/force-reset" replace />

  return <Outlet />
}
