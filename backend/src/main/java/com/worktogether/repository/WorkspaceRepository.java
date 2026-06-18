package com.worktogether.repository;

import com.worktogether.domain.entity.Workspace;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import java.util.List;
import java.util.UUID;

public interface WorkspaceRepository extends JpaRepository<Workspace, UUID> {

    @Query("SELECT w FROM Workspace w JOIN w.members m WHERE m.user.id = :userId ORDER BY w.name")
    List<Workspace> findByMemberUserId(UUID userId);
}
