# WorkTogether

> **Versione: v1.0** · release corrente (giugno 2026)

Piattaforma self-hosted di **collaborazione e task management** per piccoli team, con:

- **Kanban / Roadmap / Calendario** su una gerarchia *Epica → Storia → Task* + *Eventi*.
- **Drive** di workspace (cartelle, file, editor di testo/codice con lock di modifica).
- **Akari**, agente AI integrato (OpenRouter) che agisce sul workspace via tool, scrive email e crea eventi.
- **Chat in stile Discord**: messaggi diretti, gruppi, stanze, **voce** e **condivisione schermo** (LiveKit), con **presenza** online/in-chiamata.
- **Email** formattate in Markdown e **automazioni** schedulate (promemoria, recap, digest).
- **API key** con scope per integrazioni esterne (es. bot Discord).
- **Backup / ripristino / trasporto** della workspace come JSON (Admin → Backup): export selettivo (impostazioni, membri, tag, elementi, chat, AI) e import che ricrea una nuova workspace. Esclusi: chiave AI e file del Drive.

Stack: **Spring Boot 3 / Java 21 / PostgreSQL** (backend) · **React + Vite + TypeScript + Tailwind/shadcn** (frontend) · **LiveKit** (media SFU) · **Docker Compose** (deploy).

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
# modifica password, JWT_SECRET (e, per la voce, le variabili LIVEKIT_*) in .env

# Solo postgres + backend
docker compose up -d --build

# Con il frontend servito da nginx (porta 80)
docker compose --profile frontend up -d --build

# Con il media server per la voce/screen share
docker compose --profile media up -d --build
```

Credenziali admin iniziali e flusso di setup: vedi [AVVIO.md](./AVVIO.md).

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
├── .env.example            # variabili d'ambiente (DB, JWT, mail, LiveKit)
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
- **Auth**: JWT (access + refresh token) per le persone; **API key** `wt_…` con scope per i servizi.
- **Realtime**: WebSocket STOMP (broadcast sul workspace) per eventi su elementi, chat, presenza.
- **Voce/Schermo**: container LiveKit dedicato; Spring firma i token d'accesso. Niente webcam, niente registrazioni.

Stato e roadmap delle funzioni realtime: [PIANO_DISCORD.md](./PIANO_DISCORD.md) (fasi 0→4 completate lato codice).
