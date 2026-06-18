package com.worktogether.dto.response;

import com.worktogether.domain.entity.WorkspaceMember;
import com.worktogether.domain.enums.WorkspaceRole;
import java.util.UUID;

public record MemberResponse(
        UUID userId,
        String email,
        String displayName,
        WorkspaceRole role,
        String avatar
) {
    public static MemberResponse from(WorkspaceMember m) {
        return new MemberResponse(
                m.getUser().getId(),
                m.getUser().getEmail(),
                m.getUser().getDisplayName(),
                m.getRole(),
                m.getUser().getAvatar()
        );
    }
}
