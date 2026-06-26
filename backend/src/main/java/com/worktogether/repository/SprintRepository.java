package com.worktogether.repository;

import com.worktogether.domain.entity.Sprint;
import com.worktogether.domain.enums.SprintStatus;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface SprintRepository extends JpaRepository<Sprint, UUID> {

    @Query("SELECT s FROM Sprint s WHERE s.workspace.id = :workspaceId ORDER BY s.position ASC, s.createdAt ASC")
    List<Sprint> findByWorkspace(@Param("workspaceId") UUID workspaceId);

    @Query("SELECT s FROM Sprint s WHERE s.workspace.id = :workspaceId AND s.status = :status ORDER BY s.position ASC, s.createdAt ASC")
    List<Sprint> findByWorkspaceAndStatus(@Param("workspaceId") UUID workspaceId, @Param("status") SprintStatus status);

    @Query("SELECT s FROM Sprint s WHERE s.workspace.id = :workspaceId AND s.status = com.worktogether.domain.enums.SprintStatus.ACTIVE")
    Optional<Sprint> findActive(@Param("workspaceId") UUID workspaceId);
}
