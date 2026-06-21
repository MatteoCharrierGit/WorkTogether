package com.worktogether.dto.request;

import com.worktogether.domain.enums.WorkspaceRole;

import java.util.List;

/** Richiesta di bozza email all'IA: prompt + (opz.) ruoli destinatari per dare contesto. */
public record DraftEmailRequest(
        String prompt,
        List<WorkspaceRole> roles
) {}
