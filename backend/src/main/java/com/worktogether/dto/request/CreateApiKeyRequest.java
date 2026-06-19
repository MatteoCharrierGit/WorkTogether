package com.worktogether.dto.request;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;

import java.util.List;

/**
 * Richiesta di creazione di una API key.
 * scopes = elenco di permessi in formato wire (es. "drive:read").
 * expiresInDays = scadenza opzionale (null = nessuna scadenza).
 */
public record CreateApiKeyRequest(
        @NotBlank String name,
        @NotEmpty List<String> scopes,
        Integer expiresInDays
) {}
