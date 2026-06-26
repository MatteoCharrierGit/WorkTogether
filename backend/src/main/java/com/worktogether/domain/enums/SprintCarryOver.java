package com.worktogether.domain.enums;

/** Destinazione dei task incompleti alla chiusura di una sprint. */
public enum SprintCarryOver {
    BACKLOG,      // riportati nel backlog generale (sprint_id = null)
    NEXT_SPRINT   // spostati in una sprint pianificata successiva
}
