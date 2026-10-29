# Frontend — WorkTogether

> Documentazione v1.0 · React 18 + Vite + TypeScript + Tailwind/shadcn · vedi anche [REALTIME_VOCE](./REALTIME_VOCE.md)

## 1. Stack e build

- **React 18 + Vite 5 + TypeScript** (build: `tsc && vite build`).
- **Tailwind CSS** + **shadcn/ui** (componenti Radix in `components/ui`).
- **State**: [Zustand](https://github.com/pmndrs/zustand) per lo stato globale; **@tanstack/react-query**
  per data fetching/cache. **axios** per le chiamate HTTP.
- **Realtime**: STOMP via `@stomp/stompjs` + `sockjs-client`.
- **Voce/Schermo**: `livekit-client`.
- **Editor**: TipTap (testo ricco) e CodeMirror (codice).

```bash
cd frontend
npm install
npm run dev      # http://localhost:5173 (API proxata su :8080)
npm run build    # type-check + bundle di produzione in dist/
```

## 2. Struttura

```
src/
  main.tsx, App.tsx          # bootstrap + routing
  pages/                     # una pagina per route
  components/
    layout/                  # Layout, Sidebar, Breadcrumbs, ThemeProvider
    ui/                      # primitive shadcn (button, dialog, dropdown, toast, …)
    editor/                  # BlockEditor (TipTap), CodeEditor (CodeMirror)
    voice/                   # VoiceBar, ScreenShareOverlay, RoomVoicePanel
    PresenceManager, QuickCapture, WelcomeTour, UserAvatar, ProtectedRoute, …
  contexts/VoiceSession.tsx  # sessione voce/screen share globale (LiveKit)
  store/                     # zustand: authStore, workspaceStore, presenceStore
  lib/                       # auth.ts (OIDC), api.ts, websocket.ts, markdown.ts, utils, hook vari
  types/index.ts             # tipi condivisi (entità, WsEvent, …)
```

## 3. Routing (`App.tsx`)

Route pubbliche: `/login` (schermata di accesso con il pulsante *Accedi con Authentik*, nessuna
registrazione) e `/callback` (rientro da Authentik). Tutto il resto è dietro `ProtectedRoute`
(che attende il ripristino della sessione e altrimenti manda a `/login?returnTo=…`); `/invite/:token`
è protetta ma fuori dal `Layout`. Le altre route stanno anche dentro `Layout`:

| Route | Pagina |
|-------|--------|
| `/`, `/workspace/:wsId` | `WorkspaceHomePage` |
| `/my-tasks` | `MyTasksPage` |
| `/settings` | `SettingsPage` |
| `/workspace/:wsId/kanban` | `KanbanPage` |
| `/workspace/:wsId/roadmap` | `RoadmapPage` |
| `/workspace/:wsId/calendar` | `CalendarPage` |
| `/workspace/:wsId/element/:elementId` | `ElementDetailPage` |
| `/workspace/:wsId/drive` | `DrivePage` |
| `/workspace/:wsId/assistant` | `AssistantPage` (Akari) |
| `/workspace/:wsId/chat` | `ChatPage` (DM/gruppi/stanze/voce) |
| `/workspace/:wsId/sprint` | `SprintPage` (Planning / Sprint attiva / Archivio) |
| `/workspace/:wsId/mail` | `MailPage` (solo admin) |
| `/workspace/:wsId/admin` | `AdminPage` |

## 4. Layout e contesti globali

`components/layout/Layout.tsx` avvolge tutte le route protette e **non si rimonta** al cambio pagina.
Vi sono ancorati gli elementi che devono persistere:

- `connectWS(token)` + `subscribeWorkspace(wsId, …)` per il realtime centralizzato (invalidazione query).
- **`VoiceSessionProvider`** (`contexts/VoiceSession.tsx`): tiene la connessione LiveKit, i partecipanti,
  mute, screen share, microfoni e lo stato di riconnessione. Espone l'hook `useVoiceSession()`.
- **`VoiceBar`** (barra di controllo persistente) e **`ScreenShareOverlay`** (visualizzatore schermo
  flottante): visibili su qualsiasi pagina mentre si è in chiamata → **la call non blocca l'app**.
- **`PresenceManager`** (senza UI): heartbeat di presenza + aggiornamento store sugli eventi `PRESENCE`.

## 5. Stato (Zustand) e dati (React Query)

| Store | Contenuto |
|-------|-----------|
| `store/authStore` | stato della sessione (`loading/authenticated/anonymous`), utente dell'app, copia dell'access token corrente (non persistito: i token li tiene oidc-client-ts in sessionStorage) |
| `store/workspaceStore` | workspace corrente (persistito) |
| `store/presenceStore` | mappa `userId → { inCallChannelId }` degli utenti online |

React Query gestisce liste/cache (es. `['channels', wsId]`, `['messages', wsId, channelId]`,
`['members', wsId]`, elementi, drive). Gli eventi realtime invalidano le query interessate.

## 6. Livello API e realtime (`lib/`)

- **`lib/auth.ts`** — login tramite **Authentik** con `oidc-client-ts` (vedi §12): `initAuth`,
  `login(returnTo)`, `completeLogin`, `logout`, `getAccessToken` (rinnova se scade entro 30 s),
  `renewAccessToken` (refresh token, deduplicato), `accountUrl` (pagina account di Authentik).
- **`lib/api.ts`** — istanza axios + interceptor: aggiunge il Bearer corrente; su `401` rinnova una
  volta e ripete la richiesta, altrimenti torna alla schermata di accesso.
  Espone i moduli: `adminUsersApi`, `workspacesApi`, `elementsApi`, `tagsApi`, `usersApi`, `driveApi`,
  `apiKeysApi`, `aiApi`, `emailApi`, `channelsApi` (incl. `voiceToken`), `attachmentsApi`,
  `presenceApi`. I tipi `VoiceToken` e `PresenceEntryDto` vivono qui.
- **`lib/websocket.ts`** — singola connessione STOMP condivisa; `subscribeWorkspace` consente **più
  handler** per lo stesso workspace (es. Layout + ChatPage + PresenceManager) con una sola subscription.
- **`lib/markdown.ts`**, **`lib/utils.ts`** (incl. `cn`), hook `useIsDark`, `useElementDelete`.

## 7. Voce e schermo (frontend)

Tre componenti pilotano l'unica sessione globale (`useVoiceSession`):

- **`RoomVoicePanel`** — pannello inline nell'header di una stanza vocale in ChatPage (entra/esci,
  mute, condividi schermo, lista partecipanti, stato riconnessione).
- **`VoiceBar`** — barra persistente (stile Discord) con gli stessi controlli, sempre raggiungibile.
- **`ScreenShareOverlay`** — riquadro flottante e ridimensionabile dello schermo condiviso (un publisher
  per volta), richiudibile.

Dettagli su token, qualità (audio Opus; screen share 1080p a ~15 fps), presenza e ops in
[REALTIME_VOCE](./REALTIME_VOCE.md).

## 8. Note UX

- **Responsive**: la ChatPage a due pannelli collassa su mobile (lista ↔ thread con freccia "indietro").
- **Tema** chiaro/scuro via `ThemeProvider`. **Tour di benvenuto** al primo accesso (`WelcomeTour`,
  flag `onboardingCompleted`). **QuickCapture** per creare velocemente elementi.

## 9. Novità v1.1

- **Welcome flow**: `logout()` azzera anche il `workspaceStore` persistito (così il prossimo utente
  sullo stesso browser non eredita il workspace del precedente). La `Sidebar` mostra il menu del
  workspace solo se l'utente ne è davvero membro (`showWorkspaceNav`), ripulendo `current` se obsoleto.
- **Sidebar responsive**: sotto `md` è un *drawer* fuori schermo con hamburger nell'header e backdrop
  (`Layout`), statica su desktop. Il `ScreenShareOverlay` massimizzato è a tutta larghezza su mobile
  (`left-0 md:left-60`); la `VoiceBar` è `z-50` per restare sopra il video condiviso.
- **Kanban** (`KanbanPage`): le storie sono raggruppate sotto sezioni **Epica** comprimibili
  (`EpicHeader` con barra di avanzamento task completati/totali); storie senza epica nel gruppo
  "Senza epica". Epiche/storie concluse vanno in fondo e si comprimono; i task completati sono attenuati.
- **Drive** (`DrivePage`): upload di **intere cartelle** (`webkitdirectory`, ricrea l'alberatura) e
  toggle **sola lettura** per-file dal menu del file (solo proprietario/admin), con badge sulla riga.
  Aggiornamenti realtime via evento `DRIVE_CHANGED`.
- **Voce**: controlli volume/muta per-partecipante nella `VoiceBar` (vedi REALTIME_VOCE §7).
- **Akari** (`AssistantPage`): le chat condivise si aggiornano in tempo reale (evento `AI_MESSAGE`).

## 10. Novità v1.2

- **Drive — drag & drop di cartelle** (`DrivePage`): oltre ai file si possono trascinare intere
  cartelle. Il `DataTransfer` viene "fotografato" in modo sincrono (`snapshotDrop`) e poi i
  `FileSystemEntry` sono espansi ricorsivamente (`walkEntry`, `webkitGetAsEntry`) in una lista di
  `{ file, relPath }` caricata da `uploadEntries` (stessa logica dell'upload cartella da input).
- **Drive — cartelle sola lettura**: toggle nel menu della cartella (solo proprietario/admin) che
  applica il permesso in cascata; badge "sola lettura" su file e cartelle bloccati.
- ~~**Sessione singola**~~: rimossa con il login tramite Authentik (§12).

## 11. Novità v1.3

- **Drive — download cartelle** (`DrivePage`): voce "Scarica (ZIP)" nel menu della cartella, ora
  disponibile a **tutti i membri** (prima il menu compariva solo a proprietario/admin).
  `driveApi.downloadFolder` scarica via fetch autenticata (blob → link temporaneo, per portare il Bearer).
- **Gestione Sprint** (`SprintPage`, `sprintApi`): pagina a 3 tab —
  **Planning** (crea/modifica/avvia/elimina sprint, solo admin),
  **Sprint attiva** (header con obiettivo/date/progress bar, mini-board a 3 colonne Backlog/In corso/Completati
  con badge bloccanti, **timeline** dei completamenti, **chat** della sprint, chiusura admin con scelta
  carry-over dei task incompleti e retrospettiva) e **Archivio** (sprint chiuse con retrospettiva).
  La chat riusa `channelsApi` (canale di tipo `SPRINT`). Aggiornamenti realtime via evento `SPRINT_CHANGED`
  (gestito in `Layout` e in `SprintPage`); voce **Sprint** in `Sidebar`.
- **Visibilità Sprint (toggle admin)**: la voce in `Sidebar` compare solo se `workspace.sprintEnabled`;
  **di default è nascosta**. L'admin la attiva in `AdminPage` (Impostazioni → *Funzionalità*). La route
  `SprintPage` è protetta: con sezione disattivata l'accesso diretto via URL reindirizza alla home del workspace.

## 12. Accesso con Authentik (OIDC)

- **Libreria**: `oidc-client-ts`, configurata in `lib/auth.ts` con `VITE_OIDC_AUTHORITY` (issuer,
  es. `https://auth.mchaservice.tech/application/o/worktogether/`) e `VITE_OIDC_CLIENT_ID`
  (`worktogether`), passati come build arg (vedi `frontend/Dockerfile`). Frontend e API stanno sulla
  stessa origine (`VITE_API_URL` vuoto).
- **Flusso**: `/login` → `signinRedirect` (Authorization Code + **PKCE**, scope
  `openid profile email offline_access`, `returnTo` nello `state`) → Authentik → `/callback`
  (`CallbackPage` → `completeLogin`: scambio del codice, `GET /api/users/me`, apertura di `returnTo`).
  Se il backend rifiuta l'account (403 con messaggio) la pagina mostra l'errore con *Riprova* /
  *Esci da Authentik*, senza rimandare in automatico ad Authentik (niente loop).
- **Token**: in `sessionStorage` (user store e state store di oidc-client-ts), mai in localStorage.
  Rinnovo col **refresh token** 30 s prima della scadenza (evento `accessTokenExpiring`); `getAccessToken()`
  lo usa anche su richiesta. All'avvio `initAuth()` (in `main.tsx`) riprende la sessione della scheda.
- **Rinnovo single-flight**: `automaticSilentRenew` di oidc-client-ts è **spento**; timer di scadenza,
  `getAccessToken()` e interceptor del 401 passano tutti da `renewAccessToken()`, che condivide una sola
  promise. Prima il rinnovo automatico della libreria e `renewAccessToken()` potevano partire insieme
  con lo stesso refresh token: Authentik lo ruota, il secondo prendeva `invalid_grant` e la richiesta
  usciva senza token (401, es. sull'heartbeat). Scheda in background (timer rallentati): nessun rinnovo
  perso, perché ogni chiamata passa da `getAccessToken()` che rinnova un token in scadenza o scaduto.
  **Più schede**: i token sono nel `sessionStorage` della scheda, quindi ogni scheda ha la sua sessione e
  il suo refresh token e non si disturbano. Una scheda **duplicata** (copia il `sessionStorage`) parte
  invece con lo stesso refresh token: la prima che rinnova lo invalida e l'altra, al rinnovo, va alla
  schermata di accesso (un clic: la sessione Authentik è ancora valida). Comportamento voluto per
  semplicità (niente `BroadcastChannel`/`navigator.locks`).
- **401**: l'interceptor rinnova una volta e ripete; se non basta → `/login?returnTo=…&expired=1`.
  Le chiamate `fetch` (stream SSE di Akari) prendono il token da `getAccessToken()`.
- **WebSocket**: `beforeConnect` usa `getAccessToken()`; il server chiude la connessione quando il
  token della CONNECT scade e STOMP si riconnette da solo col token nuovo (`onWSConnect` con
  `reconnect: true` riallinea i dati).
- **Logout**: *Disconnetti* (sidebar o palette comandi) pulisce lo stato locale e passa dall'
  **end-session** di Authentik, che riporta a `/login`.
- **Account**: password, email e MFA si gestiscono su Authentik (link in *Impostazioni → Account e
  sicurezza*); in app restano nome visualizzato e foto. Rimosse le pagine di login con password,
  onboarding, password dimenticata e cambio password forzato.
- **Nuovi account**: *Amministrazione → Membri → Nuovo utente* (visibile solo all'admin di sistema):
  username, email, nome, password iniziale e ruolo → `POST /api/admin/users`, che crea l'account in
  Authentik e lo aggiunge al workspace. Gli inviti servono solo per account già esistenti.
  La spunta **«Invia invito per email»** (disattivata, con nota, finché l'email non è valida) manda
  `sendInvite: true`: l'utente riceve username e password temporanea e al primo accesso Authentik gli
  chiede di sceglierne una nuova. Esiti: invito partito ⇒ toast di conferma; account creato ma email non
  partita (`inviteSent: false`) ⇒ il dialog resta aperto con un avviso «Account creato, ma l'email non è
  partita» e il motivo (niente secondo invio del form: l'account esiste già); errore vero ⇒ messaggio
  nel dialog come prima.
