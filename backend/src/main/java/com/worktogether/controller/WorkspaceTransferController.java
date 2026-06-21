package com.worktogether.controller;

import com.worktogether.domain.entity.User;
import com.worktogether.dto.transfer.ExportRequest;
import com.worktogether.dto.transfer.ImportRequest;
import com.worktogether.dto.transfer.ImportResult;
import com.worktogether.dto.transfer.WorkspaceExport;
import com.worktogether.service.WorkspaceTransferService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

import java.util.UUID;

/**
 * Backup / ripristino / trasporto di una workspace come JSON.
 * Export: admin del workspace. Import: amministratore di sistema (crea una nuova workspace).
 */
@RestController
@RequestMapping("/api/workspaces")
@RequiredArgsConstructor
public class WorkspaceTransferController {

    private final WorkspaceTransferService transferService;

    @PostMapping("/{wsId}/export")
    public ResponseEntity<WorkspaceExport> export(
            @PathVariable UUID wsId,
            @RequestBody(required = false) ExportRequest req,
            @AuthenticationPrincipal User user) {
        ExportRequest opts = req != null ? req : new ExportRequest(null, null, null, null, null, null);
        return ResponseEntity.ok(transferService.export(wsId, user, opts));
    }

    @PostMapping("/import")
    public ResponseEntity<ImportResult> importWorkspace(
            @Valid @RequestBody ImportRequest req,
            @AuthenticationPrincipal User user) {
        return ResponseEntity.status(HttpStatus.CREATED).body(transferService.importWorkspace(req, user));
    }
}
