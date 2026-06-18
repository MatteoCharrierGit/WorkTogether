package com.worktogether.dto.response;

import com.worktogether.domain.entity.DriveFile;

import java.time.OffsetDateTime;
import java.util.UUID;

public record DriveFileResponse(
        UUID id,
        UUID folderId,
        String filename,
        String contentType,
        long sizeBytes,
        UUID uploadedBy,
        OffsetDateTime createdAt,
        UUID lockedBy,
        OffsetDateTime lockedAt
) {
    public static DriveFileResponse from(DriveFile f) {
        return new DriveFileResponse(
                f.getId(), f.getFolderId(), f.getFilename(),
                f.getContentType(), f.getSizeBytes(), f.getUploadedBy(), f.getCreatedAt(),
                f.getLockedBy(), f.getLockedAt());
    }
}
