package com.worktogether.controller;

import com.worktogether.domain.entity.User;
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

    @GetMapping
    public ResponseEntity<List<ElementResponse>> list(
            @PathVariable UUID wsId,
            @AuthenticationPrincipal User user) {
        return ResponseEntity.ok(elementService.getElements(wsId, user));
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
