package com.worktogether.dto.response;

import com.worktogether.domain.entity.WorkspaceMember;
import com.worktogether.domain.enums.WorkspaceRole;
import java.util.UUID;

/**
 * avatar/avatarUrl: URL versionato della foto (avatar = alias di compatibilità).
 * hidden: admin in "modalità invisibile" (visibile solo agli admin e all'interessato; agli altri
 * utenti il membro non viene proprio restituito).
 */
public record MemberResponse(
        UUID userId,
        String email,
        String displayName,
        WorkspaceRole role,
        String avatar,
        String avatarUrl,
        boolean hidden
) {
    public static MemberResponse from(WorkspaceMember m) {
        String url = m.getUser().getAvatarUrl();
        return new MemberResponse(
                m.getUser().getId(),
                m.getUser().getEmail(),
                m.getUser().getDisplayName(),
                m.getRole(),
                url,
                url,
                m.isHidden()
        );
    }
}
