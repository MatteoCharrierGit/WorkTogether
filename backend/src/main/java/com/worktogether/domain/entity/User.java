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

    // Nullable: un utente creato dall'admin col solo username non ha email finché non
    // completa l'onboarding (verifica email + password).
    @Column(unique = true)
    private String email;

    // display_name è anche l'handle di login (univoco, vedi migration V16).
    @Column(name = "display_name", nullable = false, unique = true)
    private String displayName;

    // Nullable: assente finché l'utente non imposta la password in onboarding.
    @Column(name = "password_hash")
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

    // Sessione singola: incrementata a ogni login. Gli access token portano questa versione (claim
    // "sv"); se non combacia con quella corrente il token è di una sessione vecchia ⇒ rifiutato.
    @Builder.Default
    @Column(name = "token_version", nullable = false)
    private int tokenVersion = 0;

    @Builder.Default
    @Column(name = "created_at", nullable = false, updatable = false)
    private OffsetDateTime createdAt = OffsetDateTime.now();

    @UpdateTimestamp
    @Column(name = "updated_at")
    private OffsetDateTime updatedAt;
}
