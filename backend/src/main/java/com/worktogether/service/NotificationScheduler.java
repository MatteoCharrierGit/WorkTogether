package com.worktogether.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/** Job periodici delle notifiche in-app: promemoria di scadenza (orario) e pulizia (giornaliera). */
@Slf4j
@Component
@RequiredArgsConstructor
public class NotificationScheduler {

    static final int RETENTION_DAYS = 60;

    private final NotificationService notificationService;

    // Ogni ora (al minuto 7, fuori dai picchi dei job allo scoccare dell'ora).
    @Scheduled(cron = "0 7 * * * *", zone = "Europe/Rome")
    public void dueReminders() {
        try {
            int sent = notificationService.runDueReminders();
            if (sent > 0) log.info("Promemoria di scadenza inviati: {}", sent);
        } catch (Exception e) {
            log.warn("Job promemoria di scadenza fallito: {}", e.getMessage());
        }
    }

    @Scheduled(cron = "0 23 3 * * *", zone = "Europe/Rome")
    public void cleanup() {
        try {
            int removed = notificationService.cleanupOlderThan(RETENTION_DAYS);
            if (removed > 0) log.info("Notifiche eliminate (>{} giorni): {}", RETENTION_DAYS, removed);
        } catch (Exception e) {
            log.warn("Pulizia notifiche fallita: {}", e.getMessage());
        }
    }
}
