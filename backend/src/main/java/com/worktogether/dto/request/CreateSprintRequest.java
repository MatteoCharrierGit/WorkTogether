package com.worktogether.dto.request;

import jakarta.validation.constraints.NotBlank;

import java.time.LocalDate;

public record CreateSprintRequest(
        @NotBlank String name,
        String goal,
        LocalDate startDate,
        LocalDate endDate
) {}
