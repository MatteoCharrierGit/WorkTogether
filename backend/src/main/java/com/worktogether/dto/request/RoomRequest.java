package com.worktogether.dto.request;

import jakarta.validation.constraints.NotBlank;

import java.util.List;
import java.util.UUID;

/**
 * Crea/aggiorna una ROOM (stanza persistente gestita dall'admin).
 * memberIds è usato solo quando isPrivate = true.
 * voiceEnabled abilita la stanza vocale (LiveKit, Fase 2).
 * screenShareEnabled abilita la condivisione schermo nella stanza (Fase 3; richiede voce).
 */
public record RoomRequest(
        @NotBlank String name,
        String description,
        boolean isPrivate,
        boolean voiceEnabled,
        boolean screenShareEnabled,
        List<UUID> memberIds
) {}
