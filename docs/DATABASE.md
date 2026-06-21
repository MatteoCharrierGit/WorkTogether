# Modello dati e migration — WorkTogether

> Documentazione v1.0 · PostgreSQL · schema gestito da **Flyway** (`backend/src/main/resources/db/migration`).
> Hibernate è in `ddl-auto: validate`: non modifica lo schema, lo valida soltanto.

## 1. Tabelle principali

### Identità e workspace
- **users** — `id, email (unique), display_name, password_hash, must_reset_password,
  is_system_admin, avatar, onboarding_completed, created_at, updated_at`.
- **workspaces** — `id, name, description, created_by, avatar` + impostazioni card Kanban
  (`card_show_tags/assignees/due_date`) e automazioni email
  (`reminder_days_before, event_reminders_enabled, weekly_recap_enabled, monday_digest_enabled`).
- **workspace_members** — appartenenza + ruolo `ADMIN|COLLABORATORE|GUEST`, unico per `(workspace, user)`.
- **refresh_tokens** — token di refresh persistiti (`token unique, expires_at`).

### Lavoro (Kanban / Roadmap / Calendario)
- **elements** — entità centrale: `type (EPICA|STORIA|TASK|EVENTO)`, `status
  (DA_FARE|IN_CORSO|COMPLETATO|ARCHIVIATO)`, `title`, `body (jsonb)`, `parent_id` (gerarchia
  *Epica→Storia→Task*), `start_date/end_date`, `all_day`, `position`, `version` (optimistic lock).
- **element_tags** — M:N elemento ↔ tag. **element_assignees** — M:N elemento ↔ utente.
- **tags** — tag per workspace (`name unique per workspace, color`).

### Drive e allegati
- **folders** — cartelle annidabili (`parent_id` self-ref).
- **drive_files** — file (`folder_id` NULL = radice), con **lock** di modifica (`locked_by, locked_at`).
- **attachments** — file allegati a un elemento.

> I file/allegati sono salvati su filesystem (`UPLOAD_DIR`); in DB stanno i metadati
> (`stored_name, content_type, size_bytes, uploaded_by`).

### Integrazioni
- **api_keys** — chiavi `wt_…` per servizi esterni: solo **hash SHA-256** (`key_hash unique`),
  `key_prefix`, `scopes`, `expires_at`, `last_used_at`, `revoked`.

### AI "Akari"
- **ai_settings** (PK = workspace) — `enabled`, `openrouter_api_key` (cifrata AES-GCM/base64),
  `model`, `temperature`, `max_tokens`, `context_window_tokens`, `compact_threshold_pct`,
  `autonomy`, `memory_mode`, `max_tool_iterations`, `personality_md`, `memory_md`, `tools_md`.
- **ai_conversations** — `scope (PRIVATE|SHARED)`, `owner_user_id`, `title`, `summary`,
  `summarized_through`.
- **ai_messages** — `role (USER|ASSISTANT|TOOL|SYSTEM)`, `content`, `tool_calls (jsonb)`,
  `tool_call_id`, `token_count`, `archived`.
- **ai_pending_actions** — azioni del modello in attesa di conferma (`tool_name, arguments,
  status, tool_call_id`).

### Chat / stanze / voce (Discord-like)
- **channels** — astrazione unica `type (DM|GROUP|ROOM)`, `name` (NULL per i DM), `description`,
  `is_private`, **`voice_enabled`**, **`screen_share_enabled`**, `created_by`.
- **channel_members** — membri del canale + `last_read_at` (da cui si ricavano i non-letti),
  unico per `(channel, user)`.
- **messages** — `channel_id, author_id, content, created_at, edited_at`.

> La presenza online/in-chiamata **non è su DB**: è un registro in-memory in `PresenceService`.

## 2. Storico migration (V1 → V15)

| Versione | Contenuto |
|----------|-----------|
| **V1** `init` | users, workspaces, workspace_members, tags, elements (+ element_tags/assignees), refresh_tokens, indici. Estensione `pgcrypto`. |
| **V2** `attachments` | tabella `attachments` (file sugli elementi). |
| **V3** `profile_and_drive` | `users.avatar`; drive: `folders` + `drive_files`. |
| **V4** `element_all_day` | `elements.all_day` (eventi a giornata intera). |
| **V5** `workspace_settings_and_file_lock` | `workspaces.avatar` + flag card Kanban; lock file (`drive_files.locked_by/at`). |
| **V6** `api_keys` | tabella `api_keys` (hash SHA-256, scope, scadenza, revoca). |
| **V7** `ai_agent` | `ai_settings`, `ai_conversations`, `ai_messages`, `ai_pending_actions`. |
| **V8** `ai_pending_action_toolcall` | `ai_pending_actions.tool_call_id`. |
| **V9** `ai_akari_personality` | imposta la personalità di default "Akari" dove non personalizzata. |
| **V10** `workspace_automations` | flag automazioni email (reminder, recap, digest). |
| **V11** `user_onboarding` | `users.onboarding_completed` (tour di benvenuto). |
| **V12** `channels` | `channels`, `channel_members`, `messages` (incl. flag voce/screen share). |
| **V13** `drive_assets_editable` | `drive_files.editable_by_all` (default TRUE): permesso per-file modificabile/sola lettura. |
| **V14** `user_token_version` | `users.token_version` (default 0): versione di sessione per la policy a sessione singola. |
| **V15** `folder_editable_by_all` | `folders.editable_by_all` (default TRUE): sola lettura cartella, propagata in cascata. |

## 3. Note operative

- **Backup**: tutto è in Postgres (volume `postgres_data`); i media voce/screen share **non vengono
  registrati**, quindi non c'è storage extra. I file/allegati stanno nel volume di `UPLOAD_DIR`.
- **Nuove migration**: la prossima parte da **V16**. Mantenere `ddl-auto: validate` ⇒ ogni cambio di
  schema passa da una migration Flyway.
- Verifica all'avvio: nei log del backend Flyway elenca le versioni applicate (utile dopo un deploy).
