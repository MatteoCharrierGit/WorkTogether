package com.worktogether.dto.request;

// Campi opzionali: aggiorna solo quelli non null.
public record UpdateWorkspaceSettingsRequest(
        String avatar,
        Boolean cardShowTags,
        Boolean cardShowAssignees,
        Boolean cardShowDueDate
) {}
