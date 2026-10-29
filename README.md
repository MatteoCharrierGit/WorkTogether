# WorkTogether

> **Versione: v1.3** · release corrente (giugno 2026)

Piattaforma self-hosted di **collaborazione e task management** per piccoli team, con:

- **Kanban / Roadmap / Calendario** su una gerarchia *Epica → Storia → Task* + *Eventi*.
- **Sprint**: pianificazione, sprint attiva con board/progress/timeline e chat dedicata, chiusura con retrospettiva.
- **Drive** di workspace (cartelle, file, editor di testo/codice con lock di modifica, **download cartelle in ZIP**).
- **Akari**, agente AI integrato (OpenRouter) che agisce sul workspace via tool, scrive email e crea eventi.
- **Chat in stile Discord**: messaggi diretti, gruppi, stanze, **voce** e **condivisione schermo** (LiveKit), con **presenza** online/in-chiamata.
- **Email** formattate in Markdown e **automazioni** schedulate (promemoria, recap, digest).
- **API key** con scope per integrazioni esterne (es. bot Discord).
- **Backup / ripristino / trasporto** della workspace come JSON (Admin → Backup): export selettivo (impostazioni, membri, tag, elementi, chat, AI) e import che ricrea una nuova workspace. Esclusi: chiave AI e file del Drive.

Stack: **Spring Boot 3 / Java 21 / PostgreSQL** (backend) · **React + Vite + TypeScript + Tailwind/shadcn** (frontend) · **LiveKit** (media SFU) · **Docker Compose** (deploy).

---

## Novità v1.3 (giugno 2026)

- **Gestione Sprint**: nuova sezione **Sprint** con tre viste — *Planning* (crea/avvia/elimina sprint
  pianificate, solo admin), *Sprint attiva* (obiettivo, date, **progress bar**, board Backlog/In corso/
  Completati, **timeline** dei completamenti, indicatore **task bloccanti** e **chat dedicata**) e
  *Archivio* (sprint chiuse con **retrospettiva**). Avvio e chiusura sono **manuali** e riservati
  all'**admin**; alla chiusura i task incompleti si riportano nel backlog o nella sprint successiva.
  La sezione è **attivabile/nascondibile dall'admin** (Admin → Impostazioni → *Funzionalità*) ed è
  **nascosta di default**.
- **Download cartelle dal Drive**: ogni cartella può essere scaricata come **archivio ZIP** (ricorsivo,
  con l'intera alberatura), da qualsiasi membro.

## Novità v1.2 (giugno 2026)

- **Drag & drop di cartelle**: oltre al pulsante "Carica cartella", si possono trascinare intere
  cartelle (con sottocartelle) direttamente nel Drive; l'alberatura viene ricreata.
- **Cartelle in sola lettura (cascata)**: il proprietario o un admin può marcare una cartella come
  sola lettura; il flag si propaga **in cascata** a tutti i file e sottocartelle contenuti, e i nuovi
  contenuti aggiunti **ereditano** il permesso della cartella.
- ~~**Sessione singola**~~: superata dal login tramite Authentik (vedi *Autenticazione*).

## Novità v1.1 (giugno 2026)

Rifiniture post-test in produzione su realtime, voce/video, UI e Akari.

**Realtime (niente più refresh manuale).**
- Il **Drive** ora trasmette gli eventi: upload (anche di intere cartelle), creazione/rinomina/
  spostamento/eliminazione di file e cartelle compaiono in tempo reale sugli altri client (evento
  WS `DRIVE_CHANGED`).
- Le **chat condivise di Akari** si aggiornano live per tutti i partecipanti (evento `AI_MESSAGE`),
  non solo per chi ha inviato il messaggio.

**Voce/video — disconnessioni robuste.**
- Chiusura/refresh della pagina: il client invia subito un *beacon* (`pagehide`) e lascia la stanza,
  così non resta "online/in chiamata" fantasma.
- **Webhook LiveKit**: in caso di crash o perdita di rete (dove il beacon non parte) è il media server
  a notificare il backend, che azzera lo stato "in chiamata". Vedi [REALTIME_VOCE](./docs/REALTIME_VOCE.md).
- **Controlli audio per-utente**: dalla VoiceBar puoi mutare un singolo partecipante o regolarne il
  volume (solo per te, non per gli altri).

**UI/UX.**
- **Welcome flow**: al logout il workspace attivo viene azzerato e il menu è mostrato solo per i
  workspace di cui sei davvero membro (niente menu "fantasma").
- **Responsive**: sidebar a *drawer* su mobile/tablet (hamburger); il visualizzatore dello schermo
  condiviso è a tutta larghezza su mobile; la barra di controllo chiamata non finisce più sotto il video.
- **Kanban riorganizzata**: le storie sono raggruppate sotto sezioni **Epica** comprimibili con
  avanzamento (task completati/totali); epiche e storie concluse vanno in fondo e si comprimono; i
  task completati sono attenuati.

**Drive — permessi per-file.**
- Ogni file è **modificabile da tutti** i membri per impostazione predefinita; il proprietario o un
  admin può marcare un singolo file come **sola lettura** dal menu del file.

**Akari (agente AI) — tool più ergonomici.**
- Nuovo tool `get_board` (albero Epica▸Storia▸Task con id), filtro `query` su `list_elements`, e un
  *guardrail* che impedisce di creare task "orfani" non visibili in Kanban. Vedi
  [AI_AGENT_DESIGN §15](./docs/AI_AGENT_DESIGN.md).

---

## Documentazione

La documentazione è divisa per area. Parti da qui:

| Documento | Contenuto |
|-----------|-----------|
| [docs/ARCHITETTURA.md](./docs/ARCHITETTURA.md) | Visione d'insieme: componenti, i due binari (nativo + media), realtime, sicurezza |
| [docs/BACKEND.md](./docs/BACKEND.md) | Backend Spring: struttura a package, security (JWT + API key), service, config |
| [docs/FRONTEND.md](./docs/FRONTEND.md) | Frontend React: pagine, componenti, store, contesti, realtime e voce |
| [docs/DATABASE.md](./docs/DATABASE.md) | Modello dati: entità, enum, e tutte le migration Flyway (V1→V12) |
| [docs/REALTIME_VOCE.md](./docs/REALTIME_VOCE.md) | Chat, stanze, voce, screen share e presenza + deploy LiveKit/TURN |
| [docs/SETUP_LOCALE.md](./docs/SETUP_LOCALE.md) | Differenze setup **locale ↔ VPS**: cosa ripristinare prima del deploy (LiveKit) |
| [API.md](./API.md) | **Riferimento API completo**: tutte le rotte REST (pubbliche e private) + uso delle API key |
| [AVVIO.md](./AVVIO.md) | Guida all'avvio e all'aggiornamento (Docker, credenziali, sviluppo locale) |
| [PIANO_DISCORD.md](./PIANO_DISCORD.md) | Piano e handoff delle funzioni Discord-like (fasi 0→4) |
| [AI_AGENT_DESIGN.md](./AI_AGENT_DESIGN.md) | Design dell'agente AI "Akari" |

---

## Avvio rapido

```bash
cp .env.example .env
# imposta password del DB, OIDC_*/AUTHENTIK_*, AI_SECRET (e, per la voce, LIVEKIT_*) in .env

# Solo postgres + backend
docker compose up -d --build

# Con il frontend servito da nginx (porta 80)
docker compose --profile frontend up -d --build

# Con il media server per la voce/screen share
docker compose --profile media up -d --build
```

Primo admin e flusso di setup: vedi *Autenticazione* qui sotto e [AVVIO.md](./AVVIO.md).

## Autenticazione

L'accesso avviene tramite **Authentik** (OIDC, Authorization Code + PKCE, client pubblico
`worktogether`), come gli altri servizi: l'app non gestisce password, registrazioni né reset.

- **Chi entra**: chi ha un account Authentik nel gruppo `worktogether` (policy dell'applicazione).
  Al primo accesso l'utente interno viene creato, o collegato per email verificata a un account
  esistente. L'utente con email `ADMIN_INIT_EMAIL` diventa admin dell'app.
- **Nuovi account**: solo l'admin dell'app, da *Amministrazione → Membri → Nuovo utente* (username,
  email, nome, password iniziale): il backend crea l'account in Authentik via API e lo aggiunge al
  gruppo e al workspace. Gli inviti servono per account già esistenti.
- **Password e profilo**: dalla pagina account di Authentik (link in *Impostazioni*).
- **Integrazioni**: le API key `wt_…` funzionano come prima.

| Variabile | Dove | Note |
|-----------|------|------|
| `OIDC_ISSUER` | backend | `https://auth.mchaservice.tech/application/o/worktogether/` (controllato nel token) |
| `OIDC_AUDIENCE` | backend | client id, `worktogether` |
| `OIDC_JWKS_URL` | backend (opz.) | vuoto = `<issuer>jwks/`; in Docker `http://authentik-server:9000/application/o/worktogether/jwks/` |
| `AUTHENTIK_API_URL` · `AUTHENTIK_API_TOKEN` | backend | API v3 e token di servizio per creare gli account |
| `AUTHENTIK_USER_GROUP` | backend | default `worktogether` |
| `ADMIN_INIT_EMAIL` | backend (opz.) | primo admin dell'app |
| `AI_SECRET` | backend | obbligatorio in produzione (`JWT_SECRET` solo come fallback legacy) |
| `VITE_OIDC_AUTHORITY` · `VITE_OIDC_CLIENT_ID` | build del frontend | issuer e client id per `oidc-client-ts` |

Redirect URI da registrare nel provider: `https://worktogether.mchaservice.tech/callback`; per il
ritorno dopo il logout anche `https://worktogether.mchaservice.tech/login`. Il provider deve
emettere refresh token (scope `offline_access`). Dettagli in [docs/BACKEND.md](./docs/BACKEND.md) §3
e [docs/FRONTEND.md](./docs/FRONTEND.md) §12.

## Sviluppo locale

```bash
# Backend  →  http://localhost:8080
cd backend && mvn spring-boot:run

# Frontend →  http://localhost:5173  (API proxata su :8080)
cd frontend && npm install && npm run dev
```

## Struttura del repository

```
worktogether/
├── docker-compose.yml      # postgres + backend (+ profili: frontend, media)
├── .env.example            # variabili d'ambiente (DB, OIDC/Authentik, mail, LiveKit)
├── livekit/
│   └── livekit.yaml         # config del media server (voce/screen share)
├── backend/                 # Spring Boot 3 + Java 21
│   ├── Dockerfile
│   └── src/main/java/com/worktogether/...
├── frontend/                # React + Vite + shadcn/ui
│   ├── Dockerfile · nginx.conf
│   └── src/...
└── docs/                    # documentazione di progetto (vedi tabella sopra)
```

---

## Capacità in breve

- **Ruoli**: `ADMIN` · `COLLABORATORE` · `GUEST` (i guest sono in sola lettura).
- **Auth**: login con **Authentik** (OIDC + PKCE) per le persone; **API key** `wt_…` con scope per i servizi.
- **Realtime**: WebSocket STOMP (broadcast sul workspace) per eventi su elementi, chat, presenza.
- **Voce/Schermo**: container LiveKit dedicato; Spring firma i token d'accesso. Niente webcam, niente registrazioni.

Stato e roadmap delle funzioni realtime: [PIANO_DISCORD.md](./PIANO_DISCORD.md) (fasi 0→4 completate lato codice).

---

_Ultimo controllo del README: 17 ottobre 2026._
