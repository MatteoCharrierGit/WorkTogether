-- Pacchetto "Avatar, sicurezza WS e modalità nascosta".

-- 1) Modalità invisibile per gli ADMIN: per ogni membership, un flag che nasconde l'utente
--    (liste membri, presenza, stanze, digitazione) agli altri utenti non-admin del workspace.
ALTER TABLE workspace_members ADD COLUMN hidden BOOLEAN NOT NULL DEFAULT FALSE;

-- 2) Avatar fuori dai JSON: i byte dell'immagine vivono in una tabella dedicata e vengono
--    serviti da GET /api/users/{id}/avatar; i DTO espongono solo un URL versionato
--    (/api/users/{id}/avatar?v=<avatar_version>). avatar_version NULL = nessuna foto.
CREATE TABLE user_avatars (
    user_id      UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    content_type VARCHAR(100) NOT NULL,
    data         BYTEA NOT NULL,
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE users ADD COLUMN avatar_version INTEGER;

-- Conversione dei data URL esistenti (users.avatar, "data:image/jpeg;base64,...") in byte.
-- Riga per riga con gestione dell'errore: un valore malformato non blocca la migrazione e resta
-- intatto nella vecchia colonna (non più letta dall'applicazione). Solo formati raster sicuri
-- (niente SVG: l'endpoint dell'avatar è pubblico e same-origin).
DO $$
DECLARE
    r RECORD;
    ct TEXT;
BEGIN
    FOR r IN SELECT id, avatar FROM users WHERE avatar LIKE 'data:%;base64,%' LOOP
        BEGIN
            ct := lower(substring(r.avatar FROM 6 FOR position(';' IN r.avatar) - 6));
            IF ct NOT IN ('image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp') THEN
                CONTINUE;
            END IF;
            IF ct = 'image/jpg' THEN ct := 'image/jpeg'; END IF;
            INSERT INTO user_avatars (user_id, content_type, data)
            VALUES (r.id, ct, decode(substring(r.avatar FROM position(',' IN r.avatar) + 1), 'base64'));
            UPDATE users SET avatar_version = 1, avatar = NULL WHERE id = r.id;
        EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE 'Avatar utente % non convertito: %', r.id, SQLERRM;
        END;
    END LOOP;
END $$;
