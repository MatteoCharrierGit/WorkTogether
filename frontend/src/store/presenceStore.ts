import { create } from 'zustand'

export interface PresenceEntry { userId: string; inCallChannelId: string | null }

interface PresenceState {
  // userId -> stato di presenza (presente nella mappa = online)
  online: Record<string, PresenceEntry>
  setAll: (entries: PresenceEntry[]) => void
  clear: () => void
  isOnline: (userId: string) => boolean
  inCallChannel: (userId: string) => string | null
}

export const usePresenceStore = create<PresenceState>((set, get) => ({
  online: {},
  setAll: (entries) => set({
    online: Object.fromEntries(entries.map(e => [e.userId, e])),
  }),
  clear: () => set({ online: {} }),
  isOnline: (userId) => !!get().online[userId],
  inCallChannel: (userId) => get().online[userId]?.inCallChannelId ?? null,
}))
