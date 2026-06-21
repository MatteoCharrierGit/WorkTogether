package com.worktogether.domain.entity;

import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.UpdateTimestamp;

import java.time.OffsetDateTime;
import java.util.UUID;

@Entity
@Table(name = "users")
@Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder
public class User {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(nullable = false, unique = true)
    private String email;

    @Column(name = "display_name", nullable = false)
    private String displayName;

    @Column(name = "password_hash", nullable = false)
    private String passwordHash;

    @Column(name = "must_reset_password", nullable = false)
    private boolean mustResetPassword = true;

    @Column(name = "is_system_admin", nullable = false)
    private boolean systemAdmin = false;

    // Tour di benvenuto già visto: mostrato solo al primo accesso assoluto.
    @Column(name = "onboarding_completed", nullable = false)
    private boolean onboardingCompleted = false;

    // Foto profilo come data URI (es. "data:image/jpeg;base64,...")
    @Column(columnDefinition = "text")
    private String avatar;

    @Builder.Default
    @Column(name = "created_at", nullable = false, updatable = false)
    private OffsetDateTime createdAt = OffsetDateTime.now();

    @UpdateTimestamp
    @Column(name = "updated_at")
    private OffsetDateTime updatedAt;
}
