package com.worktogether.domain.entity;

import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.UpdateTimestamp;

import java.io.Serializable;
import java.time.OffsetDateTime;
import java.util.UUID;

/**
 * Impostazioni AI per singolo membro, decise dall'admin del workspace: modello assegnato
 * (per provider) e override dei limiti d'uso. I campi null = default del workspace.
 */
@Entity
@Table(name = "ai_user_settings")
@IdClass(AiUserSettings.Key.class)
@Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder
public class AiUserSettings {

    @Id
    @Column(name = "workspace_id")
    private UUID workspaceId;

    @Id
    @Column(name = "user_id")
    private UUID userId;

    @Column(name = "openrouter_model", length = 120)
    private String openrouterModel;

    @Column(name = "anthropic_model", length = 120)
    private String anthropicModel;

    @Column(name = "rate_per_minute")
    private Integer ratePerMinute;

    @Column(name = "rate_per_day")
    private Integer ratePerDay;

    @UpdateTimestamp
    @Column(name = "updated_at", nullable = false)
    private OffsetDateTime updatedAt;

    public boolean isEmpty() {
        return openrouterModel == null && anthropicModel == null && ratePerMinute == null && ratePerDay == null;
    }

    @Getter @Setter @NoArgsConstructor @AllArgsConstructor @EqualsAndHashCode
    public static class Key implements Serializable {
        private UUID workspaceId;
        private UUID userId;
    }
}
