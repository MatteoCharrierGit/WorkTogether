package com.worktogether.controller;

import com.worktogether.domain.entity.User;
import com.worktogether.dto.request.DraftEmailRequest;
import com.worktogether.dto.request.SendEmailRequest;
import com.worktogether.dto.response.EmailDraftResponse;
import com.worktogether.dto.response.SendEmailResponse;
import com.worktogether.service.WorkspaceEmailService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

import java.util.UUID;

@RestController
@RequestMapping("/api/workspaces/{wsId}/emails")
@RequiredArgsConstructor
public class EmailController {

    private final WorkspaceEmailService emailService;

    @PostMapping("/send")
    public ResponseEntity<SendEmailResponse> send(
            @PathVariable UUID wsId,
            @RequestBody SendEmailRequest req,
            @AuthenticationPrincipal User user) {
        return ResponseEntity.ok(emailService.send(wsId, req, user));
    }

    @PostMapping("/draft")
    public ResponseEntity<EmailDraftResponse> draft(
            @PathVariable UUID wsId,
            @RequestBody DraftEmailRequest req,
            @AuthenticationPrincipal User user) {
        return ResponseEntity.ok(emailService.draft(wsId, req, user));
    }
}
