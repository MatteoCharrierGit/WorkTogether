package com.worktogether.dto.request;

import jakarta.validation.constraints.NotNull;

import java.util.UUID;

public record CreateDmRequest(
        @NotNull UUID userId
) {}
