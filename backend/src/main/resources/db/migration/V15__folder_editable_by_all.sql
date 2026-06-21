-- Permesso per-cartella: come per i file, una cartella può essere "sola lettura". Marcandola tale,
-- il flag viene propagato in cascata a tutti i file e sottocartelle contenuti (vedi DriveService).
-- Le nuove aggiunte ereditano il flag della cartella che le contiene.
ALTER TABLE folders
    ADD COLUMN editable_by_all BOOLEAN NOT NULL DEFAULT TRUE;
