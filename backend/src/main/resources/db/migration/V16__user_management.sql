-- Gestione utenti: username (= display_name) come handle di login, account creati
-- con il solo username (email/password impostate in onboarding), reset password via
-- OTP email e inviti al workspace con link via email.

-- L'email e la password ora possono mancare: un utente creato dall'admin col solo
-- username non ne ha finché non completa l'onboarding (verifica email + nuova password).
ALTER TABLE users ALTER COLUMN email DROP NOT NULL;
ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;

-- display_name diventa l'handle di login (oltre all'email) => deve essere univoco.
-- Deduplica gli eventuali nomi ripetuti PRIMA di aggiungere il vincolo: si mantiene intatto
-- l'utente più vecchio per ciascun nome, agli altri si aggiunge un suffisso con l'id (univoco).
WITH dups AS (
    SELECT id,
           row_number() OVER (PARTITION BY display_name ORDER BY created_at, id) AS rn
    FROM users
)
UPDATE users u
SET display_name = u.display_name || '-' || left(u.id::text, 8)
FROM dups
WHERE u.id = dups.id AND dups.rn > 1;

ALTER TABLE users ADD CONSTRAINT uq_users_display_name UNIQUE (display_name);

-- Codici monouso: OTP a 6 cifre per reset password e per la verifica email in
-- onboarding, oltre al token di sessione onboarding (purpose ONBOARDING_SESSION).
CREATE TABLE verification_codes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    purpose VARCHAR(30) NOT NULL,          -- PASSWORD_RESET | ONBOARDING_EMAIL | ONBOARDING_SESSION
    code_hash VARCHAR(255) NOT NULL,       -- bcrypt dell'OTP (o token opaco per la sessione onboarding)
    payload JSONB,                         -- onboarding email: {"email": "...", "passwordHash": "..."}
    expires_at TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ,
    attempts INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_verification_user_purpose ON verification_codes(user_id, purpose);

-- Inviti a un workspace: link con token inviato via email all'utente bersaglio.
CREATE TABLE workspace_invitations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    invited_user_id UUID REFERENCES users(id) ON DELETE CASCADE,  -- utente risolto (può essere null)
    email VARCHAR(255) NOT NULL,           -- indirizzo a cui è stato inviato il link
    role VARCHAR(20) NOT NULL CHECK (role IN ('ADMIN', 'COLLABORATORE', 'GUEST')),
    token VARCHAR(255) NOT NULL UNIQUE,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'ACCEPTED', 'REVOKED', 'EXPIRED')),
    invited_by UUID REFERENCES users(id) ON DELETE SET NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    accepted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_ws_invitations_ws ON workspace_invitations(workspace_id);
CREATE INDEX idx_ws_invitations_user ON workspace_invitations(invited_user_id);
