package com.worktogether.dto.request;

import com.worktogether.domain.enums.WorkspaceRole;
import jakarta.validation.constraints.*;

/**
 * Creazione utente da parte dell'admin. È sufficiente lo username (displayName): email e
 * password temporanea sono opzionali (l'utente le imposta al primo accesso in onboarding).
 */
public record CreateUserRequest(
        @Email String email,
        @NotBlank String displayName,
        @Size(min = 8) String temporaryPassword,
        WorkspaceRole role
) {}
