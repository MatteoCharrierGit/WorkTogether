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
        String avatar
) {}
