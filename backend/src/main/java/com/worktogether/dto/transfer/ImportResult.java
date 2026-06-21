package com.worktogether.dto.transfer;

import java.util.List;
import java.util.UUID;

/**
 * Esito dell'import: id della nuova workspace creata, conteggi per sezione e avvisi
 * (es. membri/autori la cui email non corrisponde ad alcun account → attribuiti all'admin).
 */
public record ImportResult(
        UUID workspaceId,
        String workspaceName,
        int members,
        int tags,
        int elements,
        int channels,
        int messages,
        boolean aiImported,
        List<String> warnings
) {}
