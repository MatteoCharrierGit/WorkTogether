package com.worktogether.dto.request;

import java.time.LocalDate;

public record UpdateSprintRequest(
        String name,
        String goal,
        LocalDate startDate,
        LocalDate endDate,
        Integer position
) {}
