package com.worktogether.dto.response;

import com.worktogether.domain.entity.Notification;
import com.worktogether.domain.enums.NotificationType;

import java.time.OffsetDateTime;
import java.util.UUID;

public record NotificationResponse(
        UUID id,
        UUID workspaceId,
        NotificationType type,
        String title,
        String body,
        String link,
        UUID actorId,
        String actorName,
        String actorAvatar,
        UUID elementId,
        OffsetDateTime readAt,
        OffsetDateTime createdAt
) {
    public static NotificationResponse from(Notification n) {
        var a = n.getActor();
        return new NotificationResponse(n.getId(), n.getWorkspaceId(), n.getType(), n.getTitle(), n.getBody(),
                n.getLink(), a != null ? a.getId() : null, a != null ? a.getDisplayName() : null,
                a != null ? a.getAvatar() : null, n.getElementId(), n.getReadAt(), n.getCreatedAt());
    }
}
