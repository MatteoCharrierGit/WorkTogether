package com.worktogether.service;

import com.worktogether.domain.entity.Tag;
import com.worktogether.domain.entity.User;
import com.worktogether.domain.entity.Workspace;
import com.worktogether.domain.enums.WorkspaceRole;
import com.worktogether.dto.request.TagRequest;
import com.worktogether.dto.response.TagResponse;
import com.worktogether.repository.TagRepository;
import com.worktogether.repository.WorkspaceRepository;
import jakarta.persistence.EntityNotFoundException;
import jakarta.transaction.Transactional;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

import java.util.List;
import java.util.UUID;

@Service
@RequiredArgsConstructor
public class TagService {

    private final TagRepository tagRepository;
    private final WorkspaceRepository workspaceRepository;
    private final WorkspaceService workspaceService;

    public List<TagResponse> getTags(UUID workspaceId, User user) {
        workspaceService.assertMember(workspaceId, user);
        return tagRepository.findByWorkspaceIdOrderByNameAsc(workspaceId)
                .stream().map(TagResponse::from).toList();
    }

    @Transactional
    public TagResponse createTag(UUID workspaceId, TagRequest req, User user) {
        workspaceService.assertRole(workspaceId, user, WorkspaceRole.ADMIN);
        if (tagRepository.existsByWorkspaceIdAndName(workspaceId, req.name())) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Tag already exists");
        }
        Workspace ws = workspaceRepository.findById(workspaceId)
                .orElseThrow(() -> new EntityNotFoundException("Workspace not found"));
        Tag tag = Tag.builder()
                .workspace(ws)
                .name(req.name())
                .color(req.color() != null ? req.color() : "#94a3b8")
                .build();
        return TagResponse.from(tagRepository.save(tag));
    }

    @Transactional
    public TagResponse updateTag(UUID workspaceId, UUID tagId, TagRequest req, User user) {
        workspaceService.assertRole(workspaceId, user, WorkspaceRole.ADMIN);
        Tag tag = tagRepository.findById(tagId)
                .orElseThrow(() -> new EntityNotFoundException("Tag not found"));
        if (!tag.getWorkspace().getId().equals(workspaceId)) {
            throw new EntityNotFoundException("Tag not found in workspace");
        }
        tag.setName(req.name());
        if (req.color() != null) tag.setColor(req.color());
        return TagResponse.from(tagRepository.save(tag));
    }

    @Transactional
    public void deleteTag(UUID workspaceId, UUID tagId, User user) {
        workspaceService.assertRole(workspaceId, user, WorkspaceRole.ADMIN);
        Tag tag = tagRepository.findById(tagId)
                .orElseThrow(() -> new EntityNotFoundException("Tag not found"));
        if (!tag.getWorkspace().getId().equals(workspaceId)) {
            throw new EntityNotFoundException("Tag not found in workspace");
        }
        tagRepository.delete(tag);
    }
}
