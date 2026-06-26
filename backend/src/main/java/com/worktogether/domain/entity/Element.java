package com.worktogether.domain.entity;

import com.worktogether.domain.enums.ElementStatus;
import com.worktogether.domain.enums.ElementType;
import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.annotations.UpdateTimestamp;
import org.hibernate.type.SqlTypes;

import java.time.OffsetDateTime;
import java.util.*;

@Entity
@Table(name = "elements")
@Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder
public class Element {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "workspace_id", nullable = false)
    private Workspace workspace;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "parent_id")
    private Element parent;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    private ElementType type;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    @Builder.Default
    private ElementStatus status = ElementStatus.DA_FARE;

    @Column(nullable = false, length = 500)
    private String title;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(columnDefinition = "jsonb")
    private String body;

    @Column(name = "start_date")
    private OffsetDateTime startDate;

    @Column(name = "end_date")
    private OffsetDateTime endDate;

    @Column(name = "all_day", nullable = false)
    @Builder.Default
    private boolean allDay = false;

    @Column(nullable = false)
    @Builder.Default
    private Integer position = 0;

    // Sprint a cui il task è assegnato (NULL = backlog generale). Solo i TASK vengono collegati.
    @Column(name = "sprint_id")
    private UUID sprintId;

    // Momento di completamento (status → COMPLETATO); usato per la timeline della sprint.
    @Column(name = "completed_at")
    private OffsetDateTime completedAt;

    // Indicatore di task bloccante.
    @Column(name = "is_blocked", nullable = false)
    @Builder.Default
    private boolean blocked = false;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "created_by", nullable = false)
    private User createdBy;

    @Builder.Default
    @Column(name = "created_at", nullable = false, updatable = false)
    private OffsetDateTime createdAt = OffsetDateTime.now();

    @UpdateTimestamp
    @Column(name = "updated_at")
    private OffsetDateTime updatedAt;

    @Version
    private Integer version;

    @ManyToMany(fetch = FetchType.LAZY)
    @JoinTable(name = "element_tags",
               joinColumns = @JoinColumn(name = "element_id"),
               inverseJoinColumns = @JoinColumn(name = "tag_id"))
    @Builder.Default
    private Set<Tag> tags = new HashSet<>();

    @ManyToMany(fetch = FetchType.LAZY)
    @JoinTable(name = "element_assignees",
               joinColumns = @JoinColumn(name = "element_id"),
               inverseJoinColumns = @JoinColumn(name = "user_id"))
    @Builder.Default
    private Set<User> assignees = new HashSet<>();
}
