# WorkTogether — Riferimento API completo

> Documentazione v1.0 · riferimento di **tutte** le rotte REST (pubbliche e private) + guida alle
> **API key** per le integrazioni esterne. Vedi anche [docs/BACKEND.md](./docs/BACKEND.md).

- **Base URL (sviluppo):** `http://localhost:8080`
- **Base URL (produzione):** il dominio dove gira il backend
- Tutte le risposte sono in JSON. Gli errori hanno forma `{ "error": "messaggio" }`.
- Prefisso comune: `/api`. Molte rotte sono **scoped al workspace**: `/api/workspaces/{wsId}/…`.

## Legenda accesso

| Simbolo | Significato |
|---------|-------------|
| 🌐 | **Pubblico** — nessuna autenticazione |
| 👤 | Token utente (JWT) — qualsiasi membro del workspace |
| 🛡️ | Token utente con ruolo **ADMIN** (del workspace) |
| ⭐ | Token utente **system admin** |
| 🔑 `scope` | Utilizzabile anche da **API key** con lo scope indicato |

---

## 1. Autenticazione

Due modi, entrambi con header `Authorization: Bearer <token>`.

**a) Token utente (JWT)** — per le persone. Access token a breve durata (default 15 min) +
refresh token (default 7 giorni). Dà accesso a tutto ciò che il ruolo consente.

**b) API key (`wt_…`)** — per bot/integrazioni. Non scade (se non imposti una scadenza), è revocabile,
e ha **permessi limitati**: agisce **solo** sul suo workspace e **solo** sulle risorse `elements`,
`drive`, `tags` (più gli allegati), filtrata dagli **scope**. Le API key **non** possono gestire
membri, impostazioni, utenti, altre chiavi, AI, chat/voce, presenza, email, né fare login.

### Endpoint pubblici (nessun token)
| Metodo | Endpoint | Note |
|--------|----------|------|
| 🌐 POST | `/api/auth/login` | Login con email e password |
| 🌐 POST | `/api/auth/refresh` | Rinnova l'access token (`{ "refreshToken": "…" }`) |
| 🌐 GET | `/ws/**` | Handshake WebSocket/SockJS (STOMP) |
| 🌐 GET | `/actuator/health` | Health check |

---

## 2. Auth — `/api/auth`
| Metodo | Endpoint | Accesso | Note |
|--------|----------|---------|------|
| POST | `/login` | 🌐 | `{ email, password }` → `{ accessToken, refreshToken, user }` |
| POST | `/refresh` | 🌐 | `{ refreshToken }` → nuovi token |
| POST | `/reset-password` | 👤 | Cambia password dell'utente loggato |
| POST | `/logout` | 👤 | Invalida il refresh token |

> **Sessione singola (v1.2)**: a ogni `login` la "versione di sessione" dell'utente viene incrementata
> e inclusa negli access token (claim `sv`). Gli access token emessi prima (su altri dispositivi)
> hanno una versione diversa e vengono **rifiutati immediatamente** (401); essendo già stati eliminati
> anche i refresh token, quelle sessioni vengono disconnesse. In pratica: **un solo accesso attivo per
> account alla volta**.

## 3. Utenti — `/api/users`
| Metodo | Endpoint | Accesso | Note |
|--------|----------|---------|------|
| GET | `/me` | 👤 | Profilo corrente |
| PATCH | `/me` | 👤 | Aggiorna `displayName` / `avatar` |
| POST | `/me/complete-onboarding` | 👤 | Segna il tour di benvenuto come completato |
| GET | `/me/tasks` | 👤 | Elementi assegnati all'utente |
| GET | `` (`/api/users`) | ⭐ | Tutti gli utenti del sistema |

## 4. Workspace e membri — `/api/workspaces`
| Metodo | Endpoint | Accesso | Note |
|--------|----------|---------|------|
| GET | `` | 👤 | Workspace dell'utente |
| POST | `` | ⭐ | Crea un workspace |
| GET | `/{wsId}/members` | 👤 | Membri del workspace |
| POST | `/{wsId}/members?userId=&role=` | 🛡️ | Aggiunge un membro |
| PATCH | `/{wsId}/members/{userId}/role?role=` | 🛡️ | Cambia ruolo |
| DELETE | `/{wsId}/members/{userId}` | 🛡️ | Rimuove un membro |
| POST | `/{wsId}/users` | 🛡️ | Crea un nuovo utente nel workspace |
| PATCH | `/{wsId}/settings` | 🛡️ | Impostazioni (avatar, card Kanban, automazioni email, `sprintEnabled`: visibilità sezione Sprint) |
| DELETE | `/{wsId}` | 🛡️ | Elimina il workspace e tutti i suoi dati (irreversibile) |

`role` ∈ `ADMIN | COLLABORATORE | GUEST`.

## 5. Elementi — `/api/workspaces/{wsId}/elements`

> **Gerarchia**: **EPICA → STORIA → TASK**; gli `EVENTO` sono autonomi (Calendario). In Kanban un
> `TASK` deve avere `parentId` = id di una `STORIA` per comparire sulla board. Una `STORIA` compare
> come corsia anche senza genitore.

| Metodo | Endpoint | Accesso | Note |
|--------|----------|---------|------|
| GET | `` | 👤 · 🔑 `elements:read` | Lista elementi del workspace |
| POST | `` | 👤 · 🔑 `elements:write` | Crea un elemento |
| GET | `/{id}` | 👤 · 🔑 `elements:read` | Dettaglio |
| PUT | `/{id}` | 👤 · 🔑 `elements:write` | Aggiorna |
| DELETE | `/{id}` | 👤 · 🔑 `elements:write` | Elimina |

Corpo (`ElementRequest`):
```json
{
  "title": "Titolo",                 // obbligatorio
  "type": "TASK",                    // EPICA | STORIA | TASK | EVENTO (obbligatorio)
  "parentId": null,                  // UUID del padre (opzionale)
  "status": "DA_FARE",               // DA_FARE | IN_CORSO | COMPLETATO | ARCHIVIATO
  "body": "Testo o JSON dell'editor", // opzionale (jsonb; accetta testo semplice o doc editor)
  "startDate": "2026-07-01T15:00:00Z",
  "endDate": "2026-07-01T16:00:00Z",
  "allDay": false,
  "position": 0,
  "blocked": false,                  // indicatore "task bloccante" (usato nella dashboard Sprint)
  "assigneeIds": ["<uuid utente>"],
  "tagIds": ["<uuid tag>"]
}
```

> La risposta (`ElementResponse`) include anche `sprintId` (sprint a cui il TASK è assegnato, null = backlog),
> `completedAt` (istante di completamento, per la timeline della sprint) e `blocked`.

### Allegati — `…/elements/{id}/attachments`
| Metodo | Endpoint | Accesso | Note |
|--------|----------|---------|------|
| GET | `` | 👤 · 🔑 `elements:read` | Lista allegati |
| POST | `` | 👤 · 🔑 `elements:write` | Upload (multipart, campo `file`) |
| GET | `/{attId}` | 👤 · 🔑 `elements:read` | Download |
| DELETE | `/{attId}` | 👤 · 🔑 `elements:write` | Elimina |

## 6. Drive — `/api/workspaces/{wsId}/drive`
| Metodo | Endpoint | Accesso | Note |
|--------|----------|---------|------|
| GET | `/folders?parentId=` | 👤 · 🔑 `drive:read` | Cartelle (radice se assente) |
| POST | `/folders` | 👤 · 🔑 `drive:write` | `{ name, parentId? }` |
| PATCH | `/folders/{id}/rename` | 👤 · 🔑 `drive:write` | `{ name }` |
| PATCH | `/folders/{id}/move` | 👤 · 🔑 `drive:write` | `{ targetFolderId }` (null = radice) |
| PATCH | `/folders/{id}/permission` | 👤 · 🔑 `drive:write` | `{ editableByAll }` — sola lettura **in cascata** su file e sottocartelle (solo proprietario/admin) |
| GET | `/folders/{id}/download` | 👤 · 🔑 `drive:read` | **Scarica la cartella come ZIP** (ricorsivo, alberatura preservata; stream) |
| DELETE | `/folders/{id}` | 👤 · 🔑 `drive:write` | Solo se vuota |
| GET | `/files?folderId=` | 👤 · 🔑 `drive:read` | File nella cartella |
| POST | `/files?folderId=` | 👤 · 🔑 `drive:write` | Upload (multipart, campo `file`) |
| GET | `/files/{id}` | 👤 · 🔑 `drive:read` | Download / contenuto |
| PATCH | `/files/{id}/rename` | 👤 · 🔑 `drive:write` | `{ name }` |
| PATCH | `/files/{id}/move` | 👤 · 🔑 `drive:write` | `{ targetFolderId }` |
| POST | `/files/{id}/copy` | 👤 · 🔑 `drive:write` | Duplica |
| DELETE | `/files/{id}` | 👤 · 🔑 `drive:write` | Elimina |
| PUT | `/files/{id}/content` | 👤 · 🔑 `drive:write` | Salva testo `{ content }` |
| PATCH | `/files/{id}/permission` | 👤 · 🔑 `drive:write` | `{ editableByAll }` — sola lettura/modificabile (solo proprietario/admin) |
| POST | `/files/{id}/lock` | 👤 · 🔑 `drive:write` | Acquisisce il lock di modifica |
| DELETE | `/files/{id}/lock` | 👤 · 🔑 `drive:write` | Rilascia il lock |

> **File** (v1.1): permesso **per-file** `editableByAll` (default true). Se true, qualsiasi membro non
> guest può modificare/spostare/rinominare/eliminare il file; se false (sola lettura) solo
> **proprietario** o **admin**. Il flag si cambia solo da proprietario/admin (`PATCH …/permission`).
> **Cartelle**: spostare/rinominare/eliminare resta solo **proprietario** o **admin**. Caricare file e
> **intere cartelle** e copiare: qualsiasi non-guest.

## 6b. Sprint — `/api/workspaces/{wsId}/sprints` (solo token utente)

Gestione del ciclo di vita di una sprint: **PLANNED → ACTIVE → CLOSED**. Avvio e chiusura sono
**rigorosamente manuali** (non dipendono dalle date) e riservati all'**admin**; al massimo **una
sprint ACTIVE per workspace**. Solo gli `elements` di tipo **TASK** si collegano a una sprint.

> **Visibilità**: la sezione Sprint è mostrata solo se `workspaces.sprintEnabled = true` (toggle admin
> in `PATCH …/settings`); **di default è nascosta**. Le rotte sotto restano comunque protette dai
> ruoli; il toggle controlla l'esposizione nella UI.

| Metodo | Endpoint | Accesso | Note |
|--------|----------|---------|------|
| GET | `` | 👤 | Tutte le sprint del workspace (con `taskTotal`/`taskCompleted`/`channelId`) |
| GET | `/active` | 👤 | Sprint attiva + i suoi task (`{ sprint, tasks }`); `sprint` null se nessuna |
| GET | `/{id}` | 👤 | Dettaglio di una sprint + task |
| POST | `` | 🛡️ | Crea (planning): `{ name, goal?, startDate?, endDate? }` (date previste, `YYYY-MM-DD`) |
| PATCH | `/{id}` | 🛡️ | Aggiorna (non se CLOSED): `{ name?, goal?, startDate?, endDate?, position? }` |
| DELETE | `/{id}` | 🛡️ | Elimina (solo PLANNED); i task tornano al backlog |
| POST | `/{id}/start` | 🛡️ | Avvia (solo PLANNED): crea la chat di sprint; **409** se esiste già una attiva |
| POST | `/{id}/close` | 🛡️ | Chiude (solo ACTIVE): vedi corpo sotto |
| POST | `/{id}/tasks/{elementId}` | 👤 (no guest) | Aggiunge un TASK alla sprint |
| DELETE | `/{id}/tasks/{elementId}` | 👤 (no guest) | Rimuove il TASK dalla sprint (torna al backlog) |

Corpo chiusura (`CloseSprintRequest`):
```json
{
  "retrospective": "Note di retrospettiva (opzionale)",
  "carryOver": "BACKLOG",        // BACKLOG (default) | NEXT_SPRINT — destino dei task incompleti
  "targetSprintId": null          // sprint pianificata di destinazione se carryOver = NEXT_SPRINT
}
```
> Alla chiusura i task **non completati** vengono spostati nel backlog (`sprint_id` = null) o nella
> sprint pianificata indicata; i task **completati mantengono** il collegamento (storico/timeline).
> La chat della sprint è un canale di tipo `SPRINT` (vedi §11), accessibile a tutti i membri.

## 7. Tag — `/api/workspaces/{wsId}/tags`
| Metodo | Endpoint | Accesso | Note |
|--------|----------|---------|------|
| GET | `` | 👤 · 🔑 `tags:read` | Lista |
| POST | `` | 👤 · 🔑 `tags:write` | `{ name, color }` |
| PUT | `/{tagId}` | 👤 · 🔑 `tags:write` | Aggiorna |
| DELETE | `/{tagId}` | 👤 · 🔑 `tags:write` | Elimina |

## 8. API key — `/api/workspaces/{wsId}/api-keys`
| Metodo | Endpoint | Accesso | Note |
|--------|----------|---------|------|
| GET | `` | 🛡️ | Elenca le chiavi (senza segreto) |
| POST | `` | 🛡️ | Crea una chiave (ritorna il segreto **una sola volta**) |
| DELETE | `/{keyId}` | 🛡️ | Revoca/elimina |

Corpo creazione: `{ "name": "Bot Discord", "scopes": ["elements:read","elements:write"], "expiresInDays": 90 }`
(`expiresInDays` opzionale; assente/null = nessuna scadenza).

## 9. AI "Akari" — `/api/workspaces/{wsId}/ai` (solo token utente)
| Metodo | Endpoint | Accesso | Note |
|--------|----------|---------|------|
| GET | `/status` | 👤 | `{ enabled }` (per mostrare/nascondere la chat) |
| GET | `/settings` | 🛡️ | Impostazioni dell'agente |
| PUT | `/settings` | 🛡️ | Aggiorna impostazioni (modello, chiave, personalità, …) |
| POST | `/test` | 🛡️ | Testa la chiave OpenRouter (`{ apiKey? }`) |
| GET | `/models` | 🛡️ | Modelli disponibili su OpenRouter |
| GET | `/conversations?scope=PRIVATE\|SHARED` | 👤 | Lista conversazioni |
| POST | `/conversations` | 👤 | Crea una conversazione |
| GET | `/conversations/{convId}/messages` | 👤 | Messaggi |
| POST | `/conversations/{convId}/messages` | 👤 | Invia messaggio → **risposta in streaming SSE** |
| POST | `/conversations/{convId}/command` | 👤 | Esegue un comando (`{ command, arg }`) |
| POST | `/conversations/{convId}/confirm` | 👤 | Conferma/annulla azioni in attesa (SSE) |
| DELETE | `/conversations/{convId}` | 👤 | Elimina la conversazione |

## 10. Email — `/api/workspaces/{wsId}/emails` (solo token utente)
| Metodo | Endpoint | Accesso | Note |
|--------|----------|---------|------|
| POST | `/send` | 🛡️ | Invia email (per ruolo e/o `userIds`); corpo in Markdown |
| POST | `/draft` | 🛡️ | Genera una bozza con Akari |

## 11. Chat / Stanze / Voce — `/api/workspaces/{wsId}/channels` (solo token utente)
| Metodo | Endpoint | Accesso | Note |
|--------|----------|---------|------|
| GET | `` | 👤 | Canali accessibili (DM, gruppi, ROOM pubbliche/membro) |
| GET | `/rooms` | 🛡️ | Tutte le stanze (gestione admin) |
| POST | `/dm` | 👤 | Apri/ottieni un DM (`{ userId }`) |
| POST | `/groups` | 👤 | Crea un gruppo (`{ name, memberIds }`) |
| POST | `/rooms` | 🛡️ | Crea una stanza (`RoomRequest`) |
| PUT | `/rooms/{id}` | 🛡️ | Modifica una stanza |
| DELETE | `/rooms/{id}` | 🛡️ | Elimina una stanza |
| GET | `/{id}/messages?before=&limit=` | 👤 | Storico messaggi (paginato) |
| POST | `/{id}/messages` | 👤 | Invia un messaggio (`{ content }`) |
| POST | `/{id}/read` | 👤 | Segna come letto |
| POST | `/{id}/typing` | 👤 | Notifica "sta scrivendo" |
| POST | `/{id}/voice/token` | 👤 | **Token d'accesso LiveKit** per la stanza vocale |

`RoomRequest`: `{ name, description?, isPrivate, voiceEnabled, screenShareEnabled, memberIds[] }`
(`memberIds` usato solo se `isPrivate`). Il token voce richiede `voiceEnabled`; se LiveKit non è
configurato risponde **503**. Vedi [docs/REALTIME_VOCE.md](./docs/REALTIME_VOCE.md).

> **Canali `SPRINT`** (v1.3): la chat dedicata a una sprint è un canale di tipo `SPRINT`, accessibile a
> tutti i membri del workspace (come una ROOM pubblica). Non compare nella lista `GET ``: vi si accede
> tramite `channelId` restituito da `…/sprints/active` e si usano gli stessi endpoint messaggi
> (`/{id}/messages`, `/{id}/read`, …).

## 12. Presenza — `/api/workspaces/{wsId}/presence` (solo token utente)
| Metodo | Endpoint | Accesso | Note |
|--------|----------|---------|------|
| POST | `/heartbeat` | 👤 | Heartbeat (`{ channelId? }` = stanza vocale corrente) → snapshot online |
| POST | `/offline` | 👤 | Uscita immediata dall'app (beacon `pagehide`): rimuove subito l'utente dalla presenza |
| GET | `` | 👤 | Snapshot della presenza del workspace |

## 12b. Webhook LiveKit — `POST /api/livekit/webhook` (v1.1)

Endpoint **pubblico** (nessun token applicativo) ma autenticato per **firma**: chiamato dal media
server LiveKit, non dai client. Verifica JWT HS256 + hash SHA-256 del corpo (`LiveKitService.verifyWebhook`).
Su `participant_left` azzera lo stato "in chiamata" del partecipante. Config in
`livekit/livekit.yaml` → sezione `webhook`. Vedi [docs/REALTIME_VOCE.md](./docs/REALTIME_VOCE.md) §7.

---

## 13. API key — guida d'uso

### Creazione (dalla UI)
Workspace → **Admin** → tab **API key** → *Nuova API key*. Il segreto in chiaro è mostrato **una sola
volta**: copialo e conservalo (es. variabile d'ambiente del bot). In DB è salvato solo l'hash SHA-256.

### Scope
| Scope | Permette |
|-------|----------|
| `elements:read` | Leggere elementi (task/eventi/storie/epiche) e allegati |
| `elements:write` | Creare/modificare/eliminare elementi e allegati |
| `drive:read` | Leggere cartelle e file |
| `drive:write` | Caricare, modificare, spostare, rinominare, copiare, eliminare |
| `tags:read` | Leggere i tag |
| `tags:write` | Creare/modificare/eliminare i tag |

Regola: `GET` richiede lo scope `:read`; le altre richiedono `:write` (lo `:write` include la lettura).

### Esempio — bot che crea un evento (`elements:write`)
```bash
curl -X POST "$BASE/api/workspaces/$WS_ID/elements" \
  -H "Authorization: Bearer $WT_KEY" -H "Content-Type: application/json" \
  -d '{ "title": "Riunione di team", "type": "EVENTO",
        "startDate": "2026-07-01T15:00:00Z", "endDate": "2026-07-01T16:00:00Z" }'
```

---

## 14. Modelli dati principali

**Element**: `id, workspaceId, parentId?, type, status, title, body?, startDate?, endDate?, allDay?,
position, sprintId?, completedAt?, blocked, createdBy, createdAt, updatedAt, tags[], assignees[], progress?`
- `type`: `EPICA · STORIA · TASK · EVENTO` · `status`: `DA_FARE · IN_CORSO · COMPLETATO · ARCHIVIATO`
- `sprintId`: sprint del TASK (null = backlog) · `completedAt`: istante di completamento · `blocked`: bloccante

**Sprint**: `id, workspaceId, name, goal?, startDate?, endDate?, actualStartAt?, actualEndAt?, status,
retrospectiveMd?, position, createdBy?, createdAt, taskTotal, taskCompleted, channelId?`
- `status`: `PLANNED · ACTIVE · CLOSED`

**Ruoli workspace**: `ADMIN · COLLABORATORE · GUEST` (i guest sono in sola lettura).

**DriveFile**: `id, folderId?, filename, contentType?, sizeBytes, uploadedBy, createdAt, lockedBy?, lockedAt?`

**Channel**: `id, type (DM|GROUP|ROOM|SPRINT), name, description, isPrivate, voiceEnabled, screenShareEnabled,
members[], lastMessage?, unreadCount, …`

**ApiKey** (vista pubblica, mai col segreto): `id, name, prefix, scopes[], createdAt, lastUsedAt?, expiresAt?, revoked`

---

## 15. Errori comuni
| Codice | Significato |
|--------|-------------|
| 400 | Richiesta non valida (campo mancante, scope inesistente) |
| 401 | Non autenticato (token assente/scaduto/non valido) |
| 403 | Permesso negato (ruolo insufficiente, scope mancante, workspace diverso) |
| 404 | Risorsa non trovata |
| 409 | Conflitto (cartella non vuota, file in modifica da altri) |
| 503 | Servizio non disponibile (es. voce: LiveKit non configurato) |

---

## 16. WebSocket (realtime)

- Endpoint: `/ws` (SockJS) · topic: `/topic/workspace/{workspaceId}` (broadcast).
- Eventi: `ELEMENT_*`, `MESSAGE_CREATED`, `CHANNEL_*`, `CHANNEL_READ`, `TYPING`, `PRESENCE`,
  `DRIVE_CHANGED` (mutazioni del Drive), `AI_MESSAGE` (chat condivise di Akari) — v1.1;
  `TAG_CHANGED` (tag creati/modificati/eliminati) — v1.2; `SPRINT_CHANGED` (creazione/avvio/chiusura
  sprint, assegnazione task) — v1.3.
- **Azioni dell'agente AI**: i tool di Akari girano sugli stessi servizi interni delle rotte REST
  (`ElementService`, `DriveService`, `TagService`), quindi emettono gli stessi eventi
  (`ELEMENT_*`, `DRIVE_CHANGED`, `TAG_CHANGED`): la UI si aggiorna in tempo reale anche per le azioni AI.
- Le scritture passano da REST; il WebSocket è solo broadcast e non è autenticato a livello STOMP.
  Dettagli in [docs/REALTIME_VOCE.md](./docs/REALTIME_VOCE.md).

---

## 17. Note di sicurezza
- Il segreto della API key è mostrato **una sola volta**; in DB c'è solo l'hash SHA-256. Revoca subito
  una chiave compromessa.
- Usa sempre **HTTPS** in produzione e tieni i segreti fuori dal codice (variabili d'ambiente).
- Imposta una **scadenza** quando ha senso e crea chiavi con il **minimo** degli scope necessari.
