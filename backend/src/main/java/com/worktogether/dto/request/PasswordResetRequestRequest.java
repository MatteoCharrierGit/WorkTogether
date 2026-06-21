package com.worktogether.dto.request;

import jakarta.validation.constraints.NotBlank;

/** Richiesta di reset password: username o email. */
public record PasswordResetRequestRequest(
        @NotBlank String identifier
) {}
