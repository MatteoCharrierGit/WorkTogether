package com.worktogether.dto.response;

import com.worktogether.domain.entity.WorkspaceMember;
import com.worktogether.domain.enums.WorkspaceRole;

import java.util.UUID;

/**
 * Vista ridotta di un membro per le API key (scope members:read): solo ciò che serve per scegliere
 * gli assegnatari. Niente email, avatar, flag interni (modalità invisibile) o altri dati personali.
 */
public record ApiMemberResponse(
        UUID userId,
        String displayName,
        WorkspaceRole role
) {
    public static ApiMemberResponse from(WorkspaceMember m) {
        return new ApiMemberResponse(m.getUser().getId(), m.getUser().getDisplayName(), m.getRole());
    }
}
