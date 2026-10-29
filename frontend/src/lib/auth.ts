import { UserManager, WebStorageStateStore, type User as OidcUser } from 'oidc-client-ts'
import axios from 'axios'
import type { User } from '@/types'
import { useAuthStore } from '@/store/authStore'
import { useWorkspaceStore } from '@/store/workspaceStore'

/**
 * Accesso tramite Authentik (OIDC, Authorization Code + PKCE, client pubblico).
 *
 * - Token in sessionStorage (gestiti da oidc-client-ts): niente token in localStorage.
 * - Rinnovo con refresh token (scope offline_access) prima della scadenza e su richiesta.
 * - L'access token corrente è rispecchiato in `useAuthStore.accessToken` per i componenti;
 *   chi chiama le API usa `getAccessToken()` (rinnova se scaduto).
 * - Nessuna registrazione: gli account li crea l'admin dal pannello Amministrazione.
 */

const AUTHORITY = (import.meta.env.VITE_OIDC_AUTHORITY ?? '').trim()
const CLIENT_ID = (import.meta.env.VITE_OIDC_CLIENT_ID ?? '').trim() || 'worktogether'
const API_BASE = import.meta.env.VITE_API_URL || '/api'

export const oidcConfigured = AUTHORITY.length > 0

/** Pagina "Account" di Authentik: password, nome, email, MFA. */
export const accountUrl = oidcConfigured ? `${new URL(AUTHORITY).origin}/if/user/#/settings` : null

let manager: UserManager | null = null

export function userManager(): UserManager {
  if (!oidcConfigured) throw new Error('Login non configurato (VITE_OIDC_AUTHORITY)')
  if (!manager) {
    const origin = window.location.origin
    manager = new UserManager({
      authority: AUTHORITY,
      client_id: CLIENT_ID,
      redirect_uri: `${origin}/callback`,
      post_logout_redirect_uri: `${origin}/login`,
      response_type: 'code',
      scope: 'openid profile email offline_access',
      userStore: new WebStorageStateStore({ store: window.sessionStorage }),
      stateStore: new WebStorageStateStore({ store: window.sessionStorage }),
      // Rinnovo automatico ~60 s prima della scadenza, col refresh token (niente iframe).
      automaticSilentRenew: true,
      loadUserInfo: false,
    })
    manager.events.addUserLoaded(u => useAuthStore.getState().setAccessToken(u.access_token))
    manager.events.addSilentRenewError(() => {
      /* il prossimo 401 (o getAccessToken) riproverà e, se serve, riporterà al login */
    })
    manager.events.addUserSignedOut(() => clearLocalSession())
  }
  return manager
}

// ---- Token ----

const EXPIRY_MARGIN_S = 30
let renewing: Promise<string | null> | null = null

/** Rinnova l'access token col refresh token (una sola richiesta alla volta). null se non si può. */
export function renewAccessToken(): Promise<string | null> {
  if (!oidcConfigured) return Promise.resolve(null)
  if (!renewing) {
    renewing = userManager()
      .signinSilent()
      .then(u => {
        const token = u?.access_token ?? null
        useAuthStore.getState().setAccessToken(token)
        return token
      })
      .catch(() => null)
      .finally(() => { renewing = null })
  }
  return renewing
}

/** Access token valido (rinnovato se scade entro 30 s), null se la sessione è finita. */
export async function getAccessToken(): Promise<string | null> {
  if (!oidcConfigured) return null
  const u = await userManager().getUser()
  if (!u) return null
  if (u.expires_in !== undefined && u.expires_in <= EXPIRY_MARGIN_S) return renewAccessToken()
  return u.access_token
}

// ---- Login / logout ----

interface LoginState { returnTo?: string }

function safeReturnTo(path: string | null | undefined): string {
  // Solo percorsi interni (niente open redirect) e mai le pagine di accesso.
  if (!path || !path.startsWith('/') || path.startsWith('//')) return '/'
  if (path.startsWith('/login') || path.startsWith('/callback')) return '/'
  return path
}

/** Porta alla pagina di login di Authentik; al rientro si torna a `returnTo`. */
export async function login(returnTo?: string): Promise<void> {
  await userManager().signinRedirect({ state: { returnTo: safeReturnTo(returnTo) } satisfies LoginState })
}

/** Errore leggibile (es. account non collegabile, 403 dal backend). */
export class LoginError extends Error {}

let callbackPromise: Promise<string> | null = null

/**
 * Completa il login sulla route /callback: scambia il codice (PKCE), carica l'utente dell'app e
 * ritorna il percorso da aprire. Memoizzata: in StrictMode l'effetto gira due volte.
 */
export function completeLogin(): Promise<string> {
  if (!callbackPromise) {
    callbackPromise = (async () => {
      let oidcUser: OidcUser | undefined
      try {
        oidcUser = await userManager().signinCallback()
      } catch (e: any) {
        throw new LoginError(e?.error_description || e?.message || 'Accesso non riuscito')
      }
      if (!oidcUser) throw new LoginError('Accesso non riuscito')
      useAuthStore.getState().setAccessToken(oidcUser.access_token)
      const me = await fetchMe(oidcUser.access_token)
      // Accesso "pulito": niente workspace attivo ereditato da una sessione precedente.
      useWorkspaceStore.getState().setCurrent(null)
      useAuthStore.getState().setSession(me, oidcUser.access_token)
      return safeReturnTo((oidcUser.state as LoginState | undefined)?.returnTo)
    })()
  }
  return callbackPromise
}

async function fetchMe(token: string): Promise<User> {
  try {
    const res = await axios.get<User>(`${API_BASE}/users/me`, { headers: { Authorization: `Bearer ${token}` } })
    return res.data
  } catch (e: any) {
    const msg = e?.response?.data?.error
    if (e?.response?.status === 403 && msg) throw new LoginError(msg)
    if (e?.response?.status === 401) throw new LoginError('Il token di Authentik non è stato accettato dal server')
    throw new LoginError('Impossibile caricare il profilo: riprova')
  }
}

/** All'avvio: riprende la sessione salvata (sessionStorage) se ancora valida o rinnovabile. */
export async function initAuth(): Promise<void> {
  const store = useAuthStore.getState()
  if (!oidcConfigured) { store.setAnonymous(); return }
  if (window.location.pathname === '/callback') return // ci pensa la pagina di callback
  try {
    const token = await getAccessToken()
    if (!token) { store.setAnonymous(); return }
    const me = await fetchMe(token)
    useAuthStore.getState().setSession(me, token)
  } catch (e) {
    await userManager().removeUser().catch(() => {})
    useAuthStore.getState().setAnonymous(e instanceof LoginError ? e.message : undefined)
  }
}

function clearLocalSession() {
  useWorkspaceStore.getState().setCurrent(null)
  useAuthStore.getState().clear()
}

/** Logout: chiude la sessione locale e quella di Authentik (end-session), poi torna a /login. */
export async function logout(): Promise<void> {
  clearLocalSession()
  if (!oidcConfigured) { window.location.assign('/login'); return }
  const um = userManager()
  try {
    await um.signoutRedirect() // id_token_hint dall'utente salvato; post_logout_redirect_uri = /login
  } catch {
    await um.removeUser().catch(() => {})
    window.location.assign('/login')
  }
}

/**
 * Sessione non più valida (401 anche dopo il rinnovo): pulisce e porta alla schermata di accesso,
 * che rimanda ad Authentik con un clic (niente redirect automatici in loop).
 */
export function sessionExpired(): void {
  if (window.location.pathname.startsWith('/login') || window.location.pathname.startsWith('/callback')) return
  const returnTo = window.location.pathname + window.location.search
  if (oidcConfigured) void userManager().removeUser().catch(() => {})
  clearLocalSession()
  window.location.assign(`/login?returnTo=${encodeURIComponent(returnTo)}&expired=1`)
}
