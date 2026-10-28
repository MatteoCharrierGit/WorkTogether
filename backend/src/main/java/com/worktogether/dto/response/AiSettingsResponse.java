package com.worktogether.dto.response;

import com.worktogether.domain.entity.AiSettings;
import com.worktogether.domain.enums.AiAutonomy;
import com.worktogether.domain.enums.AiMemoryMode;
import com.worktogether.domain.enums.AiProvider;

import java.time.OffsetDateTime;

/**
 * Vista impostazioni AI: le chiavi non sono mai esposte, solo presenza + anteprima mascherata.
 * `apiKeySet`/`apiKeyPreview`/`model` si riferiscono a OpenRouter (retro-compatibilità).
 */
public record AiSettingsResponse(
        boolean enabled,
        boolean apiKeySet,
        String apiKeyPreview,
        String model,
        double temperature,
        int maxTokens,
        int contextWindowTokens,
        int compactThresholdPct,
        AiAutonomy autonomy,
        AiMemoryMode memoryMode,
        int maxToolIterations,
        String personalityMd,
        String memoryMd,
        String toolsMd,
        OffsetDateTime updatedAt,
        // --- V20 ---
        AiProvider provider,
        boolean anthropicApiKeySet,
        String anthropicApiKeyPreview,
        String anthropicModel,
        int ratePerMinute,
        int ratePerDay,
        int maxConcurrent,
        int automationDailyCap
) {
    public static AiSettingsResponse of(AiSettings s, String openrouterPlain, String anthropicPlain) {
        boolean orSet = openrouterPlain != null && !openrouterPlain.isBlank();
        boolean anSet = anthropicPlain != null && !anthropicPlain.isBlank();
        return new AiSettingsResponse(
                s.isEnabled(), orSet, orSet ? com.worktogether.service.AiKeyCipher.mask(openrouterPlain) : null,
                s.getModel(), s.getTemperature(),
                s.getMaxTokens(), s.getContextWindowTokens(), s.getCompactThresholdPct(),
                s.getAutonomy(), s.getMemoryMode(), s.getMaxToolIterations(),
                s.getPersonalityMd(), s.getMemoryMd(), s.getToolsMd(), s.getUpdatedAt(),
                s.getProvider(), anSet, anSet ? com.worktogether.service.AiKeyCipher.mask(anthropicPlain) : null,
                s.getAnthropicModel(), s.getRatePerMinute(), s.getRatePerDay(), s.getMaxConcurrent(),
                s.getAutomationDailyCap()
        );
    }
}
