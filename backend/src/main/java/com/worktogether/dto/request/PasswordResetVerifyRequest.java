package com.worktogether.dto.request;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/** Conferma reset password: OTP + nuova password. */
public record PasswordResetVerifyRequest(
        @NotBlank String identifier,
        @NotBlank String code,
        @NotBlank @Size(min = 8) String newPassword
) {}
