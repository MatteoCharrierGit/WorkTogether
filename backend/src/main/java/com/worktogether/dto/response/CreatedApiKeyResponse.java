package com.worktogether.dto.response;

/**
 * Restituita una sola volta alla creazione: include il segreto in chiaro.
 * Dopo questa risposta il segreto non è più recuperabile.
 */
public record CreatedApiKeyResponse(ApiKeyResponse key, String secret) {}
