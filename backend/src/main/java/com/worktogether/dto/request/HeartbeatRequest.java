package com.worktogether.dto.request;

import java.util.UUID;

/**
 * Heartbeat di presenza. channelId valorizzato se l'utente è attualmente in una stanza vocale.
 */
public record HeartbeatRequest(
        UUID channelId
) {}
