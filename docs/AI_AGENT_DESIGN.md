# WorkTogether — Agente AI: documento di progettazione

> Stato: **DESIGN** (non ancora implementato). Questo file serve a progettare tutto e a
> riprendere il lavoro in sessioni successive. L'implementazione vera avverrà in un secondo
> momento, per fasi (vedi §13 Roadmap).

## 1. Obiettivo

Aggiungere un **agente AI** integrato nel workspace, con cui chattare, capace di **gestire il
workspace** (creare/aggiornare task, eventi, storie, epiche, file, tag; rispondere a domande
sui contenuti). Funziona tramite **OpenRouter**. Tutte le impostazioni stanno nel pannello
**Admin**. Include **memoria conversazionale**, **compacting** automatico del contesto, e tre
file Markdown modificabili dagli admin: **personalità**, **memoria**, **tools**.

## 2. Decisioni di design (confermate)

| Tema | Scelta |
|------|--------|
| Come agisce l'agente | **Servizi interni** del backend (`ElementService`, `DriveService`, `TagService`, ...). Nessun limite di scope, logica lato server. |
| Ambito chat | **Entrambe**: conversazioni **private** per utente + una chat **condivisa** del workspace. |
| Autonomia | Crea/modifica liberamente; le **eliminazioni richiedono conferma** in chat. |
| Memoria a lungo termine | **Auto-evolutiva** (l'agente la aggiorna) **+** modificabile dagli admin. |
| Provider LLM | **OpenRouter** (API compatibile OpenAI, con tool calling). |

## 3. Architettura ad alto livello

```
┌─────────────┐   chat (SSE/WS)   ┌──────────────────────────────────────┐
│  Frontend   │ ───────────────▶  │  Backend Spring Boot                  │
│  /assistant │ ◀───────────────  │                                       │
└─────────────┘   stream token    │  AiController  ──▶  AiService         │
                                   │                       │   ▲           │
                                   │        build context  │   │ tool exec │
                                   │   (personality+memory+ │   │           │
                                   │    summary+history+    ▼   │           │
                                   │    tools)        OpenRouterClient      │
                                   │                       │                │
                                   │                       ▼                │
                                   │   ToolRegistry ─▶ ElementService /     │
                                   │                   DriveService /       │
                                   │                   TagService / ...     │
                                   └───────────────────────┬───────────────┘
                                                           ▼
                                                     OpenRouter API
```

Componenti backend nuovi:
- **`OpenRouterClient`** — chiamate HTTP a OpenRouter (chat completions + streaming + tool calling).
- **`AiService`** — orchestrazione di un turno: costruisce il contesto, chiama il modello, gestisce
  il loop di tool calling, persiste i messaggi, attiva il compacting.
- **`AgentToolRegistry`** + implementazioni tool — mappano i tool del modello ai servizi interni.
- **`AiMemoryService`** — gestione memoria/summary/compacting.
- **`AiSettingsService`**, **`AiConversationService`** — impostazioni e conversazioni.
- **`AiController`** — endpoint REST/SSE.
- Entità + repository + migration Flyway (`V7__ai_agent.sql`).

Frontend nuovo:
- Pagina **Assistente** (`/workspace/:wsId/assistant`) con elenco conversazioni, thread, input,
  streaming, card per le azioni dei tool e conferme.
- Tab **Agente AI** in Admin per tutte le impostazioni e i tre editor Markdown.

## 4. Configurazione (Admin → tab "Agente AI")

Tutte per-workspace, solo ADMIN:

| Impostazione | Tipo | Default | Note |
|--------------|------|---------|------|
| `enabled` | bool | false | Attiva/disattiva l'agente nel workspace |
| `openRouterApiKey` | string (segreto) | — | Salvata lato server, **mai** restituita in chiaro (mascherata es. `sk-or-…abcd`) |
| `model` | string | `openai/gpt-4o-mini` | Slug modello OpenRouter (dropdown popolato da `/models` o testo libero) |
| `temperature` | number | 0.3 | |
| `maxTokens` | int | 1024 | Token massimi per risposta |
| `contextWindowTokens` | int | 16000 | Budget di contesto su cui basare il compacting |
| `compactThresholdPct` | int | 70 | % del budget oltre cui scatta il compacting |
| `autonomy` | enum | `CONFIRM_DESTRUCTIVE` | `READ_ONLY` · `CONFIRM_DESTRUCTIVE` · `FULL` |
| `memoryMode` | enum | `AUTO_AND_ADMIN` | `ADMIN_ONLY` · `AUTO_AND_ADMIN` |
| `maxToolIterations` | int | 8 | Limite di passi tool per singolo turno (anti-loop) |
| `personalityMd` | text | template | File personalità (vedi §5) |
| `memoryMd` | text | "" | File memoria a lungo termine (vedi §5) |
| `toolsMd` | text | template | File guida/policy sui tool (vedi §5) |

Sicurezza chiave: salvarla cifrata a riposo (AES con secret app) o, come minimo, non esporla mai
via API e mascherarla nelle risposte.

## 5. I tre file Markdown

Sono testo modificabile dagli admin con l'editor CodeMirror già presente (linguaggio markdown).

### `personality.md` — chi è l'agente
System prompt persona + linee guida di comportamento. Esempio:
```
Sei "Otto", l'assistente del workspace {{workspaceName}}.
Sei conciso, pratico e collaborativo. Parli italiano.
Quando crei o modifichi elementi riepiloghi sempre cosa hai fatto.
Non inventi dati: se non sai, usi i tool di lettura o chiedi.
```
Supporta placeholder come `{{workspaceName}}`, `{{userName}}`, `{{today}}`.

### `memory.md` — memoria a lungo termine (condivisa nel workspace)
Fatti durevoli, preferenze, convenzioni. Esempio:
```
- Le release vanno sempre come EVENTO con tag "release".
- Lo standup è ogni lunedì 9:30.
- Preferenza: i task nuovi senza storia vanno nella storia "Backlog".
```
Modalità `AUTO_AND_ADMIN`: l'agente può **aggiungere** voci tramite il tool `remember`
(append, mai sovrascrivere in blocco), e gli admin la modificano a mano. È **condivisa** tra
tutte le conversazioni del workspace (sia private che condivise).

### `tools.md` — policy d'uso dei tool (non è il codice dei tool)
Gli schemi dei tool sono definiti nel codice; questo file è **guida/policy** umana sovrapposta,
e opzionalmente abilita/disabilita tool. Esempio:
```
# Abilitati
elements.*, drive.read, tags.*

# Policy
- Non creare EPICHE senza chiedere conferma.
- Prima di creare un task chiedi sempre in quale storia metterlo se non è ovvio.
- Per le date usa il fuso Europe/Rome.
```
Interpretazione: la sezione "Abilitati" filtra i tool esposti al modello; la "Policy" viene
iniettata nel system prompt.

## 6. Schema dati (migration `V7__ai_agent.sql`)

```sql
-- Impostazioni agente per workspace (1:1)
CREATE TABLE ai_settings (
    workspace_id UUID PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
    enabled BOOLEAN NOT NULL DEFAULT FALSE,
    openrouter_api_key TEXT,              -- cifrata
    model VARCHAR(120) NOT NULL DEFAULT 'openai/gpt-4o-mini',
    temperature DOUBLE PRECISION NOT NULL DEFAULT 0.3,
    max_tokens INT NOT NULL DEFAULT 1024,
    context_window_tokens INT NOT NULL DEFAULT 16000,
    compact_threshold_pct INT NOT NULL DEFAULT 70,
    autonomy VARCHAR(20) NOT NULL DEFAULT 'CONFIRM_DESTRUCTIVE',
    memory_mode VARCHAR(20) NOT NULL DEFAULT 'AUTO_AND_ADMIN',
    max_tool_iterations INT NOT NULL DEFAULT 8,
    personality_md TEXT NOT NULL DEFAULT '',
    memory_md TEXT NOT NULL DEFAULT '',
    tools_md TEXT NOT NULL DEFAULT '',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Conversazioni: private (owner valorizzato) o condivise (owner NULL)
CREATE TABLE ai_conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    scope VARCHAR(10) NOT NULL CHECK (scope IN ('PRIVATE','SHARED')),
    owner_user_id UUID REFERENCES users(id) ON DELETE CASCADE,  -- NULL se SHARED
    title VARCHAR(255),
    summary TEXT,                          -- riassunto compattato dei messaggi vecchi
    summarized_through UUID,               -- ultimo messaggio incluso nel summary
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_ai_conv_ws ON ai_conversations(workspace_id);
CREATE INDEX idx_ai_conv_owner ON ai_conversations(owner_user_id);

-- Messaggi
CREATE TABLE ai_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
    role VARCHAR(12) NOT NULL CHECK (role IN ('USER','ASSISTANT','TOOL','SYSTEM')),
    content TEXT,
    tool_calls JSONB,                      -- chiamate tool richieste dall'assistant
    tool_call_id VARCHAR(80),              -- per i messaggi role=TOOL
    author_user_id UUID REFERENCES users(id),  -- chi ha scritto (per chat condivisa)
    token_count INT NOT NULL DEFAULT 0,
    archived BOOLEAN NOT NULL DEFAULT FALSE, -- true = già compattato nel summary
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_ai_msg_conv ON ai_messages(conversation_id, created_at);

-- Azioni in attesa di conferma (eliminazioni, ecc.)
CREATE TABLE ai_pending_actions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
    tool_name VARCHAR(80) NOT NULL,
    arguments JSONB NOT NULL,
    status VARCHAR(12) NOT NULL DEFAULT 'PENDING', -- PENDING | CONFIRMED | REJECTED
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

Nota: `ddl-auto=validate`, quindi la tabella va creata **solo** via migration Flyway.

## 7. Memoria e compacting

Tre livelli di memoria:
1. **Breve termine** — gli ultimi messaggi della conversazione, verbatim.
2. **Summary di conversazione** (`ai_conversations.summary`) — riassunto progressivo dei messaggi
   più vecchi (il "compacting").
3. **Lungo termine** (`memory.md`) — fatti durevoli condivisi nel workspace.

**Contesto inviato al modello** ad ogni turno:
```
[system]  personality.md (con placeholder risolti) + policy da tools.md
[system]  MEMORIA WORKSPACE: contenuto di memory.md
[system]  RIASSUNTO PRECEDENTE: ai_conversations.summary   (se presente)
[...]     messaggi recenti non archiviati (USER/ASSISTANT/TOOL)
[user]    nuovo messaggio
```

**Algoritmo di compacting** (in `AiMemoryService`):
- Si stima il totale token dei messaggi non archiviati (+ summary + system).
- Se supera `contextWindowTokens * compactThresholdPct/100`:
  1. prendi i messaggi non archiviati più vecchi fino a liberare ~metà budget;
  2. chiedi al modello (chiamata separata, economica) di **estendere** il summary integrando
     quei messaggi (prompt: "aggiorna il riassunto includendo questi scambi, mantieni decisioni,
     fatti, task creati, preferenze");
  3. salva il nuovo `summary` e `summarized_through`, marca quei messaggi `archived=true`
     (restano in DB per lo storico, escono dal contesto attivo).
- **Memoria auto-evolutiva**: durante il compacting (o tramite il tool `remember`) i fatti
  durevoli vengono estratti e **aggiunti** a `memory.md` (append). In `ADMIN_ONLY` questo passo
  è disattivato.

**Stima token**: euristica iniziale `ceil(chars/4)`; in seguito si può usare un tokenizer.

## 8. Tool calling

Formato OpenAI-compatible (`tools: [{type:"function", function:{name, description, parameters}}]`).
Loop: modello → eventuali `tool_calls` → il backend esegue i tool non distruttivi, rimanda i
risultati come messaggi `role=TOOL`, e richiama il modello finché non produce una risposta finale
(max `maxToolIterations`).

### Catalogo tool iniziale
Lettura (sempre permessi se `enabled`):
- `list_elements(type?, status?, parentId?, query?)`
- `get_element(id)`
- `list_files(folderId?)` · `read_file(fileId)`
- `list_tags()` · `list_members()`

Scrittura (permessi salvo `READ_ONLY`):
- `create_element(type, title, status?, parentId?, body?, startDate?, endDate?, assigneeIds?, tagIds?)`
- `update_element(id, ...campi...)`
- `create_tag(name, color?)`
- `create_text_file(folderId?, filename, content)` · `write_file(fileId, content)`
- `remember(note)` → append a `memory.md` (solo se `AUTO_AND_ADMIN`)

Distruttivi (richiedono conferma in `CONFIRM_DESTRUCTIVE`, liberi in `FULL`, vietati in `READ_ONLY`):
- `delete_element(id)` · `delete_file(id)` · `delete_tag(id)`

**Flusso di conferma**: quando il modello chiama un tool distruttivo, il backend **non esegue**:
crea una riga in `ai_pending_actions`, manda in chat una card "Confermi: elimino X?" con
Conferma/Annulla. Alla conferma dell'utente il backend esegue il tool e prosegue il turno
(ri-iniettando il risultato). Su rifiuto, comunica l'annullamento al modello.

**Permessi effettivi**: i tool girano sui servizi interni attribuendo le azioni **all'utente che
chatta** (rispettando il suo ruolo nel workspace: un GUEST non può creare anche via agente), con
in più il gate di `autonomy` per i distruttivi. (Alternativa valutabile in seguito: un utente di
servizio "AI" dedicato per l'audit; vedi §14.)

## 9. Flusso di un turno (sequence)

```
Utente invia messaggio
 └─ AiController.sendMessage(convId, text)
     ├─ persiste messaggio USER
     ├─ AiMemoryService.maybeCompact(conv)
     ├─ costruisce contesto (system + memory + summary + recenti)
     ├─ loop (max N):
     │   ├─ OpenRouterClient.chat(messages, tools, stream)
     │   ├─ stream token → frontend (SSE/WS)
     │   ├─ se tool_calls:
     │   │     ├─ distruttivo + CONFIRM → crea pending action, interrompe, chiede conferma
     │   │     └─ altrimenti → esegue tool, persiste messaggio TOOL, continua loop
     │   └─ altrimenti → risposta finale
     ├─ persiste messaggio ASSISTANT
     └─ aggiorna updated_at conversazione
```

## 10. API backend (bozza)

Impostazioni (admin):
- `GET /api/workspaces/{wsId}/ai/settings` — config (chiave mascherata)
- `PUT /api/workspaces/{wsId}/ai/settings` — aggiorna config + i 3 md
- `GET /api/workspaces/{wsId}/ai/models` — (opz.) elenco modelli da OpenRouter

Conversazioni e chat (membri):
- `GET /api/workspaces/{wsId}/ai/conversations?scope=PRIVATE|SHARED`
- `POST /api/workspaces/{wsId}/ai/conversations` `{ scope, title? }`
- `GET /api/workspaces/{wsId}/ai/conversations/{id}/messages`
- `POST /api/workspaces/{wsId}/ai/conversations/{id}/messages` `{ text }` → **stream** risposta (SSE)
- `POST /api/workspaces/{wsId}/ai/conversations/{id}/actions/{actionId}/confirm` `{ confirm: true|false }`
- `DELETE /api/workspaces/{wsId}/ai/conversations/{id}`

Streaming: SSE (`text/event-stream`) è il più semplice da affiancare a Spring MVC; in alternativa
riusare lo STOMP/WebSocket già presente. **Da decidere in implementazione** (vedi §14).

## 11. Frontend

- **Sidebar**: voce "Assistente AI" (visibile se `enabled`).
- **Pagina `/workspace/:wsId/assistant`**:
  - colonna sinistra: switch Private/Condivisa + elenco conversazioni + "Nuova chat";
  - area centrale: thread messaggi (markdown), token in streaming, card per azioni tool
    ("Ho creato il task X"), prompt di conferma per i distruttivi;
  - input in basso con invio.
- **Admin → tab "Agente AI"**: form impostazioni + 3 editor markdown (riuso `CodeEditor`),
  pulsante "Salva", test connessione OpenRouter.
- Tipi TS, `aiApi` in `lib/api.ts`, store conversazione.

## 12. Sicurezza, costi, limiti

- Chiave OpenRouter solo lato server, cifrata, mai restituita; mascherata in UI.
- `autonomy` e conferma proteggono dalle azioni distruttive.
- `maxToolIterations` evita loop infiniti; `maxTokens`/`contextWindowTokens` limitano i costi.
- Le azioni rispettano i permessi di ruolo dell'utente.
- (Futuro) rate-limit per utente/workspace, log dei turni, budget mensile.

## 13. Roadmap implementativa (per riprendere a fasi)

- [x] **F1 — Schema & settings** ✅ FATTO: migration `V7`, entità/repository, `AiSettingsService`,
      endpoint settings, tab Admin "Agente AI" con form + 3 editor md + test connessione.
- [x] **F2 — OpenRouter & chat base (no tool)** ✅ FATTO: `OpenRouterClient.streamChat`, conversazioni +
      messaggi, endpoint chat con **streaming SSE**, pagina Assistente (private + condivisa). Solo Q&A.
- [x] **F3 — Tool calling (lettura + scrittura)** ✅ FATTO: `AgentToolRegistry`, tool read/write mappati
      ai servizi, loop di tool calling con streaming, render azioni in chat. (Distruttivi rinviati a F4.)
- [x] **F4 — Conferme distruttive** ✅ FATTO: `ai_pending_actions`, tool `delete_*`, pausa/ripresa
      del turno, card di conferma in chat, gate `autonomy`.
- [x] **F5 — Memoria & compacting** ✅ FATTO: memoria auto-evolutiva (tool `remember`) +
      `memory.md` editabile; **compacting/summary progressivo** via `AiMemoryService` agganciato in `AiChatService`.
- [x] **F6 — Rifiniture** ✅ FATTO: placeholder personalità (già in `buildContext`), policy da `tools.md`
      (iniettata), **endpoint `/models`** con dropdown in Admin, **parsing errori OpenRouter**, polish UI.
      Restano fuori scope perché *open question* (§14.7): parsing enable/disable della sezione "Abilitati" di `tools.md`.

## 13b. Stato implementazione

### Fase 1 — FATTA
File creati/modificati:
- Backend: `db/migration/V7__ai_agent.sql` (tutte le tabelle AI), `AiSettings` entity,
  `AiAutonomy`/`AiMemoryMode` enum, `AiSettingsRepository`, `AiKeyCipher` (AES-GCM),
  `OpenRouterClient` (minimale: `testKey` via `/auth/key`), `AiSettingsService`,
  `AiController` (`GET/PUT /ai/settings`, `POST /ai/test`), `UpdateAiSettingsRequest`,
  `AiSettingsResponse`, `application.yml` (`app.ai.secret`, `app.ai.base-url`).
- Frontend: tipi `AiSettings`/`AiAutonomy`/`AiMemoryMode`/`AiTestResult`, `aiApi` in `lib/api.ts`,
  tab **Agente AI** in `AdminPage` (componente `AiAgentTab` + `MdEditorBox`).

Decisioni applicate in F1:
- Chiave OpenRouter cifrata **AES-256/GCM**, segreto `app.ai.secret` (fallback su `JWT_SECRET`).
  Mai restituita: la response espone solo `apiKeySet` + `apiKeyPreview` mascherata.
- Test connessione: `GET /auth/key` di OpenRouter (200 = valida).
- Le tabelle conversazioni/messaggi/azioni sono già create dalla migration ma **non** ancora
  mappate a entità (verranno usate da F2/F4).

### Da fare prima di provare F1
- Rebuild backend (Flyway applica `V7`). Frontend: `npm install` non serve (nessuna nuova dip).
- In Admin → tab **Agente AI**: incollare la chiave OpenRouter, salvare, "Testa connessione".

### Fase 2 — FATTA
File creati/modificati:
- Backend: enum `AiConversationScope`/`AiMessageRole`; entità `AiConversation`, `AiMessage`;
  repository `AiConversationRepository`/`AiMessageRepository`; DTO `CreateConversationRequest`,
  `AiConversationResponse`, `AiMessageResponse`; `OpenRouterClient.streamChat` (SSE);
  `AiConversationService` (CRUD + accesso), `AiChatService` (turno + SSE), `AiSettingsService.isEnabled`,
  `AiController` esteso (status, conversazioni, messaggi, stream, delete).
- Frontend: tipi conversazione/messaggio, `aiApi` (CRUD + `streamMessage` via fetch),
  voce sidebar "Assistente AI" (se attivo), rotta + pagina `AssistantPage` (chat private/condivise,
  streaming token, markdown, nuova chat, elimina).

Decisioni applicate in F2:
- **Streaming**: SSE dal backend (`SseEmitter`), letto sul frontend via `fetch` + `ReadableStream`
  (così si può inviare il Bearer token, cosa impossibile con `EventSource`). Protocollo eventi:
  `data: {"type":"token","text":...}` / `{"type":"done"}` / `{"type":"error","message":...}`.
- Identità: i messaggi sono attribuiti all'utente che chatta (`author_user_id`).
- Contesto turno: system = personality (placeholder risolti) + memory.md + summary; poi lo storico
  non archiviato (USER/ASSISTANT). Nessun compacting ancora (F5) né tool (F3).
- Conversazioni condivise: eliminabili solo da admin; private solo dal proprietario.

### Da fare prima di provare F2
- Rebuild backend. In Admin → Agente AI: **abilita**, imposta chiave + modello, salva.
- Compare la voce "Assistente AI" in sidebar: apri, "Nuova chat", scrivi.

### Fase 3 — FATTA
File creati/modificati:
- Backend: `OpenRouterClient` esteso (tool calling: nuovi `ChatMsg`/`ToolCall`/`StreamResult`,
  accumulo dei `tool_calls` dallo stream); `AgentToolRegistry` (specs + execute);
  `DriveService.createTextFile`/`readText`; `AiChatService` riscritto con loop
  modello→tool→modello; `AiConversationService.getMessages` filtra i messaggi interni (TOOL).
- Frontend: `aiApi.streamMessage` gestisce l'evento `tool`; `AssistantPage` mostra le azioni
  in corso come chip (es. "Creo un elemento").

Tool disponibili (F3):
- Lettura: `list_elements`, `get_element`, `list_files`, `read_file`, `list_tags`, `list_members`.
- Scrittura (se non READ_ONLY): `create_element`, `update_element`, `create_tag`,
  `create_text_file`, `write_file`.
- Distruttivi (`delete_*`): **non** esposti in F3 → arrivano in F4 con la conferma.

Decisioni applicate in F3:
- Loop: ad ogni iterazione si fa una `streamChat` con i `tools`; se il modello chiede tool, si
  eseguono sui servizi interni (azioni attribuite all'utente che chatta, rispettando il suo ruolo),
  si rimandano i risultati e si itera. Stop a `maxToolIterations` (poi una conclusione forzata senza tool).
- Lo storico inviato al modello nei turni successivi include solo USER + risposte testuali
  ASSISTANT (le sequenze tool del turno corrente sono ricostruite live, quelle passate non si ripetono).
- `body` degli elementi: l'agente passa testo semplice (già normalizzato lato `ElementService`).
- `tools.md` viene iniettato nel system prompt come "POLICY SUI TOOL".

### Da fare prima di provare F3
- Rebuild backend. Prova in chat: "elenca i task", "crea una storia 'Backlog'",
  "crea un task 'X' nella storia Backlog", "crea un tag 'urgente' rosso".

### Fase 4 — FATTA
File creati/modificati:
- Backend: migration `V8` (colonna `tool_call_id`); enum `AiPendingActionStatus`; entità
  `AiPendingAction` + repository; tool `delete_element/file/tag/folder` nel registry con
  `isDestructive`/`describe`; `AiChatService` riscritto con **replay completo** del contesto
  (USER/ASSISTANT/tool-calls/TOOL) e logica **pausa/ripresa**; endpoint `POST .../confirm`.
- Frontend: helper SSE condiviso `aiStreamSse`, `aiApi.confirmActions`, evento `confirm`;
  `AssistantPage` mostra la card "Conferma richiesta" con Conferma/Annulla che riprende lo stream.

Decisioni applicate in F4:
- In `CONFIRM_DESTRUCTIVE` un tool `delete_*` non viene eseguito: si crea una `ai_pending_actions`
  (PENDING), si emette l'evento `confirm` e **il turno si sospende** (SSE chiuso). Le altre tool
  della stessa risposta (non distruttive) vengono comunque eseguite subito.
- Alla conferma: `POST .../confirm {confirm}` esegue (o annulla) le azioni in attesa, salva i
  risultati come messaggi TOOL e **riprende** il loop in un nuovo stream SSE.
- In `FULL` i `delete_*` si eseguono subito; in `READ_ONLY` non sono esposti.
- Il contesto è ora un **replay fedele** della conversazione (così la ripresa è coerente col
  protocollo OpenAI: ogni `tool_call` ha il suo risultato).

### Da fare prima di provare F4
- Rebuild backend (Flyway applica `V8`). In chat: "elimina il task X" → compare la card di conferma.
- Per disattivare le conferme: Admin → Agente AI → Autonomia = "Pieno controllo".

### Fase 5 — FATTA
Memoria auto-evolutiva:
- Backend: `AiSettingsService.appendMemory` (append a `memory.md`, solo in `AUTO_AND_ADMIN`);
  tool `remember` nel registry (esposto solo se `AUTO_AND_ADMIN`), `specs(autonomy, memoryMode)`.
- Frontend: etichetta "Aggiorno la memoria" per il tool.

Compacting (fatto ora):
- Backend: nuovo `AiMemoryService.maybeCompact(conv, settings, apiKey)`, invocato a **inizio turno**
  in `AiChatService.runLoop`. Stima i token dei messaggi non archiviati (somma `token_count`) +
  summary + un overhead di system; se supera `contextWindowTokens * compactThresholdPct/100`,
  archivia interi turni dal più vecchio **tagliando solo a un confine USER** (l'ultimo turno non
  viene mai archiviato), fino a riportare il contesto attivo a ~metà finestra. I turni archiviati
  vengono trascritti e dati a una chiamata **non-stream** (`openRouter.streamChat(..., tools=null, ...)`)
  che **estende** `ai_conversations.summary`; poi si salva `summary` + `summarized_through` e si
  marcano i messaggi `archived=true`.
- Robustezza: è best-effort e in `try/catch` — se la chiamata di riassunto fallisce, il turno
  prosegue senza perdere messaggi (niente viene archiviato finché il nuovo summary non è salvato).
- Il replay in `buildContext` esclude già gli `archived` e il `summary` è già iniettato nel system prompt.

Decisioni applicate in F5 (compacting):
- Taglio a **confine di turno** (mai a metà di una sequenza `assistant tool_calls → tool`).
- Target post-compacting: contesto attivo ≈ `contextWindowTokens / 2` (sotto la soglia, evita di
  ri-scattare ad ogni messaggio).
- Stima token: euristica `chars/4` (come per i messaggi), invariata rispetto al design (§7).

### Fase 6 — FATTA
File creati/modificati:
- Backend: `OpenRouterClient.listModels` (GET `/models`, chiave opzionale) + record `Model`;
  `extractError` per messaggi d'errore leggibili (parse `{error:{message}}`); `AiSettingsService.listModels`
  (solo ADMIN); endpoint `GET /ai/models` in `AiController`.
- Frontend: `aiApi.listModels`; campo **Modello** in Admin con `<datalist>` popolato dai modelli
  OpenRouter (resta a testo libero, decisione §14.6); stato vuoto Assistente aggiornato (i tool
  esistono già) ed etichette per i tool `delete_*`.
- Placeholder personalità (`{{workspaceName}}`/`{{userName}}`/`{{today}}`) e policy da `tools.md`
  erano **già** implementati in `AiChatService.buildContext` (F2/F3): nessuna modifica necessaria.

### Da fare prima di provare F5/F6
- Rebuild backend (nessuna nuova migration: `AiMemoryService` usa colonne `summary`/`summarized_through`
  già create in `V7`). In una chat lunga, superata la soglia, i turni vecchi vengono riassunti.
- In Admin → Agente AI: il campo Modello mostra ora i suggerimenti da OpenRouter.

### Comandi slash in chat (extra)
Comandi digitabili nell'input dell'Assistente (intercettati prima dell'invio al modello):
- `/help`, `/new [titolo]` — gestiti lato **frontend** (nessuna chiamata al modello).
- `/context`, `/compact`, `/memory`, `/model [slug]`, `/clear` — passano dall'endpoint
  `POST /ai/conversations/{convId}/command` → `AiCommandService`.

Permessi: `/model <slug>` (cambio modello = impostazione chiave) è **solo ADMIN**; `/clear` su una
conversazione **condivisa** è solo ADMIN (privata: il proprietario). Gli altri sono per tutti i membri.
File: backend `AiCommandService`, `AiMemoryService.compactNow`, `AiConversationService.clear`,
`deleteByConversationId` nei repository messaggi/pending; frontend `aiApi.command` + parsing in
`AssistantPage` con resa del risultato come nota (non persistita).

### Fix post-F6 (giugno 2026)
- **Log `AccessDenied` spuri allo stream SSE**: `SecurityConfig` ora permette i dispatch
  `ASYNC`/`FORWARD`/`ERROR` (`dispatcherTypeMatchers(...).permitAll()`). Il completamento dello
  stream SSE genera un dispatch ASYNC che l'`AuthorizationFilter` (Spring Security 6) rivalutava
  senza `SecurityContext`, loggando un errore su risposta già committata. La richiesta originale
  resta autenticata: i dispatch interni non vanno ri-autorizzati.
- **Agente che sbaglia le date (es. eventi non visibili in Calendario)**: `AiChatService.buildContext`
  inietta ora "CONTESTO TEMPORALE" con data/ora correnti `Europe/Rome` e un esempio di formato ISO
  con offset; `{{today}}` usa lo stesso fuso; gli hint `startDate`/`endDate` dei tool mostrano l'offset.
- **Identità "Akari"**: frontend mostra nome `Akari` e avatar 🌸 (chat + sidebar); `DEFAULT_PERSONALITY`
  aggiornata e migration `V9` che applica la persona ai workspace non personalizzati.

## 14. Domande aperte / da decidere in implementazione

1. **Streaming**: SSE (semplice, unidirezionale) vs WebSocket STOMP già presente. Proposta: SSE.
2. **Identità delle azioni**: attribuirle all'utente che chatta (semplice, rispetta i ruoli) vs
   un utente di servizio "AI" dedicato per l'audit. Proposta: utente che chatta, con flag "via AI".
3. **Chat condivisa concorrente**: come gestire due utenti che scrivono insieme (lock turno? coda?).
4. **Cifratura chiave**: AES con secret app vs storage in chiaro su DB fidato. Proposta: AES.
5. **Tokenizer**: euristica char/4 vs libreria reale (jtokkit). Proposta: euristica, poi jtokkit.
6. **Modelli**: dropdown da `/models` di OpenRouter vs campo testo libero. Proposta: testo + lista.
7. **`tools.md` enable/disable**: quanto deve essere "potente" il parsing della sezione Abilitati.

---

## 15. Fix tooling autonomia (giugno 2026)

Problema riscontrato in produzione: Akari non sapeva **dove** collocare task e storie. La causa non era
architetturale (il tool calling su servizi interni è solido) ma di **ergonomia dei tool**: `list_elements`
restituiva una lista piatta da cui il modello doveva ricostruire a mano la gerarchia, e un `create_element`
di un TASK senza `parentId` creava un **task orfano** che non compare nella Kanban. Interventi (in
`AgentToolRegistry`):

- **Nuovo tool `get_board`**: ritorna l'albero `EPICA → STORIA → TASK` con gli id, più `events`,
  `storiesWithoutEpic` e `tasksWithoutStory` (i task orfani che non si vedono in Kanban). È la "mappa"
  che il modello consulta prima di creare/spostare elementi.
- **`list_elements` arricchito**: implementato il filtro `query` (ricerca per titolo, già previsto nel
  §8 ma mai realizzato) e aggiunto `parentTitle` all'output (più leggibile dell'id nudo).
- **Guardrail in `create_element`**: un TASK senza `parentId` non viene più creato orfano; il tool
  risponde con l'elenco delle STORIE disponibili (id+titolo) così l'agente ritenta subito con il
  `parentId` corretto. Se non esistono storie, indica di crearne prima una.

Conclusione: nessun "replanning" dell'architettura; bastava dare all'agente gli strumenti per
**vedere la gerarchia** e **auto-correggersi** sulla collocazione.

---

### Riferimenti nel codice esistente (per l'implementazione)
- Servizi da richiamare nei tool: `ElementService`, `DriveService`, `TagService`, `WorkspaceService`.
- Pattern auth/ruoli: `WorkspaceService.assertRole/getUserRole`, enum `WorkspaceRole`.
- Migrazioni: prossima è `V7__ai_agent.sql` (Flyway, `ddl-auto=validate`).
- Editor markdown riutilizzabile: `components/editor/CodeEditor.tsx` (linguaggio `markdown`).
- Eventi realtime già presenti: `WorkspaceEventPublisher` + WebSocket STOMP (`WebSocketConfig`).
- Admin UI a tab: `pages/AdminPage.tsx` (aggiungere tab "Agente AI").
- Esempio recente di feature full-stack: sistema **API key** (entità+filtro+controller+UI) come modello.
