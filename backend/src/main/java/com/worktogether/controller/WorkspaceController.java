package com.worktogether.controller;

import com.worktogether.domain.entity.User;
import com.worktogether.domain.enums.WorkspaceRole;
import com.worktogether.dto.request.*;
import com.worktogether.dto.response.*;
import com.worktogether.service.WorkspaceService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.*;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

import java.util.*;

@RestController
@RequestMapping("/api/workspaces")
@RequiredArgsConstructor
public class WorkspaceController {

    private final WorkspaceService workspaceService;

    @GetMapping
    public ResponseEntity<List<WorkspaceResponse>> list(@AuthenticationPrincipal User user) {
        return ResponseEntity.ok(workspaceService.getUserWorkspaces(user));
    }

    @PostMapping
    public ResponseEntity<WorkspaceResponse> create(
            @AuthenticationPrincipal User user,
            @Valid @RequestBody CreateWorkspaceRequest req) {
        return ResponseEntity.status(HttpStatus.CREATED).body(workspaceService.createWorkspace(user, req));
    }

    @GetMapping("/{wsId}/members")
    public ResponseEntity<List<MemberResponse>> members(
            @PathVariable UUID wsId,
            @AuthenticationPrincipal User user) {
        return ResponseEntity.ok(workspaceService.getMembers(wsId, user));
    }

    @PostMapping("/{wsId}/members")
    public ResponseEntity<MemberResponse> addMember(
            @PathVariable UUID wsId,
            @RequestParam UUID userId,
            @RequestParam WorkspaceRole role,
            @AuthenticationPrincipal User user) {
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(workspaceService.addMember(wsId, userId, role, user));
    }

    @PatchMapping("/{wsId}/members/{userId}/role")
    public ResponseEntity<Void> updateRole(
            @PathVariable UUID wsId,
            @PathVariable UUID userId,
            @RequestParam WorkspaceRole role,
            @AuthenticationPrincipal User user) {
        workspaceService.updateRole(wsId, userId, role, user);
        return ResponseEntity.noContent().build();
    }

    // --- Avatar, sicurezza WS e modalità nascosta ---
    /** Modalità invisibile per sé stessi (solo ADMIN). Body: {"hidden": true|false}. */
    @PatchMapping("/{wsId}/members/me/hidden")
    public ResponseEntity<MemberResponse> setHidden(
            @PathVariable UUID wsId,
            @RequestBody Map<String, Boolean> body,
            @AuthenticationPrincipal User user) {
        boolean hidden = body != null && Boolean.TRUE.equals(body.get("hidden"));
        return ResponseEntity.ok(workspaceService.setHidden(wsId, user, hidden));
    }

    @DeleteMapping("/{wsId}/members/{userId}")
    public ResponseEntity<Void> removeMember(
            @PathVariable UUID wsId,
            @PathVariable UUID userId,
            @AuthenticationPrincipal User user) {
        workspaceService.removeMember(wsId, userId, user);
        return ResponseEntity.noContent().build();
    }

    @PatchMapping("/{wsId}/settings")
    public ResponseEntity<WorkspaceResponse> updateSettings(
            @PathVariable UUID wsId,
            @RequestBody UpdateWorkspaceSettingsRequest req,
            @AuthenticationPrincipal User user) {
        return ResponseEntity.ok(workspaceService.updateSettings(wsId, req, user));
    }

    @DeleteMapping("/{wsId}")
    public ResponseEntity<Void> delete(
            @PathVariable UUID wsId,
            @AuthenticationPrincipal User user) {
        workspaceService.deleteWorkspace(wsId, user);
        return ResponseEntity.noContent().build();
    }
}
