package com.worktogether.repository;

import com.worktogether.domain.entity.AiConversation;
import com.worktogether.domain.enums.AiConversationScope;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface AiConversationRepository extends JpaRepository<AiConversation, UUID> {
    Optional<AiConversation> findByIdAndWorkspaceId(UUID id, UUID workspaceId);
    List<AiConversation> findByWorkspaceIdAndScopeOrderByUpdatedAtDesc(UUID workspaceId, AiConversationScope scope);
    List<AiConversation> findByWorkspaceIdAndScopeAndOwnerUserIdOrderByUpdatedAtDesc(
            UUID workspaceId, AiConversationScope scope, UUID ownerUserId);

    // Cleanup alla rimozione di un membro: elimina le sue conversazioni AI personali nel workspace.
    @Modifying
    @Query("DELETE FROM AiConversation c WHERE c.workspaceId = :workspaceId AND c.ownerUserId = :userId")
    void deleteByWorkspaceIdAndOwnerUserId(UUID workspaceId, UUID userId);
}
