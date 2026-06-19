# WorkTogether — Riferimento API e Integrazioni

Documentazione degli endpoint REST e guida all'uso delle **API key** per collegare
servizi esterni (es. un bot Discord).

- **Base URL (sviluppo):** `http://localhost:8080`
- **Base URL (produzione):** il dominio dove gira il backend
- Tutte le risposte sono in JSON. Gli errori hanno forma `{ "error": "messaggio" }`.

---

## 1. Autenticazione

Esistono **due modi** di autenticarsi, entrambi con header `Authorization: Bearer <token>`.

### a) Token utente (JWT)
Per le persone che usano l'app. Si ottiene con il login e va rinnovato periodicamente.
Dà accesso a **tutte** le funzionalità consentite dal ruolo dell'utente nel workspace.

### b) API key (per servizi esterni)
Per bot e integrazioni. Token che inizia con `wt_`. **Non scade automaticamente** (se non
imposti una scadenza), è **revocabile** in qualsiasi momento e ha **permessi limitati**:

- agisce **solo** sul workspace per cui è stata creata;
- può usare **solo** le risorse `elements`, `drive`, `tags` (più gli allegati, che stanno
  sotto `elements`);
- ogni operazione è filtrata dagli **scope** della chiave (lettura/scrittura per risorsa).

> Le API key **non** possono: gestire membri, impostazioni del workspace, utenti, altre API
> key, né fare login. Quelle operazioni richiedono un token utente con ruolo adeguato.

---

## 2. Login utente

| Metodo | Endpoint | Descrizione |
|--------|----------|-------------|
| POST | `/api/auth/login` | Login con email e password |
| POST | `/api/auth/refresh` | Rinnova l'access token |
| POST | `/api/auth/reset-password` | Cambia password (richiede login) |
| POST | `/api/auth/logout` | Invalida il refresh token |

**Login** — `POST /api/auth/login`
```json
{ "email": "mario@esempio.it", "password": "segreta" }
```
Risposta:
```json
{ "accessToken": "eyJ...", "refreshToken": "eyJ...", "user": { "...": "..." } }
```

**Refresh** — `POST /api/auth/refresh`
```json
{ "refreshToken": "eyJ..." }
```

---

## 3. API key — creazione e uso

### Creazione (dalla UI)
Workspace → **Admin** → tab **API key** → *Nuova API key*. Scegli nome, **scope** e scadenza.
Il segreto in chiaro viene mostrato **una sola volta**: copialo e conservalo (es. variabile
d'ambiente del bot). In database è salvato solo il suo hash SHA-256.

### Scope disponibili
| Scope | Permette |
|-------|----------|
| `elements:read` | Leggere elementi (task, eventi, storie, epiche) e allegati |
| `elements:write` | Creare/modificare/eliminare elementi e allegati |
| `drive:read` | Leggere cartelle e file del Drive |
| `drive:write` | Caricare, modificare, spostare, rinominare, copiare, eliminare |
| `tags:read` | Leggere i tag |
| `tags:write` | Creare/modificare/eliminare i tag |

Regola: le richieste `GET` richiedono lo scope `:read` della risorsa; tutte le altre
(`POST/PUT/PATCH/DELETE`) richiedono lo scope `:write`. Lo scope di scrittura include la lettura.

### Uso
```
Authorization: Bearer wt_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

### Esempio — bot Discord che crea un evento
Chiave con scope `elements:write`:
```bash
curl -X POST "$BASE/api/workspaces/$WS_ID/elements" \
  -H "Authorization: Bearer $WT_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Riunione di team",
    "type": "EVENTO",
    "startDate": "2026-07-01T15:00:00Z",
    "endDate": "2026-07-01T16:00:00Z"
  }'
```

### Esempio — leggere i task del workspace
Chiave con scope `elements:read`:
```bash
curl "$BASE/api/workspaces/$WS_ID/elements" \
  -H "Authorization: Bearer $WT_KEY"
```

### Gestione chiavi (solo admin, token utente)
| Metodo | Endpoint | Descrizione |
|--------|----------|-------------|
| GET | `/api/workspaces/{wsId}/api-keys` | Elenca le chiavi (senza segreto) |
| POST | `/api/workspaces/{wsId}/api-keys` | Crea una chiave (ritorna il segreto una volta) |
| DELETE | `/api/workspaces/{wsId}/api-keys/{keyId}` | Revoca/elimina una chiave |

Corpo creazione:
```json
{ "name": "Bot Discord", "scopes": ["elements:read", "elements:write"], "expiresInDays": 90 }
```
`expiresInDays` è opzionale (`null` o assente = nessuna scadenza).

---

## 4. Endpoint per risorsa

Legenda accesso: 🔑 = utilizzabile da API key con lo scope indicato · 👤 = solo token utente.

### Elementi (task, eventi, storie, epiche)
Base: `/api/workspaces/{wsId}/elements`

> **Gerarchia e visibilità** — gli elementi sono organizzati così: **EPICA → STORIA → TASK**.
> Nella Kanban i task sono mostrati **dentro la loro storia**: un `TASK` deve avere
> `parentId` = id di una `STORIA`, altrimenti viene creato ma **non compare** sulla board.
> Una `STORIA` compare come corsia anche senza genitore (puoi comunque collegarla a un'`EPICA`
> con `parentId`). Gli `EVENTO` sono autonomi e appaiono nel **Calendario** (servono `startDate`
> ed eventuale `endDate`). Per ottenere l'id di una storia: crea una storia e leggi `id` dalla
> risposta, oppure usa `GET /elements` e filtra per `"type": "STORIA"`.

| Metodo | Endpoint | Accesso | Note |
|--------|----------|---------|------|
| GET | `/elements` | 🔑 `elements:read` | Lista di tutti gli elementi del workspace |
| POST | `/elements` | 🔑 `elements:write` | Crea un elemento |
| GET | `/elements/{id}` | 🔑 `elements:read` | Dettaglio |
| PUT | `/elements/{id}` | 🔑 `elements:write` | Aggiorna |
| DELETE | `/elements/{id}` | 🔑 `elements:write` | Elimina |

Corpo (create/update) — `ElementRequest`:
```json
{
  "title": "Titolo",                // obbligatorio
  "type": "TASK",                   // EPICA | STORIA | TASK | EVENTO  (obbligatorio)
  "parentId": null,                 // UUID dell'elemento padre (opzionale)
  "status": "DA_FARE",              // DA_FARE | IN_CORSO | COMPLETATO | ARCHIVIATO
  "body": "Testo della descrizione", // opzionale; accetta testo semplice o JSON dell'editor — vedi nota
  "startDate": "2026-07-01T15:00:00Z",
  "endDate": "2026-07-01T16:00:00Z",
  "allDay": false,
  "position": 0,
  "assigneeIds": ["<uuid utente>"],
  "tagIds": ["<uuid tag>"]
}
```

> **Campo `body`** (opzionale): nel database è una colonna `jsonb`. Il backend ora accetta
> **due formati** e li normalizza automaticamente:
> - **testo semplice** — es. `"body": "Descrizione del task"` (i ritorni a capo diventano
>   paragrafi). Comodo per bot e integrazioni.
> - **JSON dell'editor** — il documento prodotto dall'editor dell'app, passato come stringa.
>
> In entrambi i casi il contenuto viene mostrato correttamente nell'app.

### Allegati degli elementi
Base: `/api/workspaces/{wsId}/elements/{id}/attachments` (rientrano nello scope `elements`)

| Metodo | Endpoint | Accesso | Note |
|--------|----------|---------|------|
| GET | `/attachments` | 🔑 `elements:read` | Lista allegati |
| POST | `/attachments` | 🔑 `elements:write` | Upload (multipart, campo `file`) |
| GET | `/attachments/{attId}` | 🔑 `elements:read` | Download |
| DELETE | `/attachments/{attId}` | 🔑 `elements:write` | Elimina |

### Drive (cartelle e file)
Base: `/api/workspaces/{wsId}/drive`

| Metodo | Endpoint | Accesso | Note |
|--------|----------|---------|------|
| GET | `/drive/folders?parentId=` | 🔑 `drive:read` | Cartelle (radice se `parentId` assente) |
| POST | `/drive/folders` | 🔑 `drive:write` | Crea cartella `{ "name": "...", "parentId": null }` |
| PATCH | `/drive/folders/{id}/rename` | 🔑 `drive:write` | `{ "name": "nuovo" }` |
| PATCH | `/drive/folders/{id}/move` | 🔑 `drive:write` | `{ "targetFolderId": null }` (null = radice) |
| DELETE | `/drive/folders/{id}` | 🔑 `drive:write` | Solo se vuota |
| GET | `/drive/files?folderId=` | 🔑 `drive:read` | File nella cartella |
| POST | `/drive/files?folderId=` | 🔑 `drive:write` | Upload (multipart, campo `file`) |
| GET | `/drive/files/{id}` | 🔑 `drive:read` | Download / contenuto |
| PATCH | `/drive/files/{id}/rename` | 🔑 `drive:write` | `{ "name": "nuovo" }` |
| PATCH | `/drive/files/{id}/move` | 🔑 `drive:write` | `{ "targetFolderId": null }` |
| POST | `/drive/files/{id}/copy` | 🔑 `drive:write` | Duplica il file |
| DELETE | `/drive/files/{id}` | 🔑 `drive:write` | Elimina |
| PUT | `/drive/files/{id}/content` | 🔑 `drive:write` | Salva testo `{ "content": "..." }` |
| POST | `/drive/files/{id}/lock` | 🔑 `drive:write` | Acquisisce il lock di modifica |
| DELETE | `/drive/files/{id}/lock` | 🔑 `drive:write` | Rilascia il lock |

### Tag
Base: `/api/workspaces/{wsId}/tags`

| Metodo | Endpoint | Accesso | Note |
|--------|----------|---------|------|
| GET | `/tags` | 🔑 `tags:read` | Lista |
| POST | `/tags` | 🔑 `tags:write` | `{ "name": "Urgente", "color": "#ef4444" }` |
| PUT | `/tags/{id}` | 🔑 `tags:write` | Aggiorna |
| DELETE | `/tags/{id}` | 🔑 `tags:write` | Elimina |

### Workspace, membri, utenti (solo token utente)
| Metodo | Endpoint | Accesso | Note |
|--------|----------|---------|------|
| GET | `/api/workspaces` | 👤 | Workspace dell'utente |
| POST | `/api/workspaces` | 👤 (system admin) | Crea workspace |
| GET | `/api/workspaces/{wsId}/members` | 👤 | Membri |
| POST | `/api/workspaces/{wsId}/members?userId=&role=` | 👤 (admin) | Aggiunge membro |
| PATCH | `/api/workspaces/{wsId}/members/{userId}/role?role=` | 👤 (admin) | Cambia ruolo |
| DELETE | `/api/workspaces/{wsId}/members/{userId}` | 👤 (admin) | Rimuove membro |
| POST | `/api/workspaces/{wsId}/users` | 👤 (admin) | Crea utente nel workspace |
| PATCH | `/api/workspaces/{wsId}/settings` | 👤 (admin) | Impostazioni workspace |
| GET | `/api/users/me` | 👤 | Profilo corrente |
| PATCH | `/api/users/me` | 👤 | Aggiorna nome/avatar |
| GET | `/api/users/me/tasks` | 👤 | I task assegnati all'utente |
| GET | `/api/users` | 👤 (system admin) | Tutti gli utenti |

---

## 5. Modelli dati principali

**Element**
```
id, workspaceId, parentId?, type, status, title, body?,
startDate?, endDate?, allDay?, position, createdBy, createdAt, updatedAt,
tags[], assignees[], progress?
```
- `type`: `EPICA` · `STORIA` · `TASK` · `EVENTO`
- `status`: `DA_FARE` · `IN_CORSO` · `COMPLETATO` · `ARCHIVIATO`

**Ruoli workspace**: `ADMIN` · `COLLABORATORE` · `GUEST`
- I `GUEST` sono in sola lettura (non creano/modificano).
- Spostare/rinominare/eliminare file e cartelle: solo **proprietario** o **admin**.
- Copiare e caricare file: qualsiasi non-guest.

**DriveFile**
```
id, folderId?, filename, contentType?, sizeBytes, uploadedBy, createdAt, lockedBy?, lockedAt?
```

**ApiKey** (vista pubblica, mai col segreto)
```
id, name, prefix, scopes[], createdAt, lastUsedAt?, expiresAt?, revoked
```

---

## 6. Errori comuni

| Codice | Significato |
|--------|-------------|
| 400 | Richiesta non valida (es. scope inesistente, campo mancante) |
| 401 | Non autenticato (token assente, scaduto o non valido) |
| 403 | Permesso negato (ruolo insufficiente, scope mancante, workspace diverso) |
| 404 | Risorsa non trovata |
| 409 | Conflitto (es. cartella non vuota, file in modifica da un altro utente) |

Esempi di 403 tipici delle API key:
- *"La API key non è abilitata per questo workspace"* — la chiave è di un altro workspace.
- *"Risorsa non accessibile tramite API key"* — endpoint fuori da drive/elements/tags.
- *"Scope insufficienti per questa operazione"* — manca lo scope `:read`/`:write` richiesto.

---

## 7. Note di sicurezza

- Il segreto della API key è mostrato **una sola volta**; in DB c'è solo l'hash SHA-256.
- Revoca subito una chiave compromessa dal pannello Admin → API key.
- Usa sempre **HTTPS** in produzione e tieni il segreto fuori dal codice (variabili d'ambiente).
- Imposta una **scadenza** quando ha senso, e crea chiavi con il **minimo** degli scope necessari.
