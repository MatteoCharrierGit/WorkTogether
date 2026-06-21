package com.worktogether.dto.request;

import jakarta.validation.constraints.NotBlank;

/**
 * Login con username (= display_name) oppure email. La password è opzionale: gli account
 * creati col solo username non ne hanno finché non completano l'onboarding.
 */
public record LoginRequest(
        @NotBlank String identifier,
        String password
) {}
