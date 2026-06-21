package com.worktogether.dto.request;

import com.worktogether.domain.enums.WorkspaceRole;

import java.util.List;
import java.util.UUID;

/**
 * Invio email: destinatari per ruolo e/o per singoli utenti (userIds), oggetto e corpo.
 * roles e userIds sono entrambi opzionali ma almeno uno deve essere valorizzato.
 */
public record SendEmailRequest(
        List<WorkspaceRole> roles,
        List<UUID> userIds,
        String subject,
        String body
) {}
