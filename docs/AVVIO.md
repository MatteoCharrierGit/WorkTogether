# WorkTogether — Guida all'avvio

> Documentazione v1.0 · vedi anche [README](./README.md) e la cartella [docs/](./docs).

## Requisiti
- Docker Desktop (o Docker Engine + Compose v2)
- Porte 80, 8080, 5432 libere sulla VPS (per la voce anche 7880/7881/5349 e UDP 50000-50100)

## Avvio rapido (produzione)

```bash
# 1. Clona/copia il progetto sulla VPS
cd worktogether

# 2. Copia e configura le variabili d'ambiente
cp .env.example .env
nano .env          # password del DB, OIDC_*/AUTHENTIK_*, AI_SECRET

# 3. Avvia tutto
docker compose up -d --build

# 4. Controlla i log
docker compose logs -f
```

L'app sarà disponibile su **http://TUO_IP** (porta 80).

### Profili opzionali

`docker compose up` avvia solo **postgres + backend**. Per il resto usa i profili:

```bash
docker compose --profile frontend up -d --build   # serve il frontend con nginx (porta 80)
docker compose --profile media up -d --build       # media server LiveKit (voce/screen share)
```

Per la **voce** servono inoltre le variabili `LIVEKIT_*` in `.env` e il provisioning ops (TLS, DNS,
firewall): vedi [docs/REALTIME_VOCE.md](./docs/REALTIME_VOCE.md).

## Accesso e primo admin

Il login avviene su **Authentik** (OIDC): l'app non ha password proprie. Configura `OIDC_ISSUER`,
`OIDC_AUDIENCE`, `AUTHENTIK_API_URL`, `AUTHENTIK_API_TOKEN` (backend) e `VITE_OIDC_AUTHORITY`,
`VITE_OIDC_CLIENT_ID` (build del frontend). L'utente Authentik con email `ADMIN_INIT_EMAIL`
(verificata) diventa admin dell'app al primo accesso.

## Flusso admin tipico

1. Accedi con il tuo account Authentik (email = `ADMIN_INIT_EMAIL`)
2. Crea il primo workspace (solo admin di sistema)
3. In **Amministrazione → Membri → Nuovo utente** crea gli account del team (username, email, nome,
   password iniziale, ruolo): vengono creati in Authentik e aggiunti al workspace
4. I nuovi utenti accedono con quelle credenziali e cambiano la password dal loro account Authentik
5. Per aggiungere a un altro workspace un account esistente usa **Invita**

## Sviluppo locale

```bash
# Backend
cd backend
mvn spring-boot:run

# Frontend (in un altro terminale)
cd frontend
npm install
npm run dev
```

Il frontend è su `http://localhost:5173`, l'API viene proxata a `http://localhost:8080`.

## Aggiornamento

```bash
docker compose up -d --build
```

I dati PostgreSQL sono persistiti nel volume `postgres_data`.

## Struttura progetto

```
worktogether/
├── docker-compose.yml
├── .env.example
├── livekit/livekit.yaml   ← config media server (profilo "media")
├── docs/                  ← documentazione di progetto
├── backend/               ← Spring Boot 3 + Java 21
│   ├── Dockerfile
│   └── src/
└── frontend/              ← React + Vite + shadcn/ui
    ├── Dockerfile
    ├── nginx.conf
    └── src/
```

## Documentazione

Vedi [README.md](./README.md) per l'indice completo. In breve: [docs/ARCHITETTURA.md](./docs/ARCHITETTURA.md),
[docs/BACKEND.md](./docs/BACKEND.md), [docs/FRONTEND.md](./docs/FRONTEND.md),
[docs/DATABASE.md](./docs/DATABASE.md), [docs/REALTIME_VOCE.md](./docs/REALTIME_VOCE.md),
[API.md](./API.md).
