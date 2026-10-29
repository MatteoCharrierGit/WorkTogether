import { create } from 'zustand'
import { User } from '@/types'

/**
 * Stato della sessione. I token veri li custodisce oidc-client-ts (sessionStorage, vedi lib/auth):
 * qui c'è solo una copia dell'access token corrente (per i componenti e le chiamate sincrone) e
 * l'utente dell'app (GET /api/users/me). Niente persistenza: all'avvio `initAuth` ricostruisce tutto.
 */
export type AuthStatus = 'loading' | 'authenticated' | 'anonymous'

interface AuthState {
  status: AuthStatus
  user: User | null
  accessToken: string | null
  /** Messaggio da mostrare nella schermata di accesso (es. account non collegabile). */
  error: string | null
  setSession: (user: User, accessToken: string) => void
  setAccessToken: (accessToken: string | null) => void
  setAnonymous: (error?: string) => void
  updateUser: (user: Partial<User>) => void
  clear: () => void
}

export const useAuthStore = create<AuthState>()(set => ({
  status: 'loading',
  user: null,
  accessToken: null,
  error: null,
  setSession: (user, accessToken) => set({ status: 'authenticated', user, accessToken, error: null }),
  setAccessToken: accessToken => set({ accessToken }),
  setAnonymous: error => set({ status: 'anonymous', user: null, accessToken: null, error: error ?? null }),
  updateUser: partial => set(state => ({ user: state.user ? { ...state.user, ...partial } : null })),
  clear: () => set({ status: 'anonymous', user: null, accessToken: null, error: null }),
}))
