package com.worktogether.repository;

import com.worktogether.domain.entity.AiPendingAction;
import com.worktogether.domain.enums.AiPendingActionStatus;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.UUID;

public interface AiPendingActionRepository extends JpaRepository<AiPendingAction, UUID> {
    List<AiPendingAction> findByConversationIdAndStatusOrderByCreatedAtAsc(UUID conversationId, AiPendingActionStatus status);
    void deleteByConversationId(UUID conversationId);
}
