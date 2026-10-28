package com.worktogether.controller;

import com.worktogether.domain.entity.User;
import com.worktogether.domain.enums.AiConversationScope;
import com.worktogether.dto.request.CreateConversationRequest;
import com.worktogether.dto.request.UpdateAiSettingsRequest;
import com.worktogether.dto.response.AiConversationResponse;
import com.worktogether.dto.response.AiMessageResponse;
import com.worktogether.dto.response.AiSettingsResponse;
import com.worktogether.service.AiChatService;
import com.worktogether.service.AiCommandService;
import com.worktogether.service.AiConversationService;
import com.worktogether.service.AiSettingsService;
import com.worktogether.domain.enums.AiProvider;
import com.worktogether.service.ai.AiAdminService;
import com.worktogether.service.ai.AiModelCatalog;
import com.worktogether.service.ai.Llm;
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
    private final AiCommandService commandService;
    private final AiAdminService adminService;

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

    /** Test chiave. Body opzionale: {apiKey?, provider?} (default: provider attivo e chiave salvata). */
    @PostMapping("/test")
    public ResponseEntity<Llm.TestResult> testConnection(
            @PathVariable UUID wsId,
            @RequestBody(required = false) Map<String, String> body,
            @AuthenticationPrincipal User user) {
        String apiKey = body != null ? body.get("apiKey") : null;
        AiProvider provider = parseProvider(body != null ? body.get("provider") : null);
        return ResponseEntity.ok(aiSettingsService.testConnection(wsId, provider, apiKey, user));
    }

    /** Modelli del provider (admin): {provider, live, error, models:[{id,name}]}. Cache 10 min, fallback statico. */
    @GetMapping("/models")
    public ResponseEntity<AiModelCatalog.Catalog> listModels(
            @PathVariable UUID wsId,
            @RequestParam(required = false) String provider,
            @AuthenticationPrincipal User user) {
        return ResponseEntity.ok(aiSettingsService.listModels(wsId, parseProvider(provider), user));
    }

    // ---- Utente corrente, modelli per utente, consumi ----

    /** Modello effettivo (sola lettura), limiti e consumo di oggi dell'utente corrente. Tutti i membri. */
    @GetMapping("/me")
    public ResponseEntity<AiAdminService.MeResponse> me(
            @PathVariable UUID wsId,
            @AuthenticationPrincipal User user) {
        return ResponseEntity.ok(adminService.me(wsId, user));
    }

    /** Admin: membri con modello assegnato, override limiti e consumi (oggi / ultimi `days` giorni). */
    @GetMapping("/users")
    public ResponseEntity<List<AiAdminService.UserRow>> listUsers(
            @PathVariable UUID wsId,
            @RequestParam(defaultValue = "30") int days,
            @AuthenticationPrincipal User user) {
        return ResponseEntity.ok(adminService.listUsers(wsId, user, days));
    }

    /** Admin: assegna modello/limiti a un membro (campi null = default del workspace). */
    @PutMapping("/users/{userId}")
    public ResponseEntity<AiAdminService.UserRow> updateUser(
            @PathVariable UUID wsId,
            @PathVariable UUID userId,
            @RequestBody AiAdminService.UpdateUserRequest req,
            @AuthenticationPrincipal User user) {
        return ResponseEntity.ok(adminService.updateUser(wsId, userId, req, user));
    }

    /** Admin: report consumi del workspace per utente e per giorno (ultimi `days` giorni, max 365). */
    @GetMapping("/usage")
    public ResponseEntity<AiAdminService.UsageReport> usage(
            @PathVariable UUID wsId,
            @RequestParam(defaultValue = "30") int days,
            @AuthenticationPrincipal User user) {
        return ResponseEntity.ok(adminService.usage(wsId, user, days));
    }

    private static AiProvider parseProvider(String p) {
        if (p == null || p.isBlank()) return null;
        try {
            return AiProvider.valueOf(p.trim().toUpperCase());
        } catch (IllegalArgumentException e) {
            throw new org.springframework.web.server.ResponseStatusException(HttpStatus.BAD_REQUEST, "Provider non valido: " + p);
        }
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

    @PostMapping("/conversations/{convId}/command")
    public ResponseEntity<AiCommandService.CommandResult> runCommand(
            @PathVariable UUID wsId,
            @PathVariable UUID convId,
            @RequestBody Map<String, String> body,
            @AuthenticationPrincipal User user) {
        String command = body.get("command");
        String arg = body.get("arg");
        return ResponseEntity.ok(commandService.execute(wsId, convId, command, arg, user));
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
