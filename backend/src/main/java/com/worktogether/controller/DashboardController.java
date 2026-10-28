package com.worktogether.controller;

import com.worktogether.domain.entity.User;
import com.worktogether.dto.response.DashboardResponse;
import com.worktogether.service.DashboardService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

import java.util.UUID;

/** Dashboard del workspace: KPI, mie priorità, sprint attiva, epiche, throughput e carico in una chiamata. */
@RestController
@RequestMapping("/api/workspaces/{wsId}/dashboard")
@RequiredArgsConstructor
public class DashboardController {

    private final DashboardService dashboardService;

    @GetMapping
    public ResponseEntity<DashboardResponse> get(
            @PathVariable UUID wsId,
            @AuthenticationPrincipal User user) {
        return ResponseEntity.ok(dashboardService.get(wsId, user));
    }
}
