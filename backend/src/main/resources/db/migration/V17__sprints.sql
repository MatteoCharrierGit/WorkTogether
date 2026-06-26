-- Gestione Sprint: ciclo di vita PLANNED → ACTIVE → CLOSED, avvio/chiusura manuali.
-- I task del workspace (elements di tipo TASK) si collegano alla sprint via elements.sprint_id.
-- La chat di sprint riusa il modello channels con il nuovo type 'SPRINT'.

CREATE TABLE sprints (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    goal TEXT,                                   -- Sprint Goal
    start_date DATE,                             -- data di inizio PREVISTA (planning)
    end_date DATE,                               -- data di fine PREVISTA (planning)
    actual_start_at TIMESTAMPTZ,                 -- avvio manuale effettivo
    actual_end_at TIMESTAMPTZ,                   -- chiusura manuale effettiva
    status VARCHAR(10) NOT NULL DEFAULT 'PLANNED' CHECK (status IN ('PLANNED','ACTIVE','CLOSED')),
    retrospective_md TEXT,                       -- note di retrospettiva inserite alla chiusura
    position INT NOT NULL DEFAULT 0,             -- ordinamento delle sprint pianificate
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    version INT NOT NULL DEFAULT 0
);
CREATE INDEX idx_sprints_ws ON sprints(workspace_id);

-- Al massimo UNA sprint attiva per workspace (avvio rigorosamente manuale e singolo).
CREATE UNIQUE INDEX uq_sprint_active ON sprints(workspace_id) WHERE status = 'ACTIVE';

-- Collegamento Task↔Sprint + dato di completamento (per la timeline) + flag bloccante.
ALTER TABLE elements
    ADD COLUMN sprint_id    UUID REFERENCES sprints(id) ON DELETE SET NULL,
    ADD COLUMN completed_at TIMESTAMPTZ,
    ADD COLUMN is_blocked   BOOLEAN NOT NULL DEFAULT FALSE;
CREATE INDEX idx_elements_sprint ON elements(sprint_id);

-- Backfill: per gli elementi già completati, usa updated_at come momento di completamento.
UPDATE elements SET completed_at = updated_at WHERE status = 'COMPLETATO';

-- Chat di sprint: nuovo tipo di canale, collegato alla sprint.
ALTER TABLE channels ADD COLUMN sprint_id UUID REFERENCES sprints(id) ON DELETE CASCADE;
ALTER TABLE channels DROP CONSTRAINT channels_type_check;
ALTER TABLE channels ADD CONSTRAINT channels_type_check CHECK (type IN ('DM','GROUP','ROOM','SPRINT'));
