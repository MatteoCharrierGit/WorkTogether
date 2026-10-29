package com.worktogether.controller;

import com.worktogether.domain.entity.User;
import com.worktogether.domain.enums.ElementStatus;
import com.worktogether.domain.enums.ElementType;
import com.worktogether.dto.request.ElementFilter;
import com.worktogether.dto.request.ElementRequest;
import com.worktogether.dto.response.ElementResponse;
import com.worktogether.service.ElementService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.*;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

import java.util.*;

@RestController
@RequestMapping("/api/workspaces/{wsId}/elements")
@RequiredArgsConstructor
public class ElementController {

    private final ElementService elementService;

    // Per compatibilità con le integrazioni esterne (API key) la lista include "body" di default;
    // la web app passa ?includeBody=false per alleggerire il payload (le viste lista non lo usano).
    // Filtri opzionali (in AND): type, status, parentId, q (titolo, senza maiuscole), sprintId oppure
    // backlog, tagId; paginazione limit (1..500, assente = tutti) e offset. Il totale prima della
    // paginazione è nell'header X-Total-Count. Senza parametri la risposta è quella di sempre.
    @GetMapping
    public ResponseEntity<List<ElementResponse>> list(
            @PathVariable UUID wsId,
            @RequestParam(defaultValue = "true") boolean includeBody,
            @RequestParam(required = false) ElementType type,
            @RequestParam(required = false) ElementStatus status,
            @RequestParam(required = false) UUID parentId,
            @RequestParam(required = false) String q,
            @RequestParam(required = false) UUID sprintId,
            @RequestParam(required = false) Boolean backlog,
            @RequestParam(required = false) UUID tagId,
            @RequestParam(required = false) Integer limit,
            @RequestParam(required = false) Integer offset,
            @AuthenticationPrincipal User user) {
        var filter = new ElementFilter(type, status, parentId, q, sprintId, backlog, tagId, limit, offset);
        ElementService.ElementPage page = elementService.getElements(wsId, user, includeBody, filter);
        return ResponseEntity.ok()
                .header("X-Total-Count", String.valueOf(page.total()))
                .body(page.items());
    }

    @PostMapping
    public ResponseEntity<ElementResponse> create(
            @PathVariable UUID wsId,
            @Valid @RequestBody ElementRequest req,
            @AuthenticationPrincipal User user) {
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(elementService.createElement(wsId, req, user));
    }

    @GetMapping("/{id}")
    public ResponseEntity<ElementResponse> get(
            @PathVariable UUID wsId,
            @PathVariable UUID id,
            @AuthenticationPrincipal User user) {
        return ResponseEntity.ok(elementService.getElement(wsId, id, user));
    }

    @PutMapping("/{id}")
    public ResponseEntity<ElementResponse> update(
            @PathVariable UUID wsId,
            @PathVariable UUID id,
            @RequestBody ElementRequest req,
            @AuthenticationPrincipal User user) {
        return ResponseEntity.ok(elementService.updateElement(wsId, id, req, user));
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> delete(
            @PathVariable UUID wsId,
            @PathVariable UUID id,
            @AuthenticationPrincipal User user) {
        elementService.deleteElement(wsId, id, user);
        return ResponseEntity.noContent().build();
    }
}
