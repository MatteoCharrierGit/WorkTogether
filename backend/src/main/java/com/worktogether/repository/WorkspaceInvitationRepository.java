package com.worktogether.repository;

import com.worktogether.domain.entity.WorkspaceInvitation;
import com.worktogether.domain.enums.InvitationStatus;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface WorkspaceInvitationRepository extends JpaRepository<WorkspaceInvitation, UUID> {

    Optional<WorkspaceInvitation> findByToken(String token);

    List<WorkspaceInvitation> findByWorkspaceIdAndStatusOrderByCreatedAtDesc(UUID workspaceId, InvitationStatus status);

    Optional<WorkspaceInvitation> findByWorkspaceIdAndInvitedUserIdAndStatus(
            UUID workspaceId, UUID invitedUserId, InvitationStatus status);

    // Revoca gli inviti ancora pendenti per un utente in un workspace (es. dopo la rimozione).
    @Modifying
    @Query("UPDATE WorkspaceInvitation i SET i.status = com.worktogether.domain.enums.InvitationStatus.REVOKED " +
           "WHERE i.workspace.id = :workspaceId AND i.invitedUser.id = :userId AND i.status = com.worktogether.domain.enums.InvitationStatus.PENDING")
    void revokePendingForUser(UUID workspaceId, UUID userId);
}
