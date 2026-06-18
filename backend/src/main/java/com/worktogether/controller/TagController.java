package com.worktogether.controller;

import com.worktogether.domain.entity.User;
import com.worktogether.dto.request.TagRequest;
import com.worktogether.dto.response.TagResponse;
import com.worktogether.service.TagService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.*;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

import java.util.*;

@RestController
@RequestMapping("/api/workspaces/{wsId}/tags")
@RequiredArgsConstructor
public class TagController {

    private final TagService tagService;

    @GetMapping
    public ResponseEntity<List<TagResponse>> list(
            @PathVariable UUID wsId,
            @AuthenticationPrincipal User user) {
        return ResponseEntity.ok(tagService.getTags(wsId, user));
    }

    @PostMapping
    public ResponseEntity<TagResponse> create(
            @PathVariable UUID wsId,
            @Valid @RequestBody TagRequest req,
            @AuthenticationPrincipal User user) {
        return ResponseEntity.status(HttpStatus.CREATED).body(tagService.createTag(wsId, req, user));
    }

    @PutMapping("/{tagId}")
    public ResponseEntity<TagResponse> update(
            @PathVariable UUID wsId,
            @PathVariable UUID tagId,
            @Valid @RequestBody TagRequest req,
            @AuthenticationPrincipal User user) {
        return ResponseEntity.ok(tagService.updateTag(wsId, tagId, req, user));
    }

    @DeleteMapping("/{tagId}")
    public ResponseEntity<Void> delete(
            @PathVariable UUID wsId,
            @PathVariable UUID tagId,
            @AuthenticationPrincipal User user) {
        tagService.deleteTag(wsId, tagId, user);
        return ResponseEntity.noContent().build();
    }
}
