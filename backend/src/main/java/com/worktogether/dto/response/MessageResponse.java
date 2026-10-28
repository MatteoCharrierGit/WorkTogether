package com.worktogether.dto.response;

import com.worktogether.domain.entity.Message;

import java.time.OffsetDateTime;
import java.util.UUID;

public record MessageResponse(
        UUID id,
        UUID channelId,
        UUID authorId,
        String authorName,
        String authorAvatar,      // URL versionato della foto (prima: data URL base64)
        String content,
        OffsetDateTime createdAt,
        OffsetDateTime editedAt
) {
    public static MessageResponse from(Message m) {
        return new MessageResponse(
                m.getId(),
                m.getChannel().getId(),
                m.getAuthor().getId(),
                m.getAuthor().getDisplayName(),
                m.getAuthor().getAvatarUrl(),
                m.getContent(),
                m.getCreatedAt(),
                m.getEditedAt()
        );
    }
}
