-- Funzioni "Discord-like": modello dati unificato Channel (DM / GROUP / ROOM) + messaggi.
-- I flag voice_enabled / screen_share_enabled sono predisposti per la fase media (LiveKit)
-- ma restano FALSE in questa fase (solo messaggistica testuale).

CREATE TABLE channels (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    type VARCHAR(10) NOT NULL CHECK (type IN ('DM','GROUP','ROOM')),
    name VARCHAR(255),                       -- NULL per i DM (nome derivato dall'altro utente)
    description TEXT,
    is_private BOOLEAN NOT NULL DEFAULT FALSE, -- per le ROOM: privata = lista membri esplicita
    voice_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    screen_share_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_channels_ws ON channels(workspace_id);

CREATE TABLE channel_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    channel_id UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_read_at TIMESTAMPTZ,
    CONSTRAINT uq_channel_member UNIQUE (channel_id, user_id)
);
CREATE INDEX idx_channel_members_user ON channel_members(user_id);

CREATE TABLE messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    channel_id UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    author_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    edited_at TIMESTAMPTZ
);
CREATE INDEX idx_messages_channel ON messages(channel_id, created_at);
