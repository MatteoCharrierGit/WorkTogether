# WorkTogether — Guida all'avvio

## Requisiti
- Docker Desktop (o Docker Engine + Compose v2)
- Porta 80, 8080, 5432 libere sulla VPS

## Avvio rapido (produzione)

```bash
# 1. Clona/copia il progetto sulla VPS
cd worktogether

# 2. Copia e configura le variabili d'ambiente
cp .env.example .env
nano .env          # cambia le password e il JWT_SECRET

# 3. Avvia tutto
docker compose up -d --build

# 4. Controlla i log
docker compose logs -f
```

L'app sarà disponibile su **http://TUO_IP** (porta 80).

## Credenziali iniziali

Al primo avvio viene creato automaticamente l'account admin:
- Email: `ADMIN_INIT_EMAIL` (default: `admin@example.com`)
- Password: `ADMIN_INIT_PASSWORD` (default: `Admin1234!`)

> Cambia la password dalla pagina profilo dopo il primo accesso.

## Flusso admin tipico

1. Accedi con l'account admin
2. Vai su **Admin → Membri** e crea gli account del team (email + password temporanea + ruolo)
3. I nuovi utenti accedono e cambiano la password al primo login
4. Crea il primo workspace (solo system admin)
5. Aggiungi i membri al workspace con i rispettivi ruoli

## Sviluppo locale

```bash
# Backend
cd backend
./mvnw spring-boot:run

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
├── backend/          ← Spring Boot 3 + Java 21
│   ├── Dockerfile
│   └── src/
└── frontend/         ← React + Vite + shadcn/ui
    ├── Dockerfile
    ├── nginx.conf
    └── src/
```
