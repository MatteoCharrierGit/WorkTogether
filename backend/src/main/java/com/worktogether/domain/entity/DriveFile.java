package com.worktogether.domain.entity;

import jakarta.persistence.*;
import lombok.*;

import java.time.OffsetDateTime;
import java.util.UUID;

@Entity
@Table(name = "drive_files")
@Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder
public class DriveFile {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "workspace_id", nullable = false)
    private UUID workspaceId;

    // null = file alla radice del workspace
    @Column(name = "folder_id")
    private UUID folderId;

    @Column(nullable = false)
    private String filename;

    @Column(name = "stored_name", nullable = false)
    private String storedName;

    @Column(name = "content_type")
    private String contentType;

    @Column(name = "size_bytes", nullable = false)
    private long sizeBytes;

    @Column(name = "uploaded_by", nullable = false)
    private UUID uploadedBy;

    // Lock di modifica (anti-conflitto): chi sta editando e da quando.
    @Column(name = "locked_by")
    private UUID lockedBy;

    @Column(name = "locked_at")
    private OffsetDateTime lockedAt;

    // Se true (default), il file è modificabile/spostabile/eliminabile da tutti i membri non guest;
    // se false è in sola lettura per chi non è il proprietario o un admin.
    @Builder.Default
    @Column(name = "editable_by_all", nullable = false)
    private boolean editableByAll = true;

    @Builder.Default
    @Column(name = "created_at", nullable = false, updatable = false)
    private OffsetDateTime createdAt = OffsetDateTime.now();
}
