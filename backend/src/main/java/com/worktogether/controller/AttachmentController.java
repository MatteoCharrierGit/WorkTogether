package com.worktogether.controller;

import com.worktogether.domain.entity.User;
import com.worktogether.dto.response.AttachmentResponse;
import com.worktogether.service.AttachmentService;
import lombok.RequiredArgsConstructor;
import org.springframework.core.io.Resource;
import org.springframework.http.*;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.util.List;
import java.util.UUID;

@RestController
@RequestMapping("/api/workspaces/{wsId}/elements/{id}/attachments")
@RequiredArgsConstructor
public class AttachmentController {

    private final AttachmentService attachmentService;

    @GetMapping
    public ResponseEntity<List<AttachmentResponse>> list(
            @PathVariable UUID wsId,
            @PathVariable UUID id,
            @AuthenticationPrincipal User user) {
        return ResponseEntity.ok(attachmentService.list(wsId, id, user));
    }

    @PostMapping(consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ResponseEntity<AttachmentResponse> upload(
            @PathVariable UUID wsId,
            @PathVariable UUID id,
            @RequestParam("file") MultipartFile file,
            @AuthenticationPrincipal User user) {
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(attachmentService.upload(wsId, id, file, user));
    }

    @GetMapping("/{attId}")
    public ResponseEntity<Resource> download(
            @PathVariable UUID wsId,
            @PathVariable UUID id,
            @PathVariable UUID attId,
            @AuthenticationPrincipal User user) {
        AttachmentService.DownloadFile d = attachmentService.download(wsId, id, attId, user);
        MediaType mediaType = d.contentType() != null
                ? MediaType.parseMediaType(d.contentType())
                : MediaType.APPLICATION_OCTET_STREAM;
        return ResponseEntity.ok()
                .contentType(mediaType)
                .header(HttpHeaders.CONTENT_DISPOSITION,
                        "attachment; filename=\"" + d.filename() + "\"")
                .body(d.resource());
    }

    @DeleteMapping("/{attId}")
    public ResponseEntity<Void> delete(
            @PathVariable UUID wsId,
            @PathVariable UUID id,
            @PathVariable UUID attId,
            @AuthenticationPrincipal User user) {
        attachmentService.delete(wsId, id, attId, user);
        return ResponseEntity.noContent().build();
    }
}
