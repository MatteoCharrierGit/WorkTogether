package com.worktogether.repository;

import com.worktogether.domain.entity.DriveFile;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.UUID;

public interface DriveFileRepository extends JpaRepository<DriveFile, UUID> {
    List<DriveFile> findByWorkspaceIdAndFolderIdOrderByFilenameAsc(UUID workspaceId, UUID folderId);
    List<DriveFile> findByWorkspaceIdAndFolderIdIsNullOrderByFilenameAsc(UUID workspaceId);
    long countByFolderId(UUID folderId);
}
