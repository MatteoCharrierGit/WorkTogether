package com.worktogether.service.ai;

import com.worktogether.domain.entity.AiSettings;
import com.worktogether.domain.entity.AiUserSettings;
import lombok.RequiredArgsConstructor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.time.Duration;
import java.time.ZonedDateTime;
import java.util.ArrayDeque;
import java.util.Deque;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Limiti d'uso dell'agente per utente (per workspace):
 * <ul>
 *   <li>richieste al minuto: finestra scorrevole in memoria (ConcurrentHashMap di timestamp);</li>
 *   <li>generazioni concorrenti: contatore in memoria, rilasciato a fine generazione;</li>
 *   <li>richieste al giorno: contatore su DB (ai_usage.requests), sopravvive ai riavvii.</li>
 * </ul>
 * Le automazioni hanno un tetto giornaliero per workspace separato ({@link #tryAcquireAutomation}).
 */
@Component
@RequiredArgsConstructor
public class AiRateLimiter {

    private static final Logger log = LoggerFactory.getLogger(AiRateLimiter.class);
    private static final long WINDOW_MS = 60_000;

    private final AiUsageService usageService;

    private final Map<String, Deque<Long>> minuteWindows = new ConcurrentHashMap<>();
    private final Map<String, AtomicInteger> inFlight = new ConcurrentHashMap<>();

    /** Limiti effettivi per un utente (override admin → default workspace), già normalizzati. */
    public record Limits(int perMinute, int perDay, int maxConcurrent) {}

    public static Limits limitsFor(AiSettings s, AiUserSettings override) {
        int perMinute = override != null && override.getRatePerMinute() != null ? override.getRatePerMinute() : s.getRatePerMinute();
        int perDay = override != null && override.getRatePerDay() != null ? override.getRatePerDay() : s.getRatePerDay();
        return new Limits(clamp(perMinute, 1, 600), clamp(perDay, 1, 100_000), clamp(s.getMaxConcurrent(), 1, 10));
    }

    /** Permesso per una generazione: va chiuso a fine generazione (idempotente). */
    public final class Permit implements AutoCloseable {
        private final String key;
        private final AtomicBoolean released = new AtomicBoolean(false);
        private Permit(String key) { this.key = key; }
        @Override public void close() {
            if (released.compareAndSet(false, true)) {
                AtomicInteger c = inFlight.get(key);
                if (c != null) c.updateAndGet(v -> Math.max(0, v - 1));
            }
        }
    }

    /**
     * Acquisisce un permesso per una generazione (chat, conferma, /compact, bozza email...).
     * Controlla minuto → concorrenza → giorno; lancia {@link AiRateLimitException} (429) se un limite è superato.
     */
    public Permit acquire(UUID workspaceId, UUID userId, Limits limits) {
        String key = workspaceId + ":" + userId;
        long now = System.currentTimeMillis();

        Deque<Long> window = minuteWindows.computeIfAbsent(key, k -> new ArrayDeque<>());
        synchronized (window) {
            prune(window, now);
            if (window.size() >= limits.perMinute()) {
                long retry = (WINDOW_MS - (now - window.peekFirst())) / 1000 + 1;
                throw new AiRateLimitException(HttpStatus.TOO_MANY_REQUESTS, "AI_RATE_MINUTE",
                        "Hai raggiunto il limite di " + limits.perMinute() + " richieste al minuto ad Akari. "
                                + "Riprova tra " + retry + " secondi.", retry);
            }
            window.addLast(now); // prenotato; rimosso se un controllo successivo fallisce
        }

        AtomicInteger counter = inFlight.computeIfAbsent(key, k -> new AtomicInteger());
        if (counter.incrementAndGet() > limits.maxConcurrent()) {
            counter.decrementAndGet();
            unreserve(window, now);
            throw new AiRateLimitException(HttpStatus.TOO_MANY_REQUESTS, "AI_CONCURRENT",
                    limits.maxConcurrent() == 1
                            ? "Akari sta già generando una risposta per te: attendi che finisca prima di inviare un'altra richiesta."
                            : "Hai già " + limits.maxConcurrent() + " generazioni in corso con Akari: attendi che terminino.",
                    3);
        }

        int today;
        try {
            today = usageService.incrementRequests(workspaceId, userId);
        } catch (RuntimeException e) {
            counter.decrementAndGet();
            unreserve(window, now);
            throw e;
        }
        if (today > limits.perDay()) {
            try { usageService.decrementRequests(workspaceId, userId); } catch (RuntimeException ignored) { /* best-effort */ }
            counter.decrementAndGet();
            unreserve(window, now);
            throw new AiRateLimitException(HttpStatus.TOO_MANY_REQUESTS, "AI_RATE_DAY",
                    "Hai raggiunto il limite giornaliero di " + limits.perDay() + " richieste ad Akari. "
                            + "Il contatore si azzera a mezzanotte.", secondsToMidnight());
        }
        return new Permit(key);
    }

    /**
     * Solo controllo della finestra al minuto (comandi leggeri che non chiamano il modello,
     * es. /context, /memory): consuma uno slot del minuto ma non del giorno.
     */
    public void checkMinute(UUID workspaceId, UUID userId, Limits limits) {
        String key = workspaceId + ":" + userId;
        long now = System.currentTimeMillis();
        Deque<Long> window = minuteWindows.computeIfAbsent(key, k -> new ArrayDeque<>());
        synchronized (window) {
            prune(window, now);
            // Margine doppio per i comandi leggeri: bloccano solo lo spam evidente.
            if (window.size() >= limits.perMinute() * 2) {
                long retry = (WINDOW_MS - (now - window.peekFirst())) / 1000 + 1;
                throw new AiRateLimitException(HttpStatus.TOO_MANY_REQUESTS, "AI_RATE_MINUTE",
                        "Troppi comandi in poco tempo. Riprova tra " + retry + " secondi.", retry);
            }
            window.addLast(now);
        }
    }

    /** Numero di generazioni in corso per l'utente (per la UI). */
    public int inFlight(UUID workspaceId, UUID userId) {
        AtomicInteger c = inFlight.get(workspaceId + ":" + userId);
        return c == null ? 0 : c.get();
    }

    /** Tetto giornaliero delle automazioni del workspace (user_id NULL in ai_usage). */
    public boolean tryAcquireAutomation(UUID workspaceId, int dailyCap) {
        int today = usageService.incrementRequests(workspaceId, null);
        if (today > Math.max(0, dailyCap)) {
            usageService.decrementRequests(workspaceId, null);
            log.info("Automazione IA saltata per ws {}: tetto giornaliero {} raggiunto", workspaceId, dailyCap);
            return false;
        }
        return true;
    }

    /** Pulizia periodica delle finestre vuote (evita la crescita della mappa). */
    @Scheduled(fixedDelay = 300_000)
    public void cleanup() {
        long now = System.currentTimeMillis();
        minuteWindows.entrySet().removeIf(e -> {
            synchronized (e.getValue()) {
                prune(e.getValue(), now);
                return e.getValue().isEmpty();
            }
        });
        inFlight.entrySet().removeIf(e -> e.getValue().get() == 0);
    }

    private static void prune(Deque<Long> window, long now) {
        while (!window.isEmpty() && now - window.peekFirst() >= WINDOW_MS) window.pollFirst();
    }

    private static void unreserve(Deque<Long> window, long ts) {
        synchronized (window) { window.removeLastOccurrence(ts); }
    }

    private static long secondsToMidnight() {
        ZonedDateTime now = ZonedDateTime.now(AiUsageService.ZONE);
        ZonedDateTime midnight = now.toLocalDate().plusDays(1).atStartOfDay(AiUsageService.ZONE);
        return Math.max(1, Duration.between(now, midnight).getSeconds());
    }

    private static int clamp(int v, int min, int max) { return Math.max(min, Math.min(max, v)); }
}
