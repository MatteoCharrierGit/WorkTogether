package com.worktogether.dto.transfer;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;

/**
 * Richiesta di import: il payload esportato + un nome opzionale per la nuova workspace.
 * Vengono importate tutte le sezioni presenti (non null) nel {@code data}.
 */
public record ImportRequest(
        @NotNull @Valid WorkspaceExport data,
        String newName
) {}
