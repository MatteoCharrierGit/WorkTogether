-- Flag per il tour di benvenuto (mostrato solo al primo accesso assoluto).
ALTER TABLE users ADD COLUMN onboarding_completed BOOLEAN NOT NULL DEFAULT FALSE;
-- Gli utenti già esistenti hanno di fatto già "visto" l'app: non mostrare loro il tour.
UPDATE users SET onboarding_completed = TRUE;
