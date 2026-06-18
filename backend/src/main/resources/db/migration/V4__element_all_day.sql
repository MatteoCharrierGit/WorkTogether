-- Flag "giornata intera" per gli eventi (un solo giorno, senza orario/intervallo)
ALTER TABLE elements ADD COLUMN all_day BOOLEAN NOT NULL DEFAULT FALSE;
