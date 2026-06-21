import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { User } from '@/types'
import { useWorkspaceStore } from '@/store/workspaceStore'

interface AuthState {
  user: User | null
  accessToken: string | null
  refreshToken: string | null
  setAuth: (user: User, accessToken: string, refreshToken: string) => void
  setTokens: (accessToken: string, refreshToken: string) => void
  updateUser: (user: Partial<User>) => void
  logout: () => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      accessToken: null,
      refreshToken: null,
      setAuth: (user, accessToken, refreshToken) => {
        // Login "pulito": azzera il workspace attivo persistito da una sessione precedente,
        // così un nuovo accesso non apre un workspace di un altro utente / non più proprio.
        useWorkspaceStore.getState().setCurrent(null)
        set({ user, accessToken, refreshToken })
      },
      setTokens: (accessToken, refreshToken) =>
        set({ accessToken, refreshToken }),
      updateUser: (partial) =>
        set(state => ({ user: state.user ? { ...state.user, ...partial } : null })),
      logout: () => {
        // Azzera anche il workspace attivo persistito: senza questo il prossimo utente che fa
        // login sullo stesso browser erediterebbe il workspace del precedente (menu/nome sbagliati).
        useWorkspaceStore.getState().setCurrent(null)
        set({ user: null, accessToken: null, refreshToken: null })
      },
    }),
    { name: 'wt-auth' }
  )
)
