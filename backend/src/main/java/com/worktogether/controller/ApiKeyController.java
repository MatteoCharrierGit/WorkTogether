package com.worktogether.controller;

import com.worktogether.domain.entity.User;
import com.worktogether.dto.request.CreateApiKeyRequest;
import com.worktogether.dto.response.ApiKeyResponse;
import com.worktogether.dto.response.CreatedApiKeyResponse;
import com.worktogether.service.ApiKeyService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.UUID;

@RestController
@RequestMapping("/api/workspaces/{wsId}/api-keys")
@RequiredArgsConstructor
public class ApiKeyController {

    private final ApiKeyService apiKeyService;

    @GetMapping
    public ResponseEntity<List<ApiKeyResponse>> list(
            @PathVariable UUID wsId,
            @AuthenticationPrincipal User user) {
        return ResponseEntity.ok(apiKeyService.list(wsId, user));
    }

    @PostMapping
    public ResponseEntity<CreatedApiKeyResponse> create(
            @PathVariable UUID wsId,
            @Valid @RequestBody CreateApiKeyRequest req,
            @AuthenticationPrincipal User user) {
        return ResponseEntity.status(HttpStatus.CREATED).body(apiKeyService.create(wsId, req, user));
    }

    @DeleteMapping("/{keyId}")
    public ResponseEntity<Void> delete(
            @PathVariable UUID wsId,
            @PathVariable UUID keyId,
            @AuthenticationPrincipal User user) {
        apiKeyService.delete(wsId, keyId, user);
        return ResponseEntity.noContent().build();
    }
}
