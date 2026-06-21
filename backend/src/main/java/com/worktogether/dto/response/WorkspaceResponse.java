package com.worktogether.dto.response;

import com.worktogether.domain.entity.Workspace;
import com.worktogether.domain.enums.WorkspaceRole;

import java.time.OffsetDateTime;
import java.util.UUID;

public record WorkspaceResponse(
        UUID id,
        String name,
        String description,
        WorkspaceRole myRole,
        OffsetDateTime createdAt,
        String avatar,
        boolean cardShowTags,
        boolean cardShowAssignees,
        boolean cardShowDueDate,
        int reminderDaysBefore,
        boolean eventRemindersEnabled,
        boolean weeklyRecapEnabled,
        boolean mondayDigestEnabled
) {
    public static WorkspaceResponse from(Workspace w, WorkspaceRole role) {
        return new WorkspaceResponse(
                w.getId(), w.getName(), w.getDescription(), role, w.getCreatedAt(),
                w.getAvatar(), w.isCardShowTags(), w.isCardShowAssignees(), w.isCardShowDueDate(),
                w.getReminderDaysBefore(), w.isEventRemindersEnabled(),
                w.isWeeklyRecapEnabled(), w.isMondayDigestEnabled());
    }
}
