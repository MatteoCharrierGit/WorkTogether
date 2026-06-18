-- Impostazioni workspace (avatar + campi visibili nelle card Kanban)
ALTER TABLE workspaces ADD COLUMN avatar TEXT;
ALTER TABLE workspaces ADD COLUMN card_show_tags BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE workspaces ADD COLUMN card_show_assignees BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE workspaces ADD COLUMN card_show_due_date BOOLEAN NOT NULL DEFAULT TRUE;

-- Lock di modifica sui file del drive (anti-conflitto)
ALTER TABLE drive_files ADD COLUMN locked_by UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE drive_files ADD COLUMN locked_at TIMESTAMPTZ;
