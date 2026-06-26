package com.worktogether.dto.response;

import com.worktogether.domain.entity.Element;
import com.worktogether.domain.enums.ElementStatus;
import com.worktogether.domain.enums.ElementType;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

public record ElementResponse(
        UUID id,
        UUID workspaceId,
        UUID parentId,
        ElementType type,
        ElementStatus status,
        String title,
        String body,
        OffsetDateTime startDate,
        OffsetDateTime endDate,
        boolean allDay,
        Integer position,
        UUID sprintId,
        OffsetDateTime completedAt,
        boolean blocked,
        UUID createdBy,
        OffsetDateTime createdAt,
        OffsetDateTime updatedAt,
        List<TagResponse> tags,
        List<UserResponse> assignees,
        Integer progress
) {
    public static ElementResponse from(Element e) {
        return from(e, null);
    }

    public static ElementResponse from(Element e, Integer progress) {
        return new ElementResponse(
                e.getId(),
                e.getWorkspace().getId(),
                e.getParent() != null ? e.getParent().getId() : null,
                e.getType(),
                e.getStatus(),
                e.getTitle(),
                e.getBody(),
                e.getStartDate(),
                e.getEndDate(),
                e.isAllDay(),
                e.getPosition(),
                e.getSprintId(),
                e.getCompletedAt(),
                e.isBlocked(),
                e.getCreatedBy().getId(),
                e.getCreatedAt(),
                e.getUpdatedAt(),
                e.getTags().stream().map(TagResponse::from).toList(),
                e.getAssignees().stream().map(UserResponse::from).toList(),
                progress
        );
    }
}
