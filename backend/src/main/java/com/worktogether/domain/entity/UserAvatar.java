package com.worktogether.domain.entity;

import jakarta.persistence.*;
import lombok.*;

import java.time.OffsetDateTime;
import java.util.UUID;

/** Byte della foto profilo di un utente (servita da GET /api/users/{id}/avatar). */
@Entity
@Table(name = "user_avatars")
@Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder
public class UserAvatar {

    @Id
    @Column(name = "user_id")
    private UUID userId;

    @Column(name = "content_type", nullable = false, length = 100)
    private String contentType;

    @Column(name = "data", nullable = false, columnDefinition = "bytea")
    private byte[] data;

    @Builder.Default
    @Column(name = "updated_at", nullable = false)
    private OffsetDateTime updatedAt = OffsetDateTime.now();
}
