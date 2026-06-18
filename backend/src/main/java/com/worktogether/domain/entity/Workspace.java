package com.worktogether.domain.entity;

import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.UpdateTimestamp;

import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

@Entity
@Table(name = "workspaces")
@Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder
public class Workspace {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(nullable = false)
    private String name;

    private String description;

    // Foto profilo del workspace (data URI)
    @Column(columnDefinition = "text")
    private String avatar;

    // Impostazioni: quali info mostrare nelle card della Kanban
    @Builder.Default
    @Column(name = "card_show_tags", nullable = false)
    private boolean cardShowTags = true;

    @Builder.Default
    @Column(name = "card_show_assignees", nullable = false)
    private boolean cardShowAssignees = true;

    @Builder.Default
    @Column(name = "card_show_due_date", nullable = false)
    private boolean cardShowDueDate = true;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "created_by", nullable = false)
    private User createdBy;

    @Builder.Default
    @Column(name = "created_at", nullable = false, updatable = false)
    private OffsetDateTime createdAt = OffsetDateTime.now();

    @UpdateTimestamp
    @Column(name = "updated_at")
    private OffsetDateTime updatedAt;

    @OneToMany(mappedBy = "workspace", cascade = CascadeType.ALL, orphanRemoval = true)
    @Builder.Default
    private List<WorkspaceMember> members = new ArrayList<>();
}
