package com.worktogether.dto.request;

import com.worktogether.domain.enums.WorkspaceRole;
import jakarta.validation.constraints.*;

import java.util.UUID;

/**
 * Creazione di un account da parte dell'admin di sistema: l'utente viene creato in Authentik
 * (username, email, nome, password iniziale, gruppo dell'app) e poi collegato all'utente interno.
 * workspaceId/role opzionali: se presenti, l'utente viene anche aggiunto a quel workspace.
 * sendInvite (facoltativo, default false): manda all'utente un'email con username, password iniziale e
 * link al sito, e gli impone di scegliere una nuova password al primo accesso.
 */
public record CreateUserRequest(
        @NotBlank @Size(max = 150)
        @Pattern(regexp = "^[A-Za-z0-9._@+-]+$", message = "solo lettere, numeri e . _ @ + -")
        String username,
        @NotBlank @Email String email,
        @Size(max = 255) String name,
        @NotBlank @Size(min = 8, max = 128) String password,
        UUID workspaceId,
        WorkspaceRole role,
        Boolean sendInvite
) {
    public boolean inviteRequested() {
        return Boolean.TRUE.equals(sendInvite);
    }
}
