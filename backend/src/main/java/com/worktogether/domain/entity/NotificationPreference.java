package com.worktogether.domain.entity;

import com.worktogether.domain.enums.NotificationType;
import jakarta.persistence.*;
import lombok.*;

import java.io.Serializable;
import java.util.UUID;

/** Preferenza per tipo di notifica in-app. Riga assente = tipo abilitato. */
@Entity
@Table(name = "notification_preferences")
@IdClass(NotificationPreference.Key.class)
@Getter @Setter @NoArgsConstructor @AllArgsConstructor
public class NotificationPreference {

    @Id
    @Column(name = "user_id")
    private UUID userId;

    @Id
    @Enumerated(EnumType.STRING)
    @Column(length = 30)
    private NotificationType type;

    @Column(nullable = false)
    private boolean enabled = true;

    @Data @NoArgsConstructor @AllArgsConstructor
    public static class Key implements Serializable {
        private UUID userId;
        private NotificationType type;
    }
}
