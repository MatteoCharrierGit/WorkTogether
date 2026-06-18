import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { Workspace } from '@/types'

interface WorkspaceState {
  current: Workspace | null
  setCurrent: (ws: Workspace | null) => void
}

export const useWorkspaceStore = create<WorkspaceState>()(
  persist(
    (set) => ({
      current: null,
      setCurrent: (ws) => set({ current: ws }),
    }),
    { name: 'wt-workspace' }
  )
)
