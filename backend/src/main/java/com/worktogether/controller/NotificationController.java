package com.worktogether.controller;

import com.worktogether.domain.entity.User;
import com.worktogether.domain.enums.NotificationType;
import com.worktogether.dto.response.NotificationResponse;
import com.worktogether.service.NotificationService;
import lombok.RequiredArgsConstructor;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/** Notifiche in-app dell'utente corrente (trasversali ai workspace). */
@RestController
@RequestMapping("/api/notifications")
@RequiredArgsConstructor
public class NotificationController {

    private final NotificationService notificationService;

    /** Lista più recenti prima; {@code before} = createdAt dell'ultima ricevuta (cursore). */
    @GetMapping
    public ResponseEntity<List<NotificationResponse>> list(
            @RequestParam(defaultValue = "false") boolean unreadOnly,
            @RequestParam(defaultValue = "30") int limit,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) OffsetDateTime before,
            @AuthenticationPrincipal User user) {
        return ResponseEntity.ok(notificationService.list(user, unreadOnly, limit, before));
    }

    @GetMapping("/unread-count")
    public ResponseEntity<Map<String, Long>> unreadCount(@AuthenticationPrincipal User user) {
        return ResponseEntity.ok(Map.of("count", notificationService.unreadCount(user)));
    }

    @PostMapping("/{id}/read")
    public ResponseEntity<NotificationResponse> markRead(@PathVariable UUID id, @AuthenticationPrincipal User user) {
        return ResponseEntity.ok(notificationService.markRead(id, user));
    }

    @PostMapping("/read-all")
    public ResponseEntity<Map<String, Integer>> markAllRead(@AuthenticationPrincipal User user) {
        return ResponseEntity.ok(Map.of("updated", notificationService.markAllRead(user)));
    }

    @GetMapping("/preferences")
    public ResponseEntity<Map<NotificationType, Boolean>> preferences(@AuthenticationPrincipal User user) {
        return ResponseEntity.ok(notificationService.getPreferences(user));
    }

    @PutMapping("/preferences")
    public ResponseEntity<Map<NotificationType, Boolean>> updatePreferences(
            @RequestBody Map<NotificationType, Boolean> changes,
            @AuthenticationPrincipal User user) {
        return ResponseEntity.ok(notificationService.updatePreferences(user, changes));
    }
}
