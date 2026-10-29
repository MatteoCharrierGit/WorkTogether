/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base delle API (vuoto = stessa origine, /api dietro nginx). */
  readonly VITE_API_URL?: string
  /** Issuer OIDC di Authentik, es. https://auth.mchaservice.tech/application/o/worktogether/ */
  readonly VITE_OIDC_AUTHORITY?: string
  /** Client id pubblico (PKCE) dell'applicazione in Authentik. */
  readonly VITE_OIDC_CLIENT_ID?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
