# WorkTogether

App di collaborazione/task management con backend Spring Boot e frontend React.

## Stack

- **Backend**: Spring Boot 3, Java 21, PostgreSQL, JWT auth
- **Frontend**: React + Vite + TypeScript, Tailwind CSS, shadcn/ui (Radix)
- **Infra**: Docker Compose (Postgres + backend; frontend opzionale via profilo)

## Avvio rapido

```bash
cp .env.example .env
# modifica le password e il JWT_SECRET in .env

docker compose up -d --build
```

L'app sarà disponibile su `http://localhost` (porta 80) se avvii anche il profilo frontend:

```bash
docker compose --profile frontend up -d --build
```

Per i dettagli completi (credenziali iniziali, flusso admin, sviluppo locale) vedi [AVVIO.md](./AVVIO.md).

## Sviluppo locale

```bash
# Backend
cd backend
mvn spring-boot:run

# Frontend
cd frontend
npm install
npm run dev
```

Frontend: `http://localhost:5173` — API proxata su `http://localhost:8080`.

## Struttura

```
worktogether/
├── docker-compose.yml
├── .env.example
├── backend/    # Spring Boot 3 + Java 21
└── frontend/   # React + Vite + shadcn/ui
```
