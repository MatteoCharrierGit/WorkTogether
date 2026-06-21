package com.worktogether.dto.response;

/**
 * Stato di presenza di un utente online in un workspace.
 * inCallChannelId valorizzato se l'utente è in una stanza vocale (altrimenti null).
 */
public record PresenceDto(
        String userId,
        String inCallChannelId
) {}
