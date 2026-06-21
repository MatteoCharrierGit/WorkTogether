package com.worktogether.dto.request;

import jakarta.validation.constraints.NotBlank;

import java.util.List;
import java.util.UUID;

public record CreateGroupRequest(
        @NotBlank String name,
        List<UUID> memberIds
) {}
