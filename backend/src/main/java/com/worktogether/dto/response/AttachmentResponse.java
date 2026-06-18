package com.worktogether.dto.response;

import com.worktogether.domain.entity.Attachment;

import java.time.OffsetDateTime;
import java.util.UUID;

public record AttachmentResponse(
        UUID id,
        String filename,
        String contentType,
        long sizeBytes,
        UUID uploadedBy,
        OffsetDateTime createdAt
) {
    public static AttachmentResponse from(Attachment a) {
        return new AttachmentResponse(
                a.getId(),
                a.getFilename(),
                a.getContentType(),
                a.getSizeBytes(),
                a.getUploadedBy(),
                a.getCreatedAt()
        );
    }
}
