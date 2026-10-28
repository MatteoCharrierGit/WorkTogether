-- Pacchetto "Notifiche e priorità".

-- 1) Priorità degli elementi (task e storie). NONE = nessuna priorità impostata.
ALTER TABLE elements
    ADD COLUMN priority VARCHAR(10) NOT NULL DEFAULT 'NONE'
        CHECK (priority IN ('NONE','LOW','MEDIUM','HIGH','URGENT'));

-- 2) Notifiche in-app per utente (destinatario = user_id).
CREATE TABLE notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type VARCHAR(30) NOT NULL,
    title VARCHAR(500) NOT NULL,
    body TEXT,
    link VARCHAR(1000),                          -- path frontend da aprire al click
    actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
    element_id UUID REFERENCES elements(id) ON DELETE CASCADE,
    read_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- Lista/contatore per utente (non lette prima, più recenti prima).
CREATE INDEX idx_notifications_user_read_created ON notifications(user_id, read_at, created_at DESC);
-- Deduplica dei promemoria di scadenza (DUE_SOON/OVERDUE per elemento).
CREATE INDEX idx_notifications_element_type ON notifications(element_id, type, created_at) WHERE element_id IS NOT NULL;
CREATE INDEX idx_notifications_created ON notifications(created_at);

-- 3) Preferenze per tipo di notifica in-app (riga assente = abilitato).
CREATE TABLE notification_preferences (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type VARCHAR(30) NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    PRIMARY KEY (user_id, type)
);
