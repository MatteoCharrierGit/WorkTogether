/**
 * Notifiche desktop per i nuovi messaggi di chat.
 *
 * Strategia: mostra una notifica di sistema (Web Notifications API) quando arriva un
 * messaggio da un altro utente e la finestra non è in primo piano. Se l'app è visibile
 * ma su un'altra pagina/canale, mostra invece un toast in-app (gestito dal Layout).
 * Niente notifiche per i messaggi del canale che si sta già leggendo.
 */

const PREF_KEY = 'wt:notifications'

/** Preferenza utente (default: attive). Indipendente dal permesso del browser. */
export function notificationsEnabled(): boolean {
  return localStorage.getItem(PREF_KEY) !== 'off'
}

export function setNotificationsEnabled(on: boolean): void {
  localStorage.setItem(PREF_KEY, on ? 'on' : 'off')
}

export function notificationsSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window
}

export function notificationPermission(): NotificationPermission {
  return notificationsSupported() ? Notification.permission : 'denied'
}

/** Chiede il permesso al browser (idempotente). Va invocata da un gesto utente. */
export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (!notificationsSupported()) return 'denied'
  if (Notification.permission !== 'default') return Notification.permission
  try {
    return await Notification.requestPermission()
  } catch {
    return Notification.permission
  }
}

// Canale di chat attualmente aperto e visibile: il ChatPage lo aggiorna così che
// non notifichiamo i messaggi della conversazione che l'utente sta già leggendo.
let activeChatChannel: string | null = null
export function setActiveChatChannel(id: string | null): void {
  activeChatChannel = id
}
export function getActiveChatChannel(): string | null {
  return activeChatChannel
}

/** True se la finestra è in primo piano e visibile. */
export function appIsForeground(): boolean {
  return document.visibilityState === 'visible' && document.hasFocus()
}

interface ChatNotifyInput {
  title: string
  body: string
  tag: string
  onClick?: () => void
}

/**
 * Mostra una notifica di sistema. Ritorna true se è stata mostrata (permesso concesso),
 * così il chiamante può decidere un fallback (toast in-app).
 */
export function showChatNotification({ title, body, tag, onClick }: ChatNotifyInput): boolean {
  if (!notificationsEnabled() || !notificationsSupported()) return false
  if (Notification.permission !== 'granted') return false
  try {
    const n = new Notification(title, {
      body,
      tag,            // i messaggi dello stesso canale si sostituiscono invece di accumularsi
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      renotify: false,
    } as NotificationOptions)
    n.onclick = () => {
      window.focus()
      onClick?.()
      n.close()
    }
    return true
  } catch {
    return false
  }
}
