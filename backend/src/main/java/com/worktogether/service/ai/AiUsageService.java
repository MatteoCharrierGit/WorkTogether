package com.worktogether.service.ai;

import com.worktogether.domain.entity.AiUsage;
import com.worktogether.repository.AiUsageRepository;
import lombok.RequiredArgsConstructor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;
import java.time.ZoneId;
import java.util.List;
import java.util.UUID;

/**
 * Contatori di consumo IA per giorno (fuso Europe/Rome) su tabella ai_usage.
 * Le scritture sono brevi transazioni autonome: mai chiamate dentro transazioni lunghe.
 */
@Service
@RequiredArgsConstructor
public class AiUsageService {

    private static final Logger log = LoggerFactory.getLogger(AiUsageService.class);
    public static final ZoneId ZONE = ZoneId.of("Europe/Rome");

    private final AiUsageRepository repository;

    public static LocalDate today() { return LocalDate.now(ZONE); }

    /** Incrementa il contatore richieste di oggi e ritorna il nuovo valore (userId null = automazioni). */
    @Transactional
    public int incrementRequests(UUID workspaceId, UUID userId) {
        return repository.incrementRequests(workspaceId, userId, today());
    }

    /** Annulla un incremento (richiesta rifiutata per limite). */
    @Transactional
    public void decrementRequests(UUID workspaceId, UUID userId) {
        repository.decrementRequests(workspaceId, userId, today());
    }

    /** Somma i token di una chiamata al provider. Best-effort: un errore non interrompe la chat. */
    @Transactional
    public void addTokens(UUID workspaceId, UUID userId, Llm.Usage usage) {
        if (usage == null || (usage.inputTokens() == 0 && usage.outputTokens() == 0)) return;
        try {
            repository.addTokens(workspaceId, userId, today(), usage.inputTokens(), usage.outputTokens(), usage.cacheReadTokens());
        } catch (Exception e) {
            log.warn("Registrazione consumi IA fallita (ws {}, user {}): {}", workspaceId, userId, e.getMessage());
        }
    }

    @Transactional(readOnly = true)
    public int requestsToday(UUID workspaceId, UUID userId) {
        return repository.requestsOn(workspaceId, userId, today());
    }

    /** Righe di consumo del workspace dagli ultimi {@code days} giorni (oggi incluso). */
    @Transactional(readOnly = true)
    public List<AiUsage> since(UUID workspaceId, int days) {
        return repository.findByWorkspaceIdAndDayGreaterThanEqualOrderByDayAsc(workspaceId, today().minusDays(Math.max(0, days - 1)));
    }
}
