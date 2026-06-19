package com.worktogether.dto.response;

import com.worktogether.domain.entity.AiMessage;
import com.worktogether.domain.enums.AiMessageRole;

import java.time.OffsetDateTime;
import java.util.UUID;

public record AiMessageResponse(
        UUID id,
        AiMessageRole role,
        String content,
        UUID authorUserId,
        OffsetDateTime createdAt
) {
    public static AiMessageResponse from(AiMessage m) {
        return new AiMessageResponse(m.getId(), m.getRole(), m.getContent(),
                m.getAuthorUserId(), m.getCreatedAt());
    }
}
