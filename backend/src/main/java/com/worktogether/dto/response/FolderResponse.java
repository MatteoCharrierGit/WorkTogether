package com.worktogether.dto.response;

import com.worktogether.domain.entity.Folder;

import java.time.OffsetDateTime;
import java.util.UUID;

public record FolderResponse(
        UUID id,
        UUID parentId,
        String name,
        UUID createdBy,
        OffsetDateTime createdAt,
        boolean editableByAll
) {
    public static FolderResponse from(Folder f) {
        return new FolderResponse(f.getId(), f.getParentId(), f.getName(), f.getCreatedBy(),
                f.getCreatedAt(), f.isEditableByAll());
    }
}
