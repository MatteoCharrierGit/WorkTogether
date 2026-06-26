package com.worktogether.dto.response;

import com.worktogether.domain.entity.Sprint;
import com.worktogether.domain.enums.SprintStatus;

import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.UUID;

public record SprintResponse(
        UUID id,
        UUID workspaceId,
        String name,
        String goal,
        LocalDate startDate,
        LocalDate endDate,
        OffsetDateTime actualStartAt,
        OffsetDateTime actualEndAt,
        SprintStatus status,
        String retrospectiveMd,
        Integer position,
        UUID createdBy,
        OffsetDateTime createdAt,
        long taskTotal,
        long taskCompleted,
        UUID channelId
) {
    public static SprintResponse from(Sprint s, long taskTotal, long taskCompleted, UUID channelId) {
        return new SprintResponse(
                s.getId(),
                s.getWorkspace().getId(),
                s.getName(),
                s.getGoal(),
                s.getStartDate(),
                s.getEndDate(),
                s.getActualStartAt(),
                s.getActualEndAt(),
                s.getStatus(),
                s.getRetrospectiveMd(),
                s.getPosition(),
                s.getCreatedBy() != null ? s.getCreatedBy().getId() : null,
                s.getCreatedAt(),
                taskTotal,
                taskCompleted,
                channelId
        );
    }
}
