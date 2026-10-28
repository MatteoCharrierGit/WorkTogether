package com.worktogether.domain.enums;

/** Tipi di notifica in-app. MENTION è previsto per la chat (emesso da altri servizi tramite NotificationService.notify). */
public enum NotificationType {
    ASSIGNED,
    ELEMENT_STATUS,
    DUE_SOON,
    OVERDUE,
    SPRINT_STARTED,
    SPRINT_CLOSED,
    MENTION
}
