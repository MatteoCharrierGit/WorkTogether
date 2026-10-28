package com.worktogether.service.ai;

import com.worktogether.domain.entity.AiSettings;
import com.worktogether.domain.entity.AiUserSettings;
import com.worktogether.domain.enums.AiProvider;
import com.worktogether.repository.AiUserSettingsRepository;
import com.worktogether.service.AiKeyCipher;
import com.worktogether.service.AiSettingsService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

import java.util.EnumMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Punto d'accesso unico ai provider LLM: risolve provider, chiave e modello effettivo per un utente
 * (modello assegnato dall'admin → default del workspace), applica i limiti e registra i consumi.
 * Il modello NON è mai scelto dal client: viene sempre risolto qui lato server.
 */
@Service
@RequiredArgsConstructor
public class AiGateway {

    private final AiSettingsService aiSettingsService;
    private final AiUserSettingsRepository userSettingsRepository;
    private final AiKeyCipher cipher;
    private final AiRateLimiter rateLimiter;
    private final AiUsageService usageService;
    private final List<LlmProvider> providerList;

    private volatile Map<AiProvider, LlmProvider> providers;

    public enum ModelSource { USER, WORKSPACE }

    /** Configurazione effettiva per (workspace, utente). userId null = automazioni/sistema. */
    public record Resolved(UUID workspaceId, UUID userId, AiSettings settings, AiUserSettings userSettings,
                           AiProvider provider, LlmProvider client, String apiKey, String model, ModelSource modelSource) {
        public boolean hasKey() { return apiKey != null && !apiKey.isBlank(); }
        public AiRateLimiter.Limits limits() { return AiRateLimiter.limitsFor(settings, userSettings); }
    }

    public LlmProvider provider(AiProvider p) {
        Map<AiProvider, LlmProvider> m = providers;
        if (m == null) {
            m = new EnumMap<>(AiProvider.class);
            for (LlmProvider lp : providerList) m.put(lp.type(), lp);
            providers = m;
        }
        LlmProvider lp = m.get(p == null ? AiProvider.OPENROUTER : p);
        if (lp == null) throw new IllegalStateException("Provider non disponibile: " + p);
        return lp;
    }

    public Resolved resolve(UUID workspaceId, UUID userId) {
        AiSettings settings = aiSettingsService.getOrCreate(workspaceId);
        return resolve(settings, userId);
    }

    public Resolved resolve(AiSettings settings, UUID userId) {
        AiProvider provider = settings.getProvider() == null ? AiProvider.OPENROUTER : settings.getProvider();
        AiUserSettings us = userId == null ? null
                : userSettingsRepository.findByWorkspaceIdAndUserId(settings.getWorkspaceId(), userId).orElse(null);
        String assigned = us == null ? null
                : (provider == AiProvider.ANTHROPIC ? us.getAnthropicModel() : us.getOpenrouterModel());
        boolean byUser = assigned != null && !assigned.isBlank();
        String model = byUser ? assigned.trim() : settings.defaultModelFor(provider);
        String key = cipher.decrypt(settings.encryptedKeyFor(provider));
        return new Resolved(settings.getWorkspaceId(), userId, settings, us, provider, provider(provider), key, model,
                byUser ? ModelSource.USER : ModelSource.WORKSPACE);
    }

    /** Come {@link #resolve} ma richiede agente attivo + chiave configurata (errori leggibili in italiano). */
    public Resolved requireReady(UUID workspaceId, UUID userId) {
        Resolved r = resolve(workspaceId, userId);
        if (!r.settings().isEnabled()) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Agente AI non attivo in questo workspace");
        }
        if (!r.hasKey()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, missingKeyMessage(r.provider()));
        }
        return r;
    }

    public static String missingKeyMessage(AiProvider p) {
        return p == AiProvider.ANTHROPIC
                ? "Chiave Anthropic non configurata: impostala in Admin → Agente AI"
                : "Chiave OpenRouter non configurata: impostala in Admin → Agente AI";
    }

    /** Acquisisce i limiti d'uso per una generazione dell'utente (429 se superati). */
    public AiRateLimiter.Permit acquire(Resolved r) {
        return rateLimiter.acquire(r.workspaceId(), r.userId(), r.limits());
    }

    /** Controllo leggero (solo finestra al minuto) per i comandi che non chiamano il modello. */
    public void checkMinute(Resolved r) {
        rateLimiter.checkMinute(r.workspaceId(), r.userId(), r.limits());
    }

    /** Chiamata al provider con registrazione dei token consumati (sull'utente, o sul workspace se userId null). */
    public Llm.Result chat(Resolved r, Llm.Request request, java.util.function.Consumer<String> onToken) {
        Llm.Result res = r.client().chat(r.apiKey(), request, onToken);
        usageService.addTokens(r.workspaceId(), r.userId(), res.usage());
        return res;
    }

    /** Generazione testuale semplice (senza tool né streaming verso la UI). */
    public String complete(Resolved r, String system, String user, double temperature, int maxTokens) {
        Llm.Request req = new Llm.Request(r.model(), system, null, List.of(Llm.Message.user(user)), null, temperature, maxTokens);
        Llm.Result res = chat(r, req, t -> { });
        if (res.stopReason() == Llm.StopReason.REFUSAL && (res.text() == null || res.text().isBlank())) {
            throw new ResponseStatusException(HttpStatus.UNPROCESSABLE_ENTITY, "Il modello ha rifiutato la richiesta");
        }
        return res.text();
    }
}
