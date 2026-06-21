package com.worktogether.dto.response;

import com.worktogether.domain.entity.WorkspaceInvitation;
import com.worktogether.domain.enums.InvitationStatus;
import com.worktogether.domain.enums.WorkspaceRole;

import java.time.OffsetDateTime;
import java.util.UUID;

public record InvitationResponse(
        UUID id,
        UUID workspaceId,
        String workspaceName,
        String email,
        String displayName,
        WorkspaceRole role,
        InvitationStatus status,
        OffsetDateTime expiresAt,
        OffsetDateTime createdAt
) {
    public static InvitationResponse from(WorkspaceInvitation i) {
        return new InvitationResponse(
                i.getId(),
                i.getWorkspace().getId(),
                i.getWorkspace().getName(),
                i.getEmail(),
                i.getInvitedUser() != null ? i.getInvitedUser().getDisplayName() : null,
                i.getRole(),
                i.getStatus(),
                i.getExpiresAt(),
                i.getCreatedAt()
        );
    }
}
