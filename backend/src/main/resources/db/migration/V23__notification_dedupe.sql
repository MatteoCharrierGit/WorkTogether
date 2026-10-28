-- Deduplica dei promemoria di scadenza imposta dal DB (sicura anche con più istanze/scheduler concorrenti).
-- reminder_day = giorno (Europe/Rome) a cui si riferisce il promemoria:
--   DUE_SOON → giorno della scadenza (un promemoria per scadenza; se la data si sposta riparte),
--   OVERDUE  → giorno di invio (al massimo uno al giorno per elemento e utente).
-- Le altre notifiche lasciano reminder_day NULL e non sono vincolate.
ALTER TABLE notifications ADD COLUMN reminder_day DATE;

-- Backfill dei promemoria esistenti: solo la riga più vecchia per chiave, così l'indice unico
-- si crea anche se in passato sono stati inviati duplicati.
UPDATE notifications n SET reminder_day = k.day
FROM (
    SELECT id, day,
           ROW_NUMBER() OVER (PARTITION BY user_id, element_id, type, day ORDER BY created_at) AS rn
    FROM (
        SELECT n2.id, n2.user_id, n2.element_id, n2.type, n2.created_at,
               CASE WHEN n2.type = 'OVERDUE' THEN (n2.created_at AT TIME ZONE 'Europe/Rome')::date
                    ELSE (e.end_date AT TIME ZONE 'Europe/Rome')::date END AS day
        FROM notifications n2
        JOIN elements e ON e.id = n2.element_id
        WHERE n2.type IN ('DUE_SOON', 'OVERDUE') AND e.end_date IS NOT NULL
    ) x
) k
WHERE k.id = n.id AND k.rn = 1;

CREATE UNIQUE INDEX uq_notifications_reminder
    ON notifications(user_id, element_id, type, reminder_day)
    WHERE reminder_day IS NOT NULL;
