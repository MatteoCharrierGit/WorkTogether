package com.worktogether.dto.response;

import com.worktogether.domain.entity.ApiKey;
import com.worktogether.domain.enums.ApiScope;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

/** Vista pubblica di una API key: non contiene mai il segreto. */
public record ApiKeyResponse(
        UUID id,
        String name,
        String prefix,
        List<String> scopes,
        OffsetDateTime createdAt,
        OffsetDateTime lastUsedAt,
        OffsetDateTime expiresAt,
        boolean revoked
) {
    public static ApiKeyResponse from(ApiKey k) {
        return new ApiKeyResponse(
                k.getId(),
                k.getName(),
                k.getKeyPrefix(),
                k.getScopeSet().stream().map(ApiScope::wire).toList(),
                k.getCreatedAt(),
                k.getLastUsedAt(),
                k.getExpiresAt(),
                k.isRevoked()
        );
    }
}
