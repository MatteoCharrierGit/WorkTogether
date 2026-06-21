# Backend — WorkTogether

> Documentazione v1.0 · Spring Boot 3 · Java 21 · PostgreSQL · vedi anche [API.md](../API.md) e [DATABASE](./DATABASE.md)

## 1. Struttura a package

Radice: `backend/src/main/java/com/worktogether/`

```
WorkTogetherApplication.java     # @SpringBootApplication + @EnableScheduling
config/        SecurityConfig, WebConfig (CORS/static), WebSocketConfig
controller/    13 REST controller + GlobalExceptionHandler
domain/
  entity/      17 entità JPA
  enums/       10 enum di dominio
dto/
  request/     record di input (validati con jakarta.validation)
  response/     record/DTO di output
repository/    Spring Data JPA repository
security/      JWT + API key (filtri, util, scope interceptor)
service/       logica applicativa (22 service)
websocket/     WorkspaceEventPublisher (broadcast STOMP)
```

Build: **Maven** (`pom.xml`), parent `spring-boot-starter-parent:3.3.0`. Dipendenze principali:
web, data-jpa, security, websocket, validation, actuator, mail; PostgreSQL + Flyway; **jjwt**
(0.12.5) per i token; **commonmark** per le email Markdown; Lombok.

## 2. Controller e rotte

Ogni controller è sotto `/api`. Tabella completa delle rotte (pubbliche e private) in
**[API.md](../API.md)**. Sintesi:

| Controller | Base path | Scopo |
|-----------|-----------|-------|
| `AuthController` | `/api/auth` | login, refresh, logout, reset password (pubblico: login/refresh) |
| `WorkspaceController` | `/api/workspaces` | workspace, membri, ruoli, creazione utenti, impostazioni |
| `UserController` | `/api/users` | profilo (`/me`), onboarding, "le mie task", elenco utenti |
| `ElementController` | `/api/workspaces/{wsId}/elements` | CRUD elementi (epica/storia/task/evento) |
| `AttachmentController` | `…/elements/{id}/attachments` | allegati degli elementi |
| `DriveController` | `…/drive` | cartelle e file, editor, lock |
| `TagController` | `…/tags` | CRUD tag |
| `ApiKeyController` | `…/api-keys` | gestione API key (solo admin) |
| `AiController` | `…/ai` | stato/impostazioni, conversazioni, chat SSE, comandi, conferme |
| `EmailController` | `…/emails` | invio email + bozza AI |
| `ChannelController` | `…/channels` | DM/gruppi/stanze, messaggi, typing, **token voce** |
| `PresenceController` | `…/presence` | heartbeat + snapshot presenza |

Gli errori sono normalizzati da `GlobalExceptionHandler` nella forma `{ "error": "…" }`:
`EntityNotFoundException`→404, `AccessDeniedException`→403, `BadCredentialsException`→401,
`MethodArgumentNotValidException`→400, `ResponseStatusException`→stato indicato, altro→500.

## 3. Sicurezza

`SecurityConfig` (stateless, CSRF off, CORS aperto a tutte le origini con credenziali):

- **Endpoint pubblici**: `/api/auth/**`, `/ws/**`, `/actuator/health`. Tutto il resto autenticato.
- **Catena di filtri**: `ApiKeyAuthFilter` → `JwtAuthFilter` → filtri standard.
- Una richiesta non autenticata torna **401** (non 403), così il frontend distingue
  "token scaduto/assente" e fa refresh o redirect al login.

### JWT (`security/JwtUtil`, `JwtAuthFilter`)
- Access token a breve scadenza (`JWT_EXPIRY_MS`, default 15 min) + refresh token persistito
  (`RefreshToken`, default 7 giorni). Il principal autenticato è l'entità `User`.

### API key (`security/ApiKeyAuthFilter`, `ApiKeyScopeInterceptor`, `service/ApiKeyService`)
- Token `wt_…`; in DB solo l'**hash SHA-256** (`ApiKey`). Validità: legata a un singolo workspace,
  con **scope** per risorsa e scadenza opzionale; revocabile.
- Risorse consentite: **`elements`, `drive`, `tags`** (più gli allegati). `GET`→scope `:read`,
  scrittura→scope `:write` (lo `:write` include la lettura). Scope in `domain/enums/ApiScope`.
- Vedi la guida completa all'uso in [API.md](../API.md).

## 4. Service principali

| Service | Responsabilità |
|---------|----------------|
| `AuthService` | login, refresh non distruttivo, logout, reset password |
| `WorkspaceService` | workspace, membri, ruoli; `assertMember`/`assertRole` riusati ovunque |
| `ElementService` | elementi, gerarchia, progress, assegnatari, tag; eventi a giornata intera |
| `DriveService` | cartelle/file, upload/download, move/rename/copy, **lock** di modifica |
| `AttachmentService` | allegati degli elementi |
| `TagService` | tag del workspace |
| `ApiKeyService` | creazione (segreto una sola volta), hashing, revoca, scope |
| `AiSettingsService` | impostazioni Akari; cifratura chiave OpenRouter (`AiKeyCipher`) |
| `AiConversationService` · `AiChatService` · `AiCommandService` | conversazioni, streaming SSE, comandi |
| `AgentToolRegistry` · `AiMemoryService` | tool dell'agente (elements/drive/tags/email/calendar…) e memoria |
| `OpenRouterClient` | client HTTP verso OpenRouter (modelli, completion, test chiave) |
| `WorkspaceEmailService` · `MarkdownEmailRenderer` | invio email per ruolo/utente, render Markdown→HTML |
| `AutomationService` | `@Scheduled`: promemoria eventi, recap settimanale, digest del lunedì |
| `ChannelService` | DM/gruppi/stanze, messaggi, non-letti, typing, **token voce** |
| `PresenceService` | presenza online/in-chiamata in-memory + sweep schedulato |
| `LiveKitService` | firma i token d'accesso LiveKit (JWT HS256) |

## 5. Realtime e media lato server

- **`WorkspaceEventPublisher.publish(wsId, type, payload)`** invia su `/topic/workspace/{wsId}`.
  Usato da elementi, chat, presenza. (`config/WebSocketConfig`: broker `/topic`, endpoint `/ws`.)
- **`LiveKitService`** firma un AccessToken LiveKit (HS256 con l'API secret come chiave HMAC, claim
  `video` con grant sulla room = `channelId`). `isConfigured()` è false se mancano url/key/secret
  → la voce resta disattivata e l'endpoint token risponde `503`.

## 6. Configurazione (`application.yml` / env)

| Gruppo | Chiavi | Note |
|--------|--------|------|
| Datasource | `DB_HOST/PORT/NAME/USER/PASSWORD` | Postgres |
| JPA/Flyway | `ddl-auto: validate`, migration `classpath:db/migration` | lo schema è gestito da Flyway |
| JWT | `JWT_SECRET`, `JWT_EXPIRY_MS`, `JWT_REFRESH_EXPIRY_MS` | |
| Admin init | `ADMIN_INIT_EMAIL`, `ADMIN_INIT_PASSWORD` | account creato al primo avvio |
| Upload | `UPLOAD_DIR` | volume per allegati/file |
| Mail | `MAIL_HOST/PORT/USERNAME/PASSWORD`, `app.mail.from` | per Gmail usa una app password |
| AI | `app.ai.secret` (default = JWT secret), `OPENROUTER_BASE_URL` | la chiave OpenRouter è in DB cifrata |
| LiveKit | `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `LIVEKIT_TOKEN_TTL` | voce/screen share |

## 7. Build e test

```bash
cd backend
mvn spring-boot:run          # avvio dev (richiede un Postgres raggiungibile)
mvn compile                  # compilazione
mvn test                     # test (spring-boot-starter-test, spring-security-test)
```

In assenza di JDK/Maven locale, è possibile compilare in un container usa-e-getta:
`docker run --rm -v "$PWD:/app" -v wt_m2:/root/.m2 -w /app maven:3.9-eclipse-temurin-21 mvn -q compile`.
