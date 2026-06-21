-- Permesso per-file: se un file del Drive è modificabile da TUTTI i membri (non guest) oppure è in
-- sola lettura per chi non è il proprietario/admin. Default TRUE = drive collaborativo; il proprietario
-- o un admin può marcare un singolo file come "sola lettura".
ALTER TABLE drive_files
    ADD COLUMN editable_by_all BOOLEAN NOT NULL DEFAULT TRUE;
