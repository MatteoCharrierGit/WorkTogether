import { create } from 'zustand'

/** Stato UI della shell: palette comandi, cattura rapida, sidebar compatta (persistita). */
interface UiState {
  commandOpen: boolean
  setCommandOpen: (open: boolean) => void
  quickCaptureOpen: boolean
  setQuickCaptureOpen: (open: boolean) => void
  sidebarCollapsed: boolean
  toggleSidebar: () => void
}

const COLLAPSED_KEY = 'wt-sidebar-collapsed'

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === '1'
  } catch {
    return false
  }
}

export const useUiStore = create<UiState>((set, get) => ({
  commandOpen: false,
  setCommandOpen: open => set({ commandOpen: open }),
  quickCaptureOpen: false,
  setQuickCaptureOpen: open => set({ quickCaptureOpen: open }),
  sidebarCollapsed: readCollapsed(),
  toggleSidebar: () => {
    const next = !get().sidebarCollapsed
    try {
      localStorage.setItem(COLLAPSED_KEY, next ? '1' : '0')
    } catch {
      /* storage non disponibile */
    }
    set({ sidebarCollapsed: next })
  },
}))
