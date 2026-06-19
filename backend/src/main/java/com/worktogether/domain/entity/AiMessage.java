package com.worktogether.domain.entity;

import com.worktogether.domain.enums.AiMessageRole;
import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.OffsetDateTime;
import java.util.UUID;

@Entity
@Table(name = "ai_messages")
@Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder
public class AiMessage {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "conversation_id", nullable = false)
    private UUID conversationId;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 12)
    private AiMessageRole role;

    @Column(columnDefinition = "text")
    private String content;

    // Chiamate tool richieste dall'assistant (usato da F3). JSON in colonna jsonb.
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "tool_calls", columnDefinition = "jsonb")
    private String toolCalls;

    @Column(name = "tool_call_id", length = 80)
    private String toolCallId;

    @Column(name = "author_user_id")
    private UUID authorUserId;

    @Builder.Default
    @Column(name = "token_count", nullable = false)
    private int tokenCount = 0;

    @Builder.Default
    @Column(nullable = false)
    private boolean archived = false;

    @Builder.Default
    @Column(name = "created_at", nullable = false, updatable = false)
    private OffsetDateTime createdAt = OffsetDateTime.now();
}
