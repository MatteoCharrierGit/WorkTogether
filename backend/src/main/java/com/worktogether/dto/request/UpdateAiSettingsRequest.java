package com.worktogether.dto.request;

import com.worktogether.domain.enums.AiAutonomy;
import com.worktogether.domain.enums.AiMemoryMode;

/**
 * Aggiornamento impostazioni agente AI. I campi null vengono ignorati (non modificati).
 * `apiKey`: se non-null e non-vuoto viene impostata; se vuoto/null la chiave esistente resta.
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
        String toolsMd
) {}
