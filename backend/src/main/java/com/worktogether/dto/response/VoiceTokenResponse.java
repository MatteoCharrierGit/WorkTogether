package com.worktogether.dto.response;

/**
 * Credenziali per il client LiveKit: URL del media server + token d'accesso firmato.
 * roomName = channelId, identity = userId.
 */
public record VoiceTokenResponse(
        String url,
        String token,
        String identity,
        String roomName
) {}
