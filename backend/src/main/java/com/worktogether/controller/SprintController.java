package com.worktogether.controller;

import com.worktogether.domain.entity.User;
import com.worktogether.dto.request.CloseSprintRequest;
import com.worktogether.dto.request.CreateSprintRequest;
import com.worktogether.dto.request.UpdateSprintRequest;
import com.worktogether.dto.response.SprintDetailResponse;
import com.worktogether.dto.response.SprintResponse;
import com.worktogether.service.SprintService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.UUID;

@RestController
@RequestMapping("/api/workspaces/{wsId}/sprints")
@RequiredArgsConstructor
public class SprintController {

    private final SprintService sprintService;

    @GetMapping
    public ResponseEntity<List<SprintResponse>> list(
            @PathVariable UUID wsId,
            @AuthenticationPrincipal User user) {
        return ResponseEntity.ok(sprintService.list(wsId, user));
    }

    @GetMapping("/active")
    public ResponseEntity<SprintDetailResponse> active(
            @PathVariable UUID wsId,
            @AuthenticationPrincipal User user) {
        return ResponseEntity.ok(sprintService.getActive(wsId, user));
    }

    @GetMapping("/{sprintId}")
    public ResponseEntity<SprintDetailResponse> get(
            @PathVariable UUID wsId,
            @PathVariable UUID sprintId,
            @AuthenticationPrincipal User user) {
        return ResponseEntity.ok(sprintService.getOne(wsId, sprintId, user));
    }

    @PostMapping
    public ResponseEntity<SprintResponse> create(
            @PathVariable UUID wsId,
            @Valid @RequestBody CreateSprintRequest req,
            @AuthenticationPrincipal User user) {
        return ResponseEntity.status(HttpStatus.CREATED).body(sprintService.create(wsId, req, user));
    }

    @PatchMapping("/{sprintId}")
    public ResponseEntity<SprintResponse> update(
            @PathVariable UUID wsId,
            @PathVariable UUID sprintId,
            @RequestBody UpdateSprintRequest req,
            @AuthenticationPrincipal User user) {
        return ResponseEntity.ok(sprintService.update(wsId, sprintId, req, user));
    }

    @DeleteMapping("/{sprintId}")
    public ResponseEntity<Void> delete(
            @PathVariable UUID wsId,
            @PathVariable UUID sprintId,
            @AuthenticationPrincipal User user) {
        sprintService.delete(wsId, sprintId, user);
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/{sprintId}/start")
    public ResponseEntity<SprintResponse> start(
            @PathVariable UUID wsId,
            @PathVariable UUID sprintId,
            @AuthenticationPrincipal User user) {
        return ResponseEntity.ok(sprintService.start(wsId, sprintId, user));
    }

    @PostMapping("/{sprintId}/close")
    public ResponseEntity<SprintResponse> close(
            @PathVariable UUID wsId,
            @PathVariable UUID sprintId,
            @RequestBody(required = false) CloseSprintRequest req,
            @AuthenticationPrincipal User user) {
        CloseSprintRequest body = req != null ? req : new CloseSprintRequest(null, null, null);
        return ResponseEntity.ok(sprintService.close(wsId, sprintId, body, user));
    }

    @PostMapping("/{sprintId}/tasks/{elementId}")
    public ResponseEntity<Void> addTask(
            @PathVariable UUID wsId,
            @PathVariable UUID sprintId,
            @PathVariable UUID elementId,
            @AuthenticationPrincipal User user) {
        sprintService.addTask(wsId, sprintId, elementId, user);
        return ResponseEntity.noContent().build();
    }

    @DeleteMapping("/{sprintId}/tasks/{elementId}")
    public ResponseEntity<Void> removeTask(
            @PathVariable UUID wsId,
            @PathVariable UUID sprintId,
            @PathVariable UUID elementId,
            @AuthenticationPrincipal User user) {
        sprintService.removeTask(wsId, sprintId, elementId, user);
        return ResponseEntity.noContent().build();
    }
}
