-- Agente AI: impostazioni, conversazioni, messaggi, azioni in attesa.
-- (In questa fase il backend usa solo ai_settings; le altre tabelle sono predisposte
--  per le fasi successive.)

CREATE TABLE ai_settings (
    workspace_id UUID PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
    enabled BOOLEAN NOT NULL DEFAULT FALSE,
    openrouter_api_key TEXT,                 -- cifrata (AES-GCM, base64)
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

CREATE TABLE ai_conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    scope VARCHAR(10) NOT NULL CHECK (scope IN ('PRIVATE','SHARED')),
    owner_user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    title VARCHAR(255),
    summary TEXT,
    summarized_through UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_ai_conv_ws ON ai_conversations(workspace_id);
CREATE INDEX idx_ai_conv_owner ON ai_conversations(owner_user_id);

CREATE TABLE ai_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
    role VARCHAR(12) NOT NULL CHECK (role IN ('USER','ASSISTANT','TOOL','SYSTEM')),
    content TEXT,
    tool_calls JSONB,
    tool_call_id VARCHAR(80),
    author_user_id UUID REFERENCES users(id),
    token_count INT NOT NULL DEFAULT 0,
    archived BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_ai_msg_conv ON ai_messages(conversation_id, created_at);

CREATE TABLE ai_pending_actions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
    tool_name VARCHAR(80) NOT NULL,
    arguments JSONB NOT NULL,
    status VARCHAR(12) NOT NULL DEFAULT 'PENDING',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
