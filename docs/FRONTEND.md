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
  lib/                       # api.ts, websocket.ts, markdown.ts, utils, hook vari
  types/index.ts             # tipi condivisi (entità, WsEvent, …)
```

## 3. Routing (`App.tsx`)

Route pubbliche: `/login`, `/force-reset`. Tutto il resto è dietro `ProtectedRoute` + `Layout`:

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
| `store/authStore` | utente corrente + access/refresh token (persistito) |
| `store/workspaceStore` | workspace corrente (persistito) |
| `store/presenceStore` | mappa `userId → { inCallChannelId }` degli utenti online |

React Query gestisce liste/cache (es. `['channels', wsId]`, `['messages', wsId, channelId]`,
`['members', wsId]`, elementi, drive). Gli eventi realtime invalidano le query interessate.

## 6. Livello API e realtime (`lib/`)

- **`lib/api.ts`** — istanza axios + interceptor (aggiunge il Bearer, fa refresh del token su `401`).
  Espone i moduli: `authApi`, `workspacesApi`, `elementsApi`, `tagsApi`, `usersApi`, `driveApi`,
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
- **Sessione singola**: nessuna modifica UI dedicata — quando la sessione viene invalidata altrove,
  l'interceptor axios (401 → refresh fallito) esegue logout e redirect a `/login`.
