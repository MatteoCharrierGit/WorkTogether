package com.worktogether.domain.entity;

import com.worktogether.domain.enums.VerificationPurpose;
import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.OffsetDateTime;
import java.util.UUID;

/**
 * Codice/token monouso legato a un utente. Usato per OTP (reset password, verifica email
 * in onboarding) e per il token opaco di sessione onboarding.
 */
@Entity
@Table(name = "verification_codes")
@Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder
public class VerificationCode {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "user_id", nullable = false)
    private User user;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 30)
    private VerificationPurpose purpose;

    // bcrypt dell'OTP, oppure token opaco (sessione onboarding).
    @Column(name = "code_hash", nullable = false)
    private String codeHash;

    // Dati associati (onboarding: {"email": "...", "passwordHash": "..."}).
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(columnDefinition = "jsonb")
    private String payload;

    @Column(name = "expires_at", nullable = false)
    private OffsetDateTime expiresAt;

    @Column(name = "consumed_at")
    private OffsetDateTime consumedAt;

    @Builder.Default
    @Column(nullable = false)
    private int attempts = 0;

    @Builder.Default
    @Column(name = "created_at", nullable = false, updatable = false)
    private OffsetDateTime createdAt = OffsetDateTime.now();
}
