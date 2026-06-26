package com.worktogether.domain.enums;

public enum SprintStatus {
    PLANNED,  // pianificata, non ancora avviata
    ACTIVE,   // in corso (al massimo una per workspace)
    CLOSED    // chiusa dall'admin
}
