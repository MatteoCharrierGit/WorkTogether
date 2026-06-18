package com.worktogether.dto.response;

import com.worktogether.domain.entity.User;
import java.util.UUID;

public record UserResponse(
        UUID id,
        String email,
        String displayName,
        boolean mustResetPassword,
        boolean systemAdmin,
        String avatar
) {
    public static UserResponse from(User u) {
        return new UserResponse(u.getId(), u.getEmail(), u.getDisplayName(),
                u.isMustResetPassword(), u.isSystemAdmin(), u.getAvatar());
    }
}
