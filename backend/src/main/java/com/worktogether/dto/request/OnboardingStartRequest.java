package com.worktogether.dto.request;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/** Primo passo onboarding: l'utente sceglie email e nuova password; segue invio OTP. */
public record OnboardingStartRequest(
        @NotBlank String onboardingToken,
        @Email @NotBlank String email,
        @NotBlank @Size(min = 8) String password
) {}
