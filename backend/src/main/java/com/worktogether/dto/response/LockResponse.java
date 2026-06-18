package com.worktogether.dto.response;

import java.time.OffsetDateTime;
import java.util.UUID;

// Esito di un tentativo di acquisizione del lock di modifica.
public record LockResponse(
        boolean acquired,
        UUID lockedBy,
        OffsetDateTime lockedAt
) {}
