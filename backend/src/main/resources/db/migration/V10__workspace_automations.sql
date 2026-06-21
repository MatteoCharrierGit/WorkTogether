-- Impostazioni per le automazioni email del workspace
-- Reminder eventi: quanti giorni prima inviare il promemoria (default 1)
ALTER TABLE workspaces ADD COLUMN reminder_days_before INT NOT NULL DEFAULT 1;
ALTER TABLE workspaces ADD COLUMN event_reminders_enabled BOOLEAN NOT NULL DEFAULT TRUE;
-- Recap settimanale (venerdì) e digest del lunedì generati da Akari
ALTER TABLE workspaces ADD COLUMN weekly_recap_enabled BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE workspaces ADD COLUMN monday_digest_enabled BOOLEAN NOT NULL DEFAULT FALSE;
