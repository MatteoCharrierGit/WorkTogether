package com.worktogether.controller;

import com.worktogether.domain.entity.User;
import com.worktogether.dto.request.HeartbeatRequest;
import com.worktogether.dto.response.PresenceDto;
import com.worktogether.service.PresenceService;
import com.worktogether.service.WorkspaceService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.UUID;

@RestController
@RequestMapping("/api/workspaces/{wsId}/presence")
@RequiredArgsConstructor
public class PresenceController {

    private final PresenceService presenceService;
    private final WorkspaceService workspaceService;

    /** Heartbeat di presenza; restituisce lo snapshot corrente degli utenti online. */
    @PostMapping("/heartbeat")
    public ResponseEntity<List<PresenceDto>> heartbeat(
            @PathVariable UUID wsId,
            @RequestBody(required = false) HeartbeatRequest req,
            @AuthenticationPrincipal User user) {
        workspaceService.assertMember(wsId, user);
        UUID channelId = req != null ? req.channelId() : null;
        presenceService.heartbeat(wsId, user.getId(), channelId);
        return ResponseEntity.ok(presenceService.snapshot(wsId));
    }

    /**
     * Segnala che l'utente sta lasciando l'app (chiusura tab / refresh / navigazione esterna):
     * lo rimuove subito dalla presenza invece di aspettare la scadenza dell'heartbeat (~30s).
     * Il client lo chiama da un handler {@code pagehide} con {@code fetch keepalive}.
     */
    @PostMapping("/offline")
    public ResponseEntity<Void> offline(
            @PathVariable UUID wsId,
            @AuthenticationPrincipal User user) {
        workspaceService.assertMember(wsId, user);
        presenceService.goOffline(wsId, user.getId());
        return ResponseEntity.noContent().build();
    }

    /** Snapshot della presenza del workspace (per il caricamento iniziale). */
    @GetMapping
    public ResponseEntity<List<PresenceDto>> get(
            @PathVariable UUID wsId,
            @AuthenticationPrincipal User user) {
        workspaceService.assertMember(wsId, user);
        return ResponseEntity.ok(presenceService.snapshot(wsId));
    }
}
