-- Toggle admin per la visibilità della sezione Sprint nel workspace.
-- Default FALSE: la pagina Sprint è nascosta finché un admin non la attiva (Admin → Impostazioni).
ALTER TABLE workspaces
    ADD COLUMN sprint_enabled BOOLEAN NOT NULL DEFAULT FALSE;
