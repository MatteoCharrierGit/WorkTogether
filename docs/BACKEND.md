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
| `SprintController` | `…/sprints` | gestione sprint: CRUD, avvio/chiusura (admin), task della sprint |
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
| `ChannelService` | DM/gruppi/stanze, messaggi, non-letti, typing, **token voce**; crea la chat di sprint |
| `SprintService` | ciclo di vita sprint (PLANNED→ACTIVE→CLOSED), una sola attiva, carry-over task alla chiusura |
| `PresenceService` | presenza online/in-chiamata in-memory + sweep schedulato |
| `LiveKitService` | firma i token d'accesso LiveKit (JWT HS256) |

## 5. Realtime e media lato server

- **`WorkspaceEventPublisher.publish(wsId, type, payload)`** invia su `/topic/workspace/{wsId}`.
  Usato da elementi, chat, presenza; invio rimandato a dopo il commit se in transazione.
  `publishToUser(userId, …)` invia su `/user/queue/events` (vedi Novità v1.4).
  (`config/WebSocketConfig`: broker `/topic` + `/queue`, prefisso utente `/user`, endpoint `/ws`.)
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

## Novità v1.1

- **Eventi realtime estesi**: `DriveService` pubblica `DRIVE_CHANGED` su ogni mutazione del Drive;
  `AiChatService` pubblica `AI_MESSAGE` per le chat condivise di Akari. (Vedi REALTIME_VOCE §7.)
- **Webhook LiveKit**: nuovo `LiveKitWebhookController` (`POST /api/livekit/webhook`, `permitAll` ma
  verificato per firma in `LiveKitService.verifyWebhook`). Su `participant_left` mappa
  `room=channelId → workspaceId` (`ChannelRepository.findWorkspaceIdById`) e chiama
  `PresenceService.clearCall`. È la fonte autorevole della disconnessione dalle call.
- **Presenza**: `PresenceService.goOffline` (rimozione immediata) + `clearCall` (solo stato chiamata);
  endpoint `POST …/presence/offline` per il beacon `pagehide` del client.
- **Drive per-file**: `drive_files.editable_by_all` (migration V13). `DriveService.setEditableByAll`
  (solo proprietario/admin) + endpoint `PATCH …/drive/files/{id}/permission`. I file in sola lettura
  sono modificabili solo da proprietario/admin; gli altri restano modificabili da tutti i membri non guest.
- **Agente AI**: nuovi/estesi tool in `AgentToolRegistry` — `get_board` (albero gerarchico),
  `list_elements` con `query`+`parentTitle`, guardrail anti task-orfano in `create_element`.

## Novità v1.2

- **Sessione singola**: `users.token_version` (migration V14) incluso negli access token come claim
  `sv` (`JwtUtil`). A ogni login `AuthService.buildAuthResponse` incrementa la versione (e cancella i
  refresh token); `JwtAuthFilter` rifiuta i token con `sv` diverso dalla versione corrente ⇒ le
  sessioni precedenti su altri dispositivi cadono subito (401 → logout lato client).
- **Cartelle sola lettura in cascata**: `folders.editable_by_all` (migration V15).
  `DriveService.setFolderEditableByAll` propaga il flag a tutti i file e sottocartelle discendenti
  (`cascadeEditable`); upload/creazione ereditano il flag della cartella contenitore (`folderEditable`).
  Endpoint `PATCH …/drive/folders/{id}/permission` (solo proprietario/admin).
- **Drag & drop di cartelle**: gestito lato frontend (traversal `webkitGetAsEntry`), nessuna modifica API.

## Novità v1.3

- **Download cartelle (Drive)**: `GET …/drive/folders/{id}/download` ritorna uno **ZIP in streaming**
  (`StreamingResponseBody` + `ZipOutputStream` in `DriveService.writeFolderZip`): visita ricorsiva di
  `folders`/`drive_files`, alberatura preservata, dedup dei nomi, cartelle vuote incluse. Accesso a
  qualunque membro (`drive:read`). Lo streaming gira fuori dalla transazione della request (usa solo
  query dei repository), e il re-dispatch `ASYNC` è già `permitAll` in `SecurityConfig`.
- **Gestione Sprint** (migration **V17**): nuova entità `Sprint` (`SprintStatus PLANNED|ACTIVE|CLOSED`),
  `SprintService`/`SprintController` (`…/sprints`). Avvio/chiusura **manuali** e **admin-only**; indice
  unico parziale `uq_sprint_active` ⇒ **una sola sprint ACTIVE per workspace**. Collegamento Task↔Sprint
  su `elements.sprint_id` (solo `TASK`); `elements.completed_at` (valorizzato/azzerato in
  `ElementService.applyStatus` per la timeline) e `elements.is_blocked` (bloccanti). Alla chiusura i task
  incompleti vanno nel backlog o in una sprint pianificata (`CloseSprintRequest.carryOver`), i completati
  mantengono il collegamento.
- **Chat di sprint**: nuovo `ChannelType.SPRINT` e `channels.sprint_id`; `ChannelService.createSprintChannel`
  la crea all'avvio. Accessibile a tutti i membri (come una ROOM pubblica, vedi `assertChannelAccess`);
  esclusa da export/backup (`WorkspaceTransferService`). Nuovo evento realtime `SPRINT_CHANGED`.
- **Visibilità sezione Sprint**: `workspaces.sprint_enabled` (migration **V18**, default FALSE) esposto in
  `WorkspaceResponse` e aggiornabile da admin via `PATCH …/settings` (`UpdateWorkspaceSettingsRequest.sprintEnabled`).
  Toggle solo di UI: nascosta di default.

## Novità v1.4 — performance

- **Niente Open Session In View**: `spring.jpa.open-in-view: false`. Tutto il mapping entità→DTO avviene
  dentro metodi `@Transactional` dei service (ora `org.springframework.transaction.annotation.Transactional`,
  `readOnly = true` sulle letture). Le connessioni tornano al pool appena il service ha finito.
  Regola: un nuovo metodo che legge associazioni lazy (`getTags()`, `getAssignees()`, `getUser()`,
  `getAuthor()`, `getWorkspace().getName()`…) **deve** essere `@Transactional` (accedere al solo id
  di un proxy, es. `getWorkspace().getId()`, è sicuro anche fuori transazione).
- **Batch fetching**: `hibernate.default_batch_fetch_size: 50` ⇒ tag/assegnatari degli elementi,
  autori dei messaggi ecc. si caricano a lotti (`WHERE id = ANY(?)`) invece che una query per riga.
- **Elementi**: avanzamento epiche calcolato con **una** query aggregata (`epicProgressByWorkspace` /
  `epicProgressByEpicIds`) invece di 2 COUNT per epica.
  Le liste (`GET …/elements`, `GET /api/users/me/tasks`, task in `GET …/sprints/active|{id}`) **non
  includono più `body`** (vale `null`); il dettaglio `GET …/elements/{id}` e gli eventi websocket
  `ELEMENT_*` restano completi. `GET …/elements?includeBody=true` ripristina il body in lista (per
  integrazioni API key che lo leggevano). Un `PUT` con `body: null` non cancella il body (comportamento invariato).
- **Canali**: `ChannelService.buildResponses` costruisce la lista con un numero fisso di query
  (membri+utenti in JOIN FETCH, ultimo messaggio per canale via `LATERAL … LIMIT 1`, non-letti per
  canale con subquery sul `last_read_at` del viewer). Forma della risposta invariata.
- **Sprint/workspace**: lista sprint con 2 query aggregate (conteggi + chat); lista workspace
  dell'utente con una query (`WorkspaceMember JOIN FETCH workspace`); membri con `@EntityGraph(user)`.
- **Eventi websocket dopo il commit**: `WorkspaceEventPublisher` rimanda l'invio ad `afterCommit` se
  c'è una transazione attiva (nessun evento su rollback; i client che rifanno le query leggono dati
  committati). Fuori transazione (agente AI, presenza, scheduler) invia subito.
- **Coda personale STOMP**: broker `/topic` + `/queue`, prefisso utente `/user`. Alla `CONNECT` STOMP
  l'header nativo `Authorization: Bearer <jwt>` (già inviato dal frontend) associa la sessione allo
  userId; un token assente/scaduto non rifiuta la connessione, ma quella sessione non riceve eventi
  personali. `WorkspaceEventPublisher.publishToUser(userId, type, payload)` → `/user/queue/events`.
  **`CHANNEL_READ` ora va solo all'utente che ha letto** (payload `{workspaceId, channelId, userId}`),
  non più a tutto il workspace. `TYPING` resta sul topic del workspace.
- **Paginazione messaggi** (`GET …/channels/{id}/messages`): `limit` (default 50, max 100) e `before`
  opzionale = `createdAt` ISO-8601 del messaggio più vecchio già caricato (passarlo **così come
  arriva dal server**, URL-encoded, senza riformattarlo con `Date` che tronca ai millisecondi). Risposta
  in ordine cronologico crescente; meno di `limit` elementi ⇒ inizio conversazione. Il cursore usa
  l'indice `idx_messages_channel(channel_id, created_at)`; autore caricato in JOIN FETCH.
- **Migration V19** (`V19__perf_indexes.sql`): indici su `element_assignees(user_id)`,
  `element_tags(tag_id)`, `messages(author_id)`, `channels(sprint_id)` (parziale),
  `ai_pending_actions(conversation_id, status)`, `verification_codes(code_hash)`.
