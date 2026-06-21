# Architettura — WorkTogether

> Documentazione v1.0 · vedi anche [BACKEND](./BACKEND.md) · [FRONTEND](./FRONTEND.md) · [DATABASE](./DATABASE.md) · [REALTIME_VOCE](./REALTIME_VOCE.md)

## 1. Visione d'insieme

WorkTogether è un'app **self-hosted** per team di ~6 persone. È composta da:

```
┌──────────────┐     REST + WebSocket (STOMP)      ┌────────────────────┐
│   Frontend   │ ───────────────────────────────▶ │   Backend Spring    │
│  React/Vite  │ ◀─────────────────────────────── │  Boot 3 / Java 21   │
└──────┬───────┘   token LiveKit (JWT firmato)     └─────────┬──────────┘
       │                                                     │ JPA
       │ WebRTC (media)                                      ▼
┌──────▼───────┐                                   ┌────────────────────┐
│   LiveKit    │  (voce + screen share, SFU)       │    PostgreSQL      │
│  + TURN      │                                   │  (Flyway V1→V12)   │
└──────────────┘                                   └────────────────────┘
```

Tutto gira in **Docker Compose**. Postgres e backend sono il cuore; il frontend (nginx) e il
media server (LiveKit) sono attivabili tramite **profili** separati.

## 2. I due binari

Le funzionalità sono di due nature, deliberatamente tenute separate:

- **Binario A — Nativo (nella JVM).** Task management, drive, AI, chat testuale, stanze, permessi,
  presenza. Vive in Spring Boot + Postgres; il realtime usa il **WebSocket STOMP esistente**.
- **Binario B — Media (fuori dalla JVM).** Voce e condivisione schermo: WebRTC gestito da un
  **media server SFU dedicato (LiveKit)** come container separato + TURN. Spring resta l'**autorità**:
  non instrada media, ma **firma i token d'accesso** a breve scadenza dopo aver validato ruolo e
  accesso alla stanza.

Vantaggio: la parte "scomoda" (NAT, porte UDP, TLS, TURN) è isolata e non tocca la logica applicativa.

## 3. Realtime

- **Trasporto unico**: WebSocket STOMP su `/ws` (SockJS), broker semplice in-memory.
- **Topic**: `/topic/workspace/{workspaceId}` — broadcast a tutti i client del workspace.
- **Modello**: le **scritture passano via REST autenticato**; il WebSocket è **solo broadcast** e
  **non è autenticato a livello STOMP**. Per non esporre dati privati sul topic condiviso, gli eventi
  trasportano payload minimi (es. `MESSAGE_CREATED` manda solo `channelId`); i client con accesso
  rifanno la fetch via REST.
- **Eventi**: elementi (`ELEMENT_*`), chat (`MESSAGE_CREATED`, `CHANNEL_*`, `TYPING`), presenza
  (`PRESENCE`). Dettagli in [REALTIME_VOCE](./REALTIME_VOCE.md).
- **Presenza**: registro **in-memory** lato server alimentato da heartbeat REST e diffuso via `PRESENCE`.

## 4. Sicurezza e accesso

- **Due autenticazioni** (header `Authorization: Bearer …`):
  - **JWT utente** — access token a breve durata + refresh token; per le persone.
  - **API key** `wt_…` — per servizi/bot, con **scope** per risorsa e limitata a un singolo workspace.
- **Filtri**: `ApiKeyAuthFilter` (precede) → `JwtAuthFilter`. Endpoint pubblici: `/api/auth/**`,
  `/ws/**`, `/actuator/health`; tutto il resto richiede autenticazione.
- **Ruoli workspace**: `ADMIN` · `COLLABORATORE` · `GUEST`. Le verifiche stanno in
  `WorkspaceService.assertMember` / `assertRole`, riusate da tutti i service (inclusi stanze e voce).
- **Segreti a riposo**: la chiave OpenRouter è cifrata in DB (AES-256/GCM, `AiKeyCipher`). Le
  credenziali d'infra (JWT secret, mail, LiveKit) sono variabili d'ambiente, non cifrate.

## 5. Componenti principali

| Area | Tecnologia | Dove |
|------|-----------|------|
| API REST | Spring MVC (`@RestController`) | `backend/.../controller` |
| Dominio/DB | JPA + Flyway | `backend/.../domain`, `.../repository`, `resources/db/migration` |
| Auth | JWT (jjwt) + API key SHA-256 | `backend/.../security` |
| AI "Akari" | OpenRouter + tool registry + SSE | `backend/.../service/Ai*`, `AgentToolRegistry` |
| Email | JavaMail + CommonMark | `WorkspaceEmailService`, `MarkdownEmailRenderer` |
| Automazioni | `@Scheduled` | `AutomationService` |
| Realtime | STOMP WebSocket | `config/WebSocketConfig`, `websocket/WorkspaceEventPublisher` |
| Presenza | registro in-memory | `service/PresenceService` |
| Voce/Schermo | LiveKit (token via jjwt) | `service/LiveKitService`, `livekit/livekit.yaml` |
| Frontend | React + Vite + shadcn | `frontend/src` |

## 6. Flussi chiave

- **Login** → `POST /api/auth/login` → access+refresh token → il frontend li salva e rinnova via
  `/api/auth/refresh` quando riceve un `401`.
- **Chat** → scrittura via `POST …/channels/{id}/messages`; gli altri client ricevono `MESSAGE_CREATED`
  sul topic e rifanno la fetch dei messaggi.
- **Voce** → `POST …/channels/{id}/voice/token` (Spring valida accesso + `voiceEnabled`, firma il token)
  → il client si connette a LiveKit con quel token. La sessione voce è **globale** lato frontend
  (sopravvive ai cambi pagina). Vedi [REALTIME_VOCE](./REALTIME_VOCE.md).
- **AI** → `POST …/ai/conversations/{id}/messages` risponde in **streaming SSE**; i tool eseguono
  azioni sul workspace, con eventuale conferma via `/confirm`.
