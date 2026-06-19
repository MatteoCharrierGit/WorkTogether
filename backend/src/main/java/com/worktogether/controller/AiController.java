package com.worktogether.controller;

import com.worktogether.domain.entity.User;
import com.worktogether.domain.enums.AiConversationScope;
import com.worktogether.dto.request.CreateConversationRequest;
import com.worktogether.dto.request.UpdateAiSettingsRequest;
import com.worktogether.dto.response.AiConversationResponse;
import com.worktogether.dto.response.AiMessageResponse;
import com.worktogether.dto.response.AiSettingsResponse;
import com.worktogether.service.AiChatService;
import com.worktogether.service.AiConversationService;
import com.worktogether.service.AiSettingsService;
import com.worktogether.service.OpenRouterClient;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.util.List;
import java.util.Map;
import java.util.UUID;

@RestController
@RequestMapping("/api/workspaces/{wsId}/ai")
@RequiredArgsConstructor
public class AiController {

    private final AiSettingsService aiSettingsService;
    private final AiConversationService conversationService;
    private final AiChatService chatService;

    // ---- Stato & impostazioni ----

    @GetMapping("/status")
    public ResponseEntity<Map<String, Boolean>> status(
            @PathVariable UUID wsId,
            @AuthenticationPrincipal User user) {
        return ResponseEntity.ok(Map.of("enabled", aiSettingsService.isEnabled(wsId, user)));
    }

    @GetMapping("/settings")
    public ResponseEntity<AiSettingsResponse> getSettings(
            @PathVariable UUID wsId,
            @AuthenticationPrincipal User user) {
        return ResponseEntity.ok(aiSettingsService.get(wsId, user));
    }

    @PutMapping("/settings")
    public ResponseEntity<AiSettingsResponse> updateSettings(
            @PathVariable UUID wsId,
            @RequestBody UpdateAiSettingsRequest req,
            @AuthenticationPrincipal User user) {
        return ResponseEntity.ok(aiSettingsService.update(wsId, req, user));
    }

    @PostMapping("/test")
    public ResponseEntity<OpenRouterClient.TestResult> testConnection(
            @PathVariable UUID wsId,
            @RequestBody(required = false) Map<String, String> body,
            @AuthenticationPrincipal User user) {
        String apiKey = body != null ? body.get("apiKey") : null;
        return ResponseEntity.ok(aiSettingsService.testConnection(wsId, apiKey, user));
    }

    // ---- Conversazioni ----

    @GetMapping("/conversations")
    public ResponseEntity<List<AiConversationResponse>> listConversations(
            @PathVariable UUID wsId,
            @RequestParam(defaultValue = "PRIVATE") AiConversationScope scope,
            @AuthenticationPrincipal User user) {
        return ResponseEntity.ok(conversationService.list(wsId, scope, user));
    }

    @PostMapping("/conversations")
    public ResponseEntity<AiConversationResponse> createConversation(
            @PathVariable UUID wsId,
            @RequestBody CreateConversationRequest req,
            @AuthenticationPrincipal User user) {
        return ResponseEntity.status(HttpStatus.CREATED).body(conversationService.create(wsId, req, user));
    }

    @GetMapping("/conversations/{convId}/messages")
    public ResponseEntity<List<AiMessageResponse>> getMessages(
            @PathVariable UUID wsId,
            @PathVariable UUID convId,
            @AuthenticationPrincipal User user) {
        return ResponseEntity.ok(conversationService.getMessages(wsId, convId, user));
    }

    @PostMapping("/conversations/{convId}/messages")
    public SseEmitter sendMessage(
            @PathVariable UUID wsId,
            @PathVariable UUID convId,
            @RequestBody Map<String, String> body,
            @AuthenticationPrincipal User user) {
        return chatService.sendMessage(wsId, convId, body.get("text"), user);
    }

    @PostMapping("/conversations/{convId}/confirm")
    public SseEmitter confirmActions(
            @PathVariable UUID wsId,
            @PathVariable UUID convId,
            @RequestBody(required = false) Map<String, Boolean> body,
            @AuthenticationPrincipal User user) {
        boolean confirm = body != null && Boolean.TRUE.equals(body.get("confirm"));
        return chatService.resumePending(wsId, convId, confirm, user);
    }

    @DeleteMapping("/conversations/{convId}")
    public ResponseEntity<Void> deleteConversation(
            @PathVariable UUID wsId,
            @PathVariable UUID convId,
            @AuthenticationPrincipal User user) {
        conversationService.delete(wsId, convId, user);
        return ResponseEntity.noContent().build();
    }
}
