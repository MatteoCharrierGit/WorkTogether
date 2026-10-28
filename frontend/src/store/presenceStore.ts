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

/** True se le due mappe contengono gli stessi utenti con lo stesso canale vocale. */
function samePresence(a: Record<string, PresenceEntry>, b: Record<string, PresenceEntry>): boolean {
  const ka = Object.keys(a)
  if (ka.length !== Object.keys(b).length) return false
  for (const k of ka) {
    const eb = b[k]
    if (!eb || (eb.inCallChannelId ?? null) !== (a[k].inCallChannelId ?? null)) return false
  }
  return true
}

export const usePresenceStore = create<PresenceState>((set, get) => ({
  online: {},
  // Heartbeat ed eventi PRESENCE arrivano spesso con lo stesso contenuto: se nulla è cambiato
  // non ricreiamo l'oggetto, così i componenti iscritti a `online` non si ri-renderizzano.
  setAll: (entries) => {
    const next = Object.fromEntries(entries.map(e => [e.userId, e]))
    if (samePresence(get().online, next)) return
    set({ online: next })
  },
  clear: () => {
    if (Object.keys(get().online).length === 0) return
    set({ online: {} })
  },
  isOnline: (userId) => !!get().online[userId],
  inCallChannel: (userId) => get().online[userId]?.inCallChannelId ?? null,
}))

/** Selettore granulare: ri-renderizza solo quando cambia lo stato online di QUESTO utente. */
export function useIsOnline(userId: string | null | undefined): boolean {
  return usePresenceStore(s => (userId ? !!s.online[userId] : false))
}

/** Canale vocale in cui si trova l'utente (null se non in chiamata/offline). */
export function useInCallChannel(userId: string | null | undefined): string | null {
  return usePresenceStore(s => (userId ? s.online[userId]?.inCallChannelId ?? null : null))
}
