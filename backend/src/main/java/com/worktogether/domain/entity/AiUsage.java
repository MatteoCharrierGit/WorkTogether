package com.worktogether.domain.entity;

import jakarta.persistence.*;
import lombok.*;

import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.UUID;

/** Consumi IA giornalieri per (workspace, utente). user_id null = automazioni del workspace. */
@Entity
@Table(name = "ai_usage")
@Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder
public class AiUsage {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "workspace_id", nullable = false)
    private UUID workspaceId;

    @Column(name = "user_id")
    private UUID userId;

    @Column(nullable = false)
    private LocalDate day;

    @Column(nullable = false)
    private int requests;

    @Column(name = "input_tokens", nullable = false)
    private long inputTokens;

    @Column(name = "output_tokens", nullable = false)
    private long outputTokens;

    @Column(name = "cache_read_tokens", nullable = false)
    private long cacheReadTokens;

    @Column(name = "updated_at", nullable = false)
    private OffsetDateTime updatedAt;
}
