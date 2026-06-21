package com.worktogether.domain.enums;

public enum VerificationPurpose {
    /** OTP a 6 cifre per il reset password via email. */
    PASSWORD_RESET,
    /** OTP a 6 cifre per confermare l'email scelta durante l'onboarding. */
    ONBOARDING_EMAIL,
    /** Token opaco di sessione onboarding: rilasciato al primo login (account senza password). */
    ONBOARDING_SESSION
}
