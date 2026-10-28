package com.worktogether.repository;

import com.worktogether.domain.entity.WorkspaceMember;
import com.worktogether.domain.enums.WorkspaceRole;
import org.springframework.data.jpa.repository.EntityGraph;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface WorkspaceMemberRepository extends JpaRepository<WorkspaceMember, UUID> {
    Optional<WorkspaceMember> findByWorkspaceIdAndUserId(UUID workspaceId, UUID userId);
    // Utente caricato insieme alla membership (MemberResponse, destinatari email, export).
    @EntityGraph(attributePaths = "user")
    List<WorkspaceMember> findByWorkspaceId(UUID workspaceId);

    // Workspace dell'utente con il suo ruolo, in un'unica query (lista workspace della sidebar).
    @Query("SELECT m FROM WorkspaceMember m JOIN FETCH m.workspace w WHERE m.user.id = :userId ORDER BY w.name")
    List<WorkspaceMember> findByUserIdWithWorkspace(@Param("userId") UUID userId);
    boolean existsByWorkspaceIdAndUserIdAndRole(UUID workspaceId, UUID userId, WorkspaceRole role);
    long countByUserId(UUID userId);
}
