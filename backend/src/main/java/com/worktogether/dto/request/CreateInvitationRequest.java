package com.worktogether.dto.request;

import com.worktogether.domain.enums.WorkspaceRole;
import jakarta.validation.constraints.NotBlank;

/** Invito a un workspace: bersaglio per username (displayName) o email. */
public record CreateInvitationRequest(
        @NotBlank String identifier,
        WorkspaceRole role
) {}
