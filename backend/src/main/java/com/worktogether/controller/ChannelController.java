package com.worktogether.controller;

import com.worktogether.domain.entity.User;
import com.worktogether.dto.request.*;
import com.worktogether.dto.response.ChannelResponse;
import com.worktogether.dto.response.MessageResponse;
import com.worktogether.dto.response.VoiceTokenResponse;
import com.worktogether.service.ChannelService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.*;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

@RestController
@RequestMapping("/api/workspaces/{wsId}/channels")
@RequiredArgsConstructor
public class ChannelController {

    private final ChannelService channelService;

    @GetMapping
    public ResponseEntity<List<ChannelResponse>> list(
            @PathVariable UUID wsId,
            @AuthenticationPrincipal User user) {
        return ResponseEntity.ok(channelService.listChannels(wsId, user));
    }

    @GetMapping("/rooms")
    public ResponseEntity<List<ChannelResponse>> listRooms(
            @PathVariable UUID wsId,
            @AuthenticationPrincipal User user) {
        return ResponseEntity.ok(channelService.listRooms(wsId, user));
    }

    @PostMapping("/dm")
    public ResponseEntity<ChannelResponse> createDm(
            @PathVariable UUID wsId,
            @Valid @RequestBody CreateDmRequest req,
            @AuthenticationPrincipal User user) {
        return ResponseEntity.ok(channelService.getOrCreateDm(wsId, user, req.userId()));
    }

    @PostMapping("/groups")
    public ResponseEntity<ChannelResponse> createGroup(
            @PathVariable UUID wsId,
            @Valid @RequestBody CreateGroupRequest req,
            @AuthenticationPrincipal User user) {
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(channelService.createGroup(wsId, user, req));
    }

    @PostMapping("/rooms")
    public ResponseEntity<ChannelResponse> createRoom(
            @PathVariable UUID wsId,
            @Valid @RequestBody RoomRequest req,
            @AuthenticationPrincipal User user) {
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(channelService.createRoom(wsId, user, req));
    }

    @PutMapping("/rooms/{id}")
    public ResponseEntity<ChannelResponse> updateRoom(
            @PathVariable UUID wsId,
            @PathVariable UUID id,
            @Valid @RequestBody RoomRequest req,
            @AuthenticationPrincipal User user) {
        return ResponseEntity.ok(channelService.updateRoom(wsId, id, user, req));
    }

    @DeleteMapping("/rooms/{id}")
    public ResponseEntity<Void> deleteRoom(
            @PathVariable UUID wsId,
            @PathVariable UUID id,
            @AuthenticationPrincipal User user) {
        channelService.deleteRoom(wsId, id, user);
        return ResponseEntity.noContent().build();
    }

    @GetMapping("/{id}/messages")
    public ResponseEntity<List<MessageResponse>> messages(
            @PathVariable UUID wsId,
            @PathVariable UUID id,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) OffsetDateTime before,
            @RequestParam(defaultValue = "50") int limit,
            @AuthenticationPrincipal User user) {
        return ResponseEntity.ok(channelService.getMessages(wsId, id, user, before, limit));
    }

    @PostMapping("/{id}/messages")
    public ResponseEntity<MessageResponse> sendMessage(
            @PathVariable UUID wsId,
            @PathVariable UUID id,
            @Valid @RequestBody SendMessageRequest req,
            @AuthenticationPrincipal User user) {
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(channelService.sendMessage(wsId, id, user, req.content()));
    }

    @PostMapping("/{id}/read")
    public ResponseEntity<Void> markRead(
            @PathVariable UUID wsId,
            @PathVariable UUID id,
            @AuthenticationPrincipal User user) {
        channelService.markRead(wsId, id, user);
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/{id}/typing")
    public ResponseEntity<Void> typing(
            @PathVariable UUID wsId,
            @PathVariable UUID id,
            @AuthenticationPrincipal User user) {
        channelService.notifyTyping(wsId, id, user);
        return ResponseEntity.noContent().build();
    }

    /** Emette un token d'accesso LiveKit per entrare nella stanza vocale (Fase 2). */
    @PostMapping("/{id}/voice/token")
    public ResponseEntity<VoiceTokenResponse> voiceToken(
            @PathVariable UUID wsId,
            @PathVariable UUID id,
            @AuthenticationPrincipal User user) {
        return ResponseEntity.ok(channelService.createVoiceToken(wsId, id, user));
    }
}
