package com.worktogether.dto.response;

import com.worktogether.domain.enums.WorkspaceRole;

/** Anteprima pubblica di un invito (mostrata nella schermata di accettazione). */
public record InvitationPreviewResponse(
        String workspaceName,
        String inviterName,
        String email,
        WorkspaceRole role
) {}
