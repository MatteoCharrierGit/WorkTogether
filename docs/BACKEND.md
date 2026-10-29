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
security/      OIDC Authentik (validazione token, filtro) + API key (filtro, scope interceptor)
service/       logica applicativa (22 service)
websocket/     WorkspaceEventPublisher (broadcast STOMP)
```

Build: **Maven** (`pom.xml`), parent `spring-boot-starter-parent:3.3.0`. Dipendenze principali:
web, data-jpa, security, websocket, validation, actuator, mail; PostgreSQL + Flyway;
**spring-security-oauth2-jose** (Nimbus) per validare gli access token di Authentik; **jjwt** (0.12.5)
per i token LiveKit; **commonmark** per le email Markdown; Lombok.

## 2. Controller e rotte

Ogni controller è sotto `/api`. Tabella completa delle rotte (pubbliche e private) in
**[API.md](../API.md)**. Sintesi:

| Controller | Base path | Scopo |
|-----------|-----------|-------|
| `AdminUserController` | `/api/admin/users` | creazione account (solo admin di sistema) via API di Authentik |
| `WorkspaceController` | `/api/workspaces` | workspace, membri, ruoli, impostazioni |
| `UserController` | `/api/users` | profilo (`/me`), tour di benvenuto, "le mie task", elenco utenti |
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

- **Endpoint pubblici**: `/ws/**` (autenticazione alla CONNECT STOMP), `/api/livekit/webhook` (firma),
  `/actuator/health`, `GET /api/users/*/avatar`. Tutto il resto autenticato. Non esistono più
  endpoint di login/registrazione: l'accesso avviene su **Authentik**.
- **Catena di filtri**: `ApiKeyAuthFilter` (token `wt_…`) → `OidcAuthFilter` → filtri standard.
- Una richiesta non autenticata torna **401** (non 403), così il frontend rinnova il token o torna
  alla schermata di accesso.

### Login tramite Authentik (OIDC) — `security/OidcConfig`, `OidcAuthFilter`, `service/OidcUserService`
- Il frontend fa login con **Authorization Code + PKCE** (client pubblico `worktogether`) e manda
  l'**access token di Authentik** come `Authorization: Bearer …` (REST) e nell'header nativo della
  CONNECT STOMP.
- `OidcConfig` crea un `JwtDecoder` Nimbus: firma **RS256** con le chiavi del **JWKS**
  (`OIDC_JWKS_URL`, altrimenti `<OIDC_ISSUER>jwks/`; in cache, riscaricato a `kid` nuovo), `iss` =
  `OIDC_ISSUER` (sempre quello pubblico, anche se il JWKS si scarica dalla rete interna), `aud`
  contiene `OIDC_AUDIENCE`, `exp` obbligatorio e non superato (tolleranza 60 s), `sub` presente.
  Token non valido ⇒ nessuna autenticazione ⇒ 401. Se `OIDC_ISSUER` manca, nessun token è accettato.
- `OidcUserService.resolve(jwt)` associa l'identità all'utente interno:
  1. `users.oidc_subject = sub` (colonna nuova, V24) ⇒ è lui;
  2. primo accesso con un'email già presente ⇒ **collegamento** solo se `email_verified=true` e
     l'utente non è già legato a un altro `sub` (altrimenti 403/409 con messaggio: niente loop di login);
  3. altrimenti **crea** un utente normale (nome da `name`/`preferred_username`, reso univoco).
  L'utente con email verificata = `ADMIN_INIT_EMAIL` diventa **admin di sistema** al primo accesso.
  L'email viene risincronizzata se Authentik ne dichiara una nuova verificata e libera.
- **Chi può entrare** lo decide Authentik (gruppo `AUTHENTIK_USER_GROUP` sulla policy dell'applicazione):
  il backend non filtra i gruppi.
- **Sessione singola rimossa**: con i token di Authentik non esiste più un "login" lato app su cui
  incrementare una versione; la durata della sessione è quella di Authentik (access token brevi +
  refresh token). Le colonne legacy `password_hash`, `must_reset_password`, `token_version` restano in
  tabella (non mappate) per un eventuale rollback; `refresh_tokens` e `verification_codes` sono eliminate.
- **WebSocket**: la CONNECT valida lo stesso token e ne registra la scadenza in
  `websocket/WsSessionExpiryGuard`, che chiude la connessione (codice 4001) quando il token è scaduto
  da più di `OIDC_WS_GRACE_SECONDS` (default 60). Il client si riconnette con il token già rinnovato.

### Creazione account — `service/AdminUserService`, `service/AuthentikClient`
- `POST /api/admin/users` (solo `systemAdmin`): verifica duplicati lato app e in Authentik, poi chiama
  l'API v3 con `AUTHENTIK_API_TOKEN`: `POST /core/users/` → `POST /core/users/{pk}/set_password/` →
  `POST /core/groups/{gruppo}/add_user/`. Se un passo dopo la creazione fallisce, l'utente Authentik
  viene eliminato. Poi crea l'utente interno con `oidc_subject` = `uid` di Authentik (il `sub` con la
  modalità di default *hashed user id*; con altre modalità il collegamento avviene al primo accesso
  per email verificata) e, se indicato, lo aggiunge al workspace.
- Errori di Authentik ⇒ messaggi leggibili: username/email già esistenti (409), dati o password
  rifiutati (400 con il dettaglio), token API rifiutato o Authentik irraggiungibile (502), API non
  configurata (503).
- **Invito per email** (`sendInvite: true`, `service/AccountInviteService`): l'attributo
  `must_change_password: true` va **nel body del `POST /core/users/`** (basta il permesso `add_user`
  dell'utente di servizio; una PATCH richiederebbe `change_user`). Dopo la creazione (Authentik + utente
  interno + workspace) parte un'email Markdown «Il tuo account WorkTogether» con username, password
  iniziale (in un code span, quindi letterale), link `FRONTEND_BASE_URL` e l'avviso del cambio al primo
  accesso; il nome è escapato (niente HTML iniettato). Esito in `inviteSent`/`inviteError`: SMTP non
  configurato (`MailService.isSmtpConfigured()`: host, username, password e mittente) ⇒ nessun tentativo;
  errore SMTP ⇒ messaggio breve. L'account non viene mai annullato per colpa dell'email. La password non
  finisce nei log (né il corpo della mail: `MailService.sendEmailOrThrow` non registra nulla).
- Tutti i body verso Authentik partono come `byte[]` (Content-Length): Authentik non legge il chunked.
- Gli **inviti** ai workspace restano, ma solo per account **già esistenti** (non creano account);
  anteprima (`GET /api/invitations/{token}`) e accettazione richiedono il login.

### API key (`security/ApiKeyAuthFilter`, `ApiKeyScopeInterceptor`, `service/ApiKeyService`)
- Token `wt_…`; in DB solo l'**hash SHA-256** (`ApiKey`). Validità: legata a un singolo workspace,
  con **scope** per risorsa e scadenza opzionale; revocabile.
- Risorse consentite: **`elements`, `drive`, `tags`** (più gli allegati). `GET`→scope `:read`,
  scrittura→scope `:write` (lo `:write` include la lettura). Scope in `domain/enums/ApiScope`.
- Rotte puntuali (`ApiKeyScopeInterceptor.ROUTE_RULES`, confronto col pattern Spring scelto):
  `members:read` → `GET /members` (vista ridotta `ApiMemberResponse`, senza invisibili);
  `sprints:read` → lettura sprint; `sprints:write` → solo `POST`/`DELETE /sprints/{id}/tasks/{elementId}`.
  Tutto il resto è negato per default. La chiave agisce come l'utente che l'ha creata (autore e ruoli).
- Vedi la guida completa all'uso in [API.md](../API.md).

## 4. Service principali

| Service | Responsabilità |
|---------|----------------|
| `OidcUserService` | utente interno dall'access token di Authentik (sub, collegamento email, admin iniziale) |
| `AdminUserService` · `AuthentikClient` | creazione account in Authentik + utente interno |
| `MailService` | invio email singole (inviti ai workspace, credenziali dei nuovi account) |
| `AccountInviteService` | email con le credenziali iniziali di un account creato dall'admin |
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
| OIDC | `OIDC_ISSUER`, `OIDC_AUDIENCE` (= client id, default `worktogether`), `OIDC_JWKS_URL` (opz.) | validazione degli access token di Authentik |
| OIDC (opz.) | `OIDC_REQUIRE_EMAIL_VERIFIED` (default `true`), `OIDC_WS_GRACE_SECONDS` (default 60) | collegamento per email; chiusura WS a token scaduto |
| Authentik API | `AUTHENTIK_API_URL` (es. `http://authentik-server:9000/api/v3`), `AUTHENTIK_API_TOKEN`, `AUTHENTIK_USER_GROUP` (default `worktogether`) | creazione account dal pannello |
| Admin iniziale | `ADMIN_INIT_EMAIL` (opz.) | chi accede con questa email verificata diventa admin di sistema |
| Upload | `UPLOAD_DIR` | volume per allegati/file |
| Mail | `MAIL_HOST/PORT/USERNAME/PASSWORD`, `MAIL_FROM` (`app.mail.from`) | SMTP con autenticazione e STARTTLS (porta 587); `MAIL_FROM` vuoto ⇒ mittente = `MAIL_USERNAME`; per Gmail usa una app password |
| AI | `AI_SECRET` (obbligatorio in produzione; `JWT_SECRET` resta solo come fallback legacy per decifrare le chiavi già salvate), `OPENROUTER_BASE_URL` | le chiavi dei provider sono in DB cifrate |
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

- ~~**Sessione singola**~~ (rimossa con il login tramite Authentik, vedi §3): `users.token_version`
  (migration V14) era incluso negli access token come claim `sv` e incrementato a ogni login.
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
  **Timeout**: `StreamingResponseBody` è una richiesta asincrona; senza un timeout proprio valeva quello
  di Tomcat (30 s) e le cartelle grandi o lente arrivavano **troncate** (ma con un 200 «finito»), con
  `AsyncRequestTimeoutException` e «No converter … application/zip» nel log. Ora `DriveController`
  imposta un timeout solo per questa rotta (`app.drive.zip-timeout`, env `DRIVE_ZIP_TIMEOUT`, default
  `6h`) tramite un `CallableProcessingInterceptor` registrato sulla richiesta (prima di `startAsync`).
  Content-Disposition con `filename` ASCII di ripiego e `filename*=UTF-8''…` col nome vero. Cartella
  inesistente ⇒ 404, di un altro workspace ⇒ 403, sempre in JSON (anche con `Accept: application/zip`:
  `GlobalExceptionHandler` fissa `Content-Type: application/json`). Se un errore arriva a risposta già
  iniziata il gestore generico rilancia: Tomcat chiude la connessione e il client vede un download
  interrotto invece di uno ZIP troncato. Catena: nginx (`proxy_buffering off`, `proxy_read_timeout 3600s`
  tra due letture, gzip non applicato a `application/zip`) e Caddy (`flush_interval -1`, nessun timeout
  di risposta) vanno già bene. Test: `DriveFolderZipDownloadTest` (Tomcat vero, timeout async globale
  a 500 ms), `DriveFolderZipTest` (alberatura, nomi UTF-8, streaming).
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
  userId. (Oggi un token assente o non valido rifiuta la CONNECT: vedi §3.) `WorkspaceEventPublisher.publishToUser(userId, type, payload)` → `/user/queue/events`.
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

## Notifiche in-app, dashboard e modalità invisibile (review)

- **Hook unico per le notifiche degli elementi**: `NotificationService.onElementChanged(element,
  statoPrecedente, assegnatariPrecedenti, attore)`. Tutti i percorsi che cambiano stato o assegnatari
  passano da `ElementService` (form/dettaglio, drag Kanban e board della sprint = `PUT …/elements/{id}`,
  tool di Akari `create_element`/`update_element`, API key, riattivazione automatica degli antenati
  completati) e quindi dall'hook: `ASSIGNED` ai nuovi assegnatari, `ELEMENT_STATUS` a quelli già
  presenti. L'attore non viene mai notificato; per le azioni di Akari l'attore è l'utente che ha
  eseguito l'agente. La chiusura della sprint sposta i task incompleti cambiando solo `sprint_id`
  (nessun cambio di stato ⇒ nessuna `ELEMENT_STATUS`, solo `SPRINT_CLOSED`).
- **Attore nelle notifiche (`actorName`/`actorAvatar`)**: è mostrato sempre, anche se l'attore è un
  admin in modalità invisibile. È voluto: le azioni compiute (assegnare un task, spostarlo…) sono
  attribuite a chi le fa; l'invisibilità nasconde solo presenza, liste membri e "sta scrivendo".
- **Promemoria di scadenza** (`NotificationScheduler`, ogni ora): `runDueReminders` elabora ogni
  workspace in una **transazione breve e indipendente** (`TransactionTemplate`); un errore viene
  loggato e non annulla gli altri workspace. Per workspace: una `INSERT … SELECT` set-based per tipo
  (assegnatari e preferenze nella stessa query, niente N+1). Deduplica **imposta dal DB** (migration
  **V23**): colonna `notifications.reminder_day` + indice unico parziale `(user_id, element_id, type,
  reminder_day) WHERE reminder_day IS NOT NULL`, inserimento con `ON CONFLICT DO NOTHING` ⇒ niente
  doppioni anche con più istanze/scheduler concorrenti. `DUE_SOON`: un promemoria per giorno di
  scadenza (Europe/Rome); `OVERDUE`: al massimo uno al giorno.
- **Avanzamento epiche**: definizione unica = task nipoti (epica → storia → task) **esclusi gli
  archiviati**, sia in `ElementRepository.epicProgressBy*` (elementi/roadmap/my-tasks) sia nella
  dashboard.
- **Dashboard, carico del team**: la CTE `MATERIALIZED` parte dai task aperti del workspace e solo
  dopo legge `element_assignees` per PK (prima la LEFT JOIN partiva dalle assegnazioni dei membri in
  tutti i workspace).
- **Modalità invisibile**: `TYPING` soppresso per un admin nascosto solo in ROOM/SPRINT; in DM e
  gruppi (dove partecipa esplicitamente) l'indicatore resta. Il toggle non pubblica più
  `MEMBER_ADDED{visibilityChanged}` sul topic del workspace (rivelava ai non-admin il momento del
  cambio): invia `MEMBERS_VISIBILITY_CHANGED {workspaceId}` sulla coda personale dei soli admin, che
  invalidano `['members']`, `['channels']`, `['dashboard']`. I non-admin si riallineano al refetch
  successivo; dagli "online" l'admin sparisce subito (rebroadcast della presenza).
