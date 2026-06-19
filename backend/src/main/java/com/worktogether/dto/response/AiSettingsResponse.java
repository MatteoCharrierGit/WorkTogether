package com.worktogether.dto.response;

import com.worktogether.domain.entity.AiSettings;
import com.worktogether.domain.enums.AiAutonomy;
import com.worktogether.domain.enums.AiMemoryMode;

import java.time.OffsetDateTime;

/** Vista impostazioni AI: la chiave non è mai esposta, solo presenza + anteprima mascherata. */
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
        OffsetDateTime updatedAt
) {
    public static AiSettingsResponse of(AiSettings s, boolean apiKeySet, String apiKeyPreview) {
        return new AiSettingsResponse(
                s.isEnabled(), apiKeySet, apiKeyPreview, s.getModel(), s.getTemperature(),
                s.getMaxTokens(), s.getContextWindowTokens(), s.getCompactThresholdPct(),
                s.getAutonomy(), s.getMemoryMode(), s.getMaxToolIterations(),
                s.getPersonalityMd(), s.getMemoryMd(), s.getToolsMd(), s.getUpdatedAt()
        );
    }
}
