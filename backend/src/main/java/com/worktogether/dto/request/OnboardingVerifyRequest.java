package com.worktogether.dto.request;

import jakarta.validation.constraints.NotBlank;

/** Secondo passo onboarding: conferma dell'OTP inviato all'email scelta. */
public record OnboardingVerifyRequest(
        @NotBlank String onboardingToken,
        @NotBlank String code
) {}
