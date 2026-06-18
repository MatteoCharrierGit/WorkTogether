package com.worktogether.dto.request;

import jakarta.validation.constraints.NotBlank;

public record TagRequest(
        @NotBlank String name,
        String color
) {}
