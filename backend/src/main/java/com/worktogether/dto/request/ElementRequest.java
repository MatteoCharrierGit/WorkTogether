package com.worktogether.dto.request;

import com.worktogether.domain.enums.ElementStatus;
import com.worktogether.domain.enums.ElementType;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

public record ElementRequest(
        @NotBlank String title,
        @NotNull ElementType type,
        UUID parentId,
        ElementStatus status,
        String body,
        OffsetDateTime startDate,
        OffsetDateTime endDate,
        Boolean allDay,
        Integer position,
        List<UUID> assigneeIds,
        List<UUID> tagIds
) {}
