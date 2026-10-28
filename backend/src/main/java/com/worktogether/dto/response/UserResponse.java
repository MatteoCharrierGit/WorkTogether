package com.worktogether.dto.response;

import com.worktogether.domain.entity.User;
import java.util.UUID;

/**
 * avatarUrl: URL versionato della foto (GET /api/users/{id}/avatar?v=N), null se assente.
 * avatar: alias di compatibilità con lo stesso valore (prima era il data URL base64).
 */
public record UserResponse(
        UUID id,
        String email,
        String displayName,
        boolean mustResetPassword,
        boolean systemAdmin,
        boolean onboardingCompleted,
        String avatar,
        String avatarUrl
) {
    public static UserResponse from(User u) {
        String url = u.getAvatarUrl();
        return new UserResponse(u.getId(), u.getEmail(), u.getDisplayName(),
                u.isMustResetPassword(), u.isSystemAdmin(), u.isOnboardingCompleted(), url, url);
    }
}
