package com.worktogether.dto.request;

// Campi opzionali: aggiorna solo quelli non null.
public record UpdateProfileRequest(
        String displayName,
        String avatar
) {}
