package com.worktogether.dto.response;

import java.util.List;

/** Sprint con i suoi task (per la dashboard della sprint attiva e l'archivio).
 *  {@code sprint} è null quando non esiste alcuna sprint (es. nessuna attiva). */
public record SprintDetailResponse(
        SprintResponse sprint,
        List<ElementResponse> tasks
) {}
