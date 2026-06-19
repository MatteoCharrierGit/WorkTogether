package com.worktogether.dto.response;

import com.worktogether.domain.entity.AiConversation;
import com.worktogether.domain.enums.AiConversationScope;

import java.time.OffsetDateTime;
import java.util.UUID;

public record AiConversationResponse(
        UUID id,
        AiConversationScope scope,
        UUID ownerUserId,
        String title,
        OffsetDateTime createdAt,
        OffsetDateTime updatedAt
) {
    public static AiConversationResponse from(AiConversation c) {
        return new AiConversationResponse(
                c.getId(), c.getScope(), c.getOwnerUserId(), c.getTitle(),
                c.getCreatedAt(), c.getUpdatedAt());
    }
}
