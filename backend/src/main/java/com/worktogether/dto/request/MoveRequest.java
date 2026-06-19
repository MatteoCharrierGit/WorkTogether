package com.worktogether.dto.request;

import java.util.UUID;

/**
 * Richiesta di spostamento di un file o di una cartella.
 * targetFolderId = null indica lo spostamento alla radice del workspace.
 */
public record MoveRequest(UUID targetFolderId) {}
