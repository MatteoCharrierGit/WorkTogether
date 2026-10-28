# Akari — provider, modelli per utente, limiti e consumi

Complemento di [AI_AGENT_DESIGN.md](AI_AGENT_DESIGN.md). Migrazione: `V20__ai_providers_limits.sql`.

## Provider LLM

L'agente (chat con tool calling, conferme, compacting, automazioni, bozze email) passa da un'astrazione unica:

| Classe | Ruolo |
| --- | --- |
| `service/ai/LlmProvider` | interfaccia: `chat(apiKey, Llm.Request, onToken)` in streaming con tool, `listModels`, `testKey`, `binding` |
| `service/ai/Llm` | tipi normalizzati: `Message` (USER/ASSISTANT/TOOL + `nativeContent`), `ToolCall`, `Request` (system stabile + variabile, tools in formato OpenAI), `Result` (testo, tool call, `Usage`, `StopReason`) |
| `service/OpenRouterClient` | provider OpenRouter (API OpenAI-compatibile, `stream_options.include_usage`) |
| `service/ai/AnthropicClient` | provider Anthropic Messages API, HTTP puro (`java.net.http`) |
| `service/ai/AiGateway` | risolve provider + chiave + **modello effettivo** per (workspace, utente), applica i limiti, registra i consumi |
| `service/ai/AiModelCatalog` | elenco modelli dal provider (cache 10 min) con fallback statico |

Il workspace ha un **provider attivo** (`ai_settings.provider`: `OPENROUTER` | `ANTHROPIC`), una chiave per provider
(cifrate con `AiKeyCipher`: `openrouter_api_key`, `anthropic_api_key`) e un modello predefinito per provider
(`model` per OpenRouter, `anthropic_model` per Anthropic). Le righe preesistenti restano su OpenRouter.

### Dettagli Anthropic

- `POST {ANTHROPIC_BASE_URL}/v1/messages`, header `x-api-key`, `anthropic-version` (default `2023-06-01`).
- System top-level in due blocchi: parte **stabile** (persona, regole, policy tool, memoria) con `cache_control: ephemeral`
  e parte **variabile** (data/ora, interlocutore, riassunto). Tool convertiti in `{name, description, input_schema}`
  con breakpoint di cache sull'ultimo; auto-caching top-level per il loop dei tool. Verifica: `usage.cache_read_input_tokens`
  (salvato in `ai_usage.cache_read_tokens`).
- Streaming SSE: `message_start`, `content_block_start/delta/stop` (`text_delta`, `input_json_delta`, `thinking_delta`,
  `signature_delta`), `message_delta` (stop_reason, usage), `message_stop`, `error`.
- Niente `temperature` (rifiutata dai modelli Claude recenti) né `thinking` esplicito: i modelli attuali usano il
  thinking adattivo. `max_tokens` minimo 16000 perché il thinking consuma output.
- **Replay del thinking**: la risposta dell'assistant (blocchi `thinking` firmati + `text` + `tool_use`) è salvata in
  `ai_messages.provider_content` con un `provider_binding` (hash di modello + system + tools). Nel loop dei tool viene
  ri-inviata invariata solo per gli ultimi messaggi del turno con lo stesso binding (il system è congelato per turno);
  altrimenti si usa la forma testo + tool_use (i thinking vecchi si omettono "dalla testa", come richiesto dall'API).
- `stop_reason`: `tool_use` → esegue i tool; `refusal` → avviso, nessun tool; `max_tokens` → avviso, tool non eseguiti.
- `tool_use` rimasti senza risultato (azione in attesa poi ignorata) ricevono un `tool_result` sintetico.
- Fallback lato server per i rifiuti dei classificatori (`fallbacks: "default"`, beta `server-side-fallback-2026-07-01`)
  sui modelli che lo supportano (Opus 5.x, Fable 5.1, Sonnet 5.5). Disattivabile con `ANTHROPIC_FALLBACKS=false`.

### Configurazione

| Variabile | Default | Note |
| --- | --- | --- |
| `ANTHROPIC_BASE_URL` | `https://api.anthropic.com` | puntare a uno stub solo in test |
| `ANTHROPIC_VERSION` | `2023-06-01` | header `anthropic-version` |
| `ANTHROPIC_FALLBACKS` | `true` | fallback lato server sui rifiuti |
| `OPENROUTER_BASE_URL` | `https://openrouter.ai/api/v1` | invariato |

La chiave **non** si configura via env: Admin → Agente AI → *Provider e connessione* (Provider = Anthropic, incolla la
chiave `sk-ant-…`, *Testa connessione*, scegli il modello, Salva).

## Modello per utente (deciso dall'admin)

Tabella `ai_user_settings(workspace_id, user_id, openrouter_model, anthropic_model, rate_per_minute, rate_per_day)`.
Risoluzione: modello assegnato all'utente per il provider attivo → modello predefinito del workspace.
Il client non invia mai il modello: chat, conferme, comandi e bozze lo risolvono lato server (`AiGateway`). `/model`
con argomento resta riservato agli admin e cambia solo il predefinito del workspace. In Assistant l'utente vede
"Modello: X (assegnato dall'amministratore)" in sola lettura.

## Limiti d'uso

Default del workspace (`ai_settings`), sovrascrivibili per utente:

| Limite | Default | Implementazione |
| --- | --- | --- |
| richieste/minuto | 10 | finestra scorrevole in memoria (`AiRateLimiter`, ConcurrentHashMap) |
| richieste/giorno | 200 | contatore su DB `ai_usage.requests` (fuso Europe/Rome, sopravvive ai riavvii) |
| generazioni concorrenti | 1 | contatore in memoria, rilasciato a fine stream |
| automazioni IA/giorno (per workspace) | 10 | `ai_usage` con `user_id NULL` |

Una "richiesta" = un messaggio in chat, una conferma/annullamento, `/compact`, una bozza email (le iterazioni tool dello
stesso turno non contano). I comandi leggeri (`/context`, `/memory`, `/model`) consumano solo la finestra al minuto
(soglia doppia). Oltre il limite: **HTTP 429** con header `Retry-After` e corpo
`{ "error": "<messaggio in italiano>", "code": "AI_RATE_MINUTE|AI_RATE_DAY|AI_CONCURRENT", "retryAfter": <secondi> }`.
Pool di generazione limitato (16 thread, coda 100): se saturo **503** `AI_BUSY` con `Retry-After: 10`.

## Endpoint (`/api/workspaces/{wsId}/ai`)

| Metodo | Path | Chi | Risposta |
| --- | --- | --- | --- |
| GET | `/settings`, PUT `/settings` | admin | + `provider`, `anthropicApiKeySet/Preview`, `anthropicModel`, `ratePerMinute`, `ratePerDay`, `maxConcurrent`, `automationDailyCap` (PUT accetta anche `anthropicApiKey`) |
| GET | `/models?provider=` | admin | `{provider, live, error, models:[{id,name}]}` (fallback statico se `live=false`) |
| POST | `/test` `{provider?, apiKey?}` | admin | `{ok, message}` |
| GET | `/me` | membro | `{enabled, provider, model, modelSource: USER\|WORKSPACE, admin, limits, usageToday, inFlight}` |
| GET | `/users?days=30` | admin | membri con modello assegnato, override, limiti effettivi, consumo oggi/periodo |
| PUT | `/users/{userId}` | admin | `{openrouterModel, anthropicModel, ratePerMinute, ratePerDay}` (null = default) |
| GET | `/usage?days=30` | admin | report consumi (vedi sotto) |

`GET /usage` (pensato anche per la dashboard):

```json
{
  "from": "2026-09-29", "to": "2026-10-28", "days": 30,
  "totalToday":  {"requests": 8, "inputTokens": 7840, "outputTokens": 189, "cacheReadTokens": 6300},
  "totalPeriod": {"requests": 8, "inputTokens": 7840, "outputTokens": 189, "cacheReadTokens": 6300},
  "users": [{"userId": "…", "displayName": "Luca Ferrari", "today": {…}, "period": {…}}],
  "automationsToday": {…}, "automationsPeriod": {…},
  "daily": [{"day": "2026-10-28", "requests": 8, "inputTokens": 7840, "outputTokens": 189}]
}
```

`inputTokens` include i token letti/scritti in cache; `cacheReadTokens` è la quota letta dalla cache.
Frontend: `aiAdminApi.usage(wsId, days)` (query key `['ai-usage', wsId, days]`).

## Transazioni e thread

- `AiChatService`: `ThreadPoolExecutor` limitato, chiuso con `@PreDestroy`; i permessi dei limiti si rilasciano a fine task.
- `AutomationService`: lettura dati in `TransactionTemplate` read-only breve, chiamata al modello e invio email senza
  transazione, consumi registrati in transazioni brevi separate (`AiUsageService`).

## Test locale senza chiave reale

Uno stub HTTP che imita Anthropic/OpenRouter (es. `python3 stub.py 8765`) e un backend avviato con
`ANTHROPIC_BASE_URL=http://127.0.0.1:8765 OPENROUTER_BASE_URL=http://127.0.0.1:8765/or`; chiave di prova impostata da Admin.
Non lasciare questi URL nei default.
