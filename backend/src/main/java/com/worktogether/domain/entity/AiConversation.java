package com.worktogether.domain.entity;

import com.worktogether.domain.enums.AiConversationScope;
import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.UpdateTimestamp;

import java.time.OffsetDateTime;
import java.util.UUID;

@Entity
@Table(name = "ai_conversations")
@Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder
public class AiConversation {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "workspace_id", nullable = false)
    private UUID workspaceId;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 10)
    private AiConversationScope scope;

    // null se SHARED
    @Column(name = "owner_user_id")
    private UUID ownerUserId;

    @Column(length = 255)
    private String title;

    // Riassunto progressivo (compacting) — usato da F5
    @Column(columnDefinition = "text")
    private String summary;

    @Column(name = "summarized_through")
    private UUID summarizedThrough;

    @Builder.Default
    @Column(name = "created_at", nullable = false, updatable = false)
    private OffsetDateTime createdAt = OffsetDateTime.now();

    @UpdateTimestamp
    @Column(name = "updated_at", nullable = false)
    private OffsetDateTime updatedAt;
}
