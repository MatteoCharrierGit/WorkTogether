-- Agente AI: provider multipli (OpenRouter | Anthropic), modello per utente, limiti d'uso, tracciamento consumi.
-- Retro-compatibile: le righe esistenti di ai_settings restano su OPENROUTER con chiave e modello invariati.

-- 1) Provider + chiave/modello Anthropic + limiti predefiniti del workspace.
ALTER TABLE ai_settings ADD COLUMN provider VARCHAR(20) NOT NULL DEFAULT 'OPENROUTER';
ALTER TABLE ai_settings ADD COLUMN anthropic_api_key TEXT;                 -- cifrata (AES-GCM, base64)
ALTER TABLE ai_settings ADD COLUMN anthropic_model VARCHAR(120) NOT NULL DEFAULT 'claude-opus-5-5';
ALTER TABLE ai_settings ADD COLUMN rate_per_minute INT NOT NULL DEFAULT 10;
ALTER TABLE ai_settings ADD COLUMN rate_per_day INT NOT NULL DEFAULT 200;
ALTER TABLE ai_settings ADD COLUMN max_concurrent INT NOT NULL DEFAULT 1;
ALTER TABLE ai_settings ADD COLUMN automation_daily_cap INT NOT NULL DEFAULT 10;
ALTER TABLE ai_settings ADD CONSTRAINT ai_settings_provider_chk CHECK (provider IN ('OPENROUTER', 'ANTHROPIC'));

-- 2) Impostazioni per utente decise dall'admin: modello assegnato (per provider) e override dei limiti.
--    NULL = usa il default del workspace.
CREATE TABLE ai_user_settings (
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    openrouter_model VARCHAR(120),
    anthropic_model VARCHAR(120),
    rate_per_minute INT,
    rate_per_day INT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (workspace_id, user_id)
);
CREATE INDEX idx_ai_user_settings_user ON ai_user_settings(user_id);

-- 3) Consumi giornalieri per utente (user_id NULL = automazioni del workspace).
--    "requests" è anche il contatore del limite giornaliero (sopravvive ai riavvii).
CREATE TABLE ai_usage (
    id BIGSERIAL PRIMARY KEY,
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    day DATE NOT NULL,
    requests INT NOT NULL DEFAULT 0,
    input_tokens BIGINT NOT NULL DEFAULT 0,
    output_tokens BIGINT NOT NULL DEFAULT 0,
    cache_read_tokens BIGINT NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT ai_usage_ws_user_day_uq UNIQUE NULLS NOT DISTINCT (workspace_id, user_id, day)
);
CREATE INDEX idx_ai_usage_ws_day ON ai_usage(workspace_id, day);

-- 4) Contenuto nativo del provider per i messaggi assistant (es. blocchi thinking/tool_use di Anthropic),
--    da ri-inviare invariato durante il loop dei tool. provider_binding identifica provider+modello+prefisso.
ALTER TABLE ai_messages ADD COLUMN provider_content JSONB;
ALTER TABLE ai_messages ADD COLUMN provider_binding VARCHAR(200);
