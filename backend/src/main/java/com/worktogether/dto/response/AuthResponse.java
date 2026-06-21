package com.worktogether.dto.response;

import java.util.UUID;

public record AuthResponse(
        String accessToken,
        String refreshToken,
        UUID userId,
        String email,
        String displayName,
        boolean mustResetPassword,
        boolean systemAdmin,
        boolean onboardingCompleted,
        String avatar,
        // Primo accesso di un account creato col solo username: niente token reali,
        // il client deve passare alla schermata di onboarding usando onboardingToken.
        boolean onboardingRequired,
        String onboardingToken
) {
    /** Risposta per il caso onboarding-richiesto (nessun token di accesso). */
    public static AuthResponse onboarding(UUID userId, String displayName, String onboardingToken) {
        return new AuthResponse(null, null, userId, null, displayName,
                false, false, false, null, true, onboardingToken);
    }
}
