package com.worktogether.domain.entity;

import com.worktogether.domain.enums.AiPendingActionStatus;
import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.OffsetDateTime;
import java.util.UUID;

@Entity
@Table(name = "ai_pending_actions")
@Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder
public class AiPendingAction {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "conversation_id", nullable = false)
    private UUID conversationId;

    @Column(name = "tool_call_id", length = 80)
    private String toolCallId;

    @Column(name = "tool_name", nullable = false, length = 80)
    private String toolName;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(nullable = false, columnDefinition = "jsonb")
    private String arguments;

    @Builder.Default
    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 12)
    private AiPendingActionStatus status = AiPendingActionStatus.PENDING;

    @Builder.Default
    @Column(name = "created_at", nullable = false, updatable = false)
    private OffsetDateTime createdAt = OffsetDateTime.now();
}
