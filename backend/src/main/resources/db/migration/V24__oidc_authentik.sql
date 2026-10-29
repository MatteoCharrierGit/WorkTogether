-- Login tramite Authentik (OIDC): l'app non gestisce più password, refresh token, OTP né
-- la "versione di sessione". L'utente interno si identifica con il claim "sub" del token.

ALTER TABLE users ADD COLUMN oidc_subject VARCHAR(255);
ALTER TABLE users ADD CONSTRAINT uq_users_oidc_subject UNIQUE (oidc_subject);

-- Sessioni e codici monouso del vecchio login: non hanno più senso con Authentik.
DROP TABLE IF EXISTS refresh_tokens;
DROP TABLE IF EXISTS verification_codes;

-- Colonne legacy non più mappate (password_hash, must_reset_password, token_version): restano
-- per consentire un eventuale rollback, ma i nuovi utenti non le valorizzano. Tutte hanno già un
-- default o sono nullable; must_reset_password ora vale false di default.
ALTER TABLE users ALTER COLUMN must_reset_password SET DEFAULT FALSE;
