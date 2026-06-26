package com.worktogether.dto.request;

import com.worktogether.domain.enums.SprintCarryOver;

import java.util.UUID;

public record CloseSprintRequest(
        String retrospective,
        SprintCarryOver carryOver,   // default BACKLOG se assente
        UUID targetSprintId          // richiesto/opzionale quando carryOver = NEXT_SPRINT
) {}
