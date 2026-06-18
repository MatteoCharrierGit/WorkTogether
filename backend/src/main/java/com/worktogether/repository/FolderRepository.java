package com.worktogether.repository;

import com.worktogether.domain.entity.Folder;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.UUID;

public interface FolderRepository extends JpaRepository<Folder, UUID> {
    List<Folder> findByWorkspaceIdAndParentIdOrderByNameAsc(UUID workspaceId, UUID parentId);
    List<Folder> findByWorkspaceIdAndParentIdIsNullOrderByNameAsc(UUID workspaceId);
    long countByParentId(UUID parentId);
}
