package com.worktogether.dto.request;

import com.worktogether.domain.entity.Element;
import com.worktogether.domain.enums.ElementStatus;
import com.worktogether.domain.enums.ElementType;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

import java.util.Locale;
import java.util.UUID;

/**
 * Filtri opzionali di GET /elements (tutti in AND). Senza alcun filtro né paginazione la lista
 * resta quella di sempre: tutti gli elementi del workspace, ordinati per position e data di creazione.
 *
 * @param type     tipo dell'elemento
 * @param status   stato dell'elemento
 * @param parentId solo i figli diretti di questo elemento
 * @param q        testo contenuto nel titolo (senza distinzione di maiuscole)
 * @param sprintId solo gli elementi assegnati a questa sprint
 * @param backlog  true = solo elementi senza sprint; false = solo elementi con una sprint
 * @param tagId    solo gli elementi con questo tag
 * @param limit    numero massimo di risultati (1..{@link #MAX_LIMIT}); null = nessun limite
 * @param offset   risultati da saltare (>= 0); null = 0
 */
public record ElementFilter(
        ElementType type,
        ElementStatus status,
        UUID parentId,
        String q,
        UUID sprintId,
        Boolean backlog,
        UUID tagId,
        Integer limit,
        Integer offset
) {
    public static final int MAX_LIMIT = 500;
    public static final int MAX_QUERY_LENGTH = 200;

    public static final ElementFilter NONE = new ElementFilter(null, null, null, null, null, null, null, null, null);

    /** Controlla la coerenza dei parametri: 400 se non validi. */
    public ElementFilter validated() {
        if (limit != null && (limit < 1 || limit > MAX_LIMIT)) {
            throw bad("limit deve essere compreso tra 1 e " + MAX_LIMIT);
        }
        if (offset != null && offset < 0) {
            throw bad("offset non può essere negativo");
        }
        if (sprintId != null && backlog != null) {
            throw bad("Usa sprintId oppure backlog, non entrambi");
        }
        if (q != null && q.length() > MAX_QUERY_LENGTH) {
            throw bad("q può contenere al massimo " + MAX_QUERY_LENGTH + " caratteri");
        }
        return this;
    }

    private String needle() {
        return q == null || q.isBlank() ? null : q.trim().toLowerCase(Locale.ROOT);
    }

    public boolean matches(Element e) {
        if (type != null && e.getType() != type) return false;
        if (status != null && e.getStatus() != status) return false;
        if (parentId != null && (e.getParent() == null || !parentId.equals(e.getParent().getId()))) return false;
        if (sprintId != null && !sprintId.equals(e.getSprintId())) return false;
        if (backlog != null && backlog != (e.getSprintId() == null)) return false;
        if (tagId != null && e.getTags().stream().noneMatch(t -> tagId.equals(t.getId()))) return false;
        String n = needle();
        if (n != null && (e.getTitle() == null || !e.getTitle().toLowerCase(Locale.ROOT).contains(n))) return false;
        return true;
    }

    public boolean filters() {
        return type != null || status != null || parentId != null || needle() != null
                || sprintId != null || backlog != null || tagId != null;
    }

    private static ResponseStatusException bad(String msg) {
        return new ResponseStatusException(HttpStatus.BAD_REQUEST, msg);
    }
}
