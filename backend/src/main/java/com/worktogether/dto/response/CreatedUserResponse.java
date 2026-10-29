package com.worktogether.dto.response;

/**
 * Esito della creazione di un account: i campi dell'utente (come {@link UserResponse}) più l'esito
 * dell'email di invito. L'account esiste comunque: se l'invito non parte, inviteSent=false e
 * inviteError spiega perché. Senza invito richiesto: inviteSent=false, inviteError=null.
 */
public record CreatedUserResponse(
        java.util.UUID id,
        String email,
        String displayName,
        boolean systemAdmin,
        boolean onboardingCompleted,
        String avatar,
        String avatarUrl,
        boolean inviteSent,
        String inviteError
) {
    public static CreatedUserResponse of(UserResponse u, boolean inviteSent, String inviteError) {
        return new CreatedUserResponse(u.id(), u.email(), u.displayName(), u.systemAdmin(),
                u.onboardingCompleted(), u.avatar(), u.avatarUrl(), inviteSent, inviteError);
    }
}
