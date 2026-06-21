package com.worktogether.controller;

import com.worktogether.domain.entity.User;
import com.worktogether.dto.request.CreateInvitationRequest;
import com.worktogether.dto.response.InvitationPreviewResponse;
import com.worktogether.dto.response.InvitationResponse;
import com.worktogether.service.WorkspaceInvitationService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.UUID;

@RestController
@RequiredArgsConstructor
public class InvitationController {

    private final WorkspaceInvitationService invitationService;

    // ---- Gestione inviti (ADMIN del workspace) ----

    @PostMapping("/api/workspaces/{wsId}/invitations")
    public ResponseEntity<InvitationResponse> create(
            @PathVariable UUID wsId,
            @Valid @RequestBody CreateInvitationRequest req,
            @AuthenticationPrincipal User user) {
        return ResponseEntity.status(HttpStatus.CREATED).body(invitationService.create(wsId, req, user));
    }

    @GetMapping("/api/workspaces/{wsId}/invitations")
    public ResponseEntity<List<InvitationResponse>> list(
            @PathVariable UUID wsId,
            @AuthenticationPrincipal User user) {
        return ResponseEntity.ok(invitationService.list(wsId, user));
    }

    @DeleteMapping("/api/workspaces/{wsId}/invitations/{id}")
    public ResponseEntity<Void> revoke(
            @PathVariable UUID wsId,
            @PathVariable UUID id,
            @AuthenticationPrincipal User user) {
        invitationService.revoke(wsId, id, user);
        return ResponseEntity.noContent().build();
    }

    // ---- Anteprima pubblica (sotto /api/auth/** ⇒ permitAll) ----

    @GetMapping("/api/auth/invitations/{token}")
    public ResponseEntity<InvitationPreviewResponse> preview(@PathVariable String token) {
        return ResponseEntity.ok(invitationService.preview(token));
    }

    // ---- Accettazione (utente autenticato) ----

    @PostMapping("/api/invitations/{token}/accept")
    public ResponseEntity<InvitationResponse> accept(
            @PathVariable String token,
            @AuthenticationPrincipal User user) {
        return ResponseEntity.ok(invitationService.accept(token, user));
    }
}
