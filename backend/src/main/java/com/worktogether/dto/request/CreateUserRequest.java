package com.worktogether.dto.request;

import com.worktogether.domain.enums.WorkspaceRole;
import jakarta.validation.constraints.*;

public record CreateUserRequest(
        @Email @NotBlank String email,
        @NotBlank String displayName,
        @NotBlank @Size(min = 8) String temporaryPassword,
        WorkspaceRole role
) {}
