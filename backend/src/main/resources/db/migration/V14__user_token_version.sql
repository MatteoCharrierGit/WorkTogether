-- Sessione singola: versione di sessione per-utente inclusa negli access token (claim "sv").
-- A ogni login la versione viene incrementata, invalidando immediatamente i token (e quindi le
-- sessioni) emessi in precedenza su altri dispositivi/browser.
ALTER TABLE users
    ADD COLUMN token_version INT NOT NULL DEFAULT 0;
