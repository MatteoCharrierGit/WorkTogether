package com.worktogether.dto.request;

import com.worktogether.domain.enums.AiAutonomy;
import com.worktogether.domain.enums.AiMemoryMode;
import com.worktogether.domain.enums.AiProvider;

/**
 * Aggiornamento impostazioni agente AI. I campi null vengono ignorati (non modificati).
 * `apiKey` (OpenRouter) / `anthropicApiKey`: se non-null e non-vuoti vengono impostati; altrimenti restano.
 * `model` è il modello predefinito OpenRouter, `anthropicModel` quello Anthropic.
 */
public record UpdateAiSettingsRequest(
        Boolean enabled,
        String apiKey,
        String model,
        Double temperature,
        Integer maxTokens,
        Integer contextWindowTokens,
        Integer compactThresholdPct,
        AiAutonomy autonomy,
        AiMemoryMode memoryMode,
        Integer maxToolIterations,
        String personalityMd,
        String memoryMd,
        String toolsMd,
        // --- V20: provider e limiti ---
        AiProvider provider,
        String anthropicApiKey,
        String anthropicModel,
        Integer ratePerMinute,
        Integer ratePerDay,
        Integer maxConcurrent,
        Integer automationDailyCap
) {
    /** Richiesta che cambia solo il modello predefinito del provider indicato. */
    public static UpdateAiSettingsRequest modelOnly(AiProvider provider, String model) {
        boolean anthropic = provider == AiProvider.ANTHROPIC;
        return new UpdateAiSettingsRequest(null, null, anthropic ? null : model, null, null, null, null, null, null,
                null, null, null, null, null, null, anthropic ? model : null, null, null, null, null);
    }
}
