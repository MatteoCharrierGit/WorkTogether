package com.worktogether.repository;

import com.worktogether.domain.entity.AiPendingAction;
import com.worktogether.domain.enums.AiPendingActionStatus;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.UUID;

public interface AiPendingActionRepository extends JpaRepository<AiPendingAction, UUID> {
    List<AiPendingAction> findByConversationIdAndStatusOrderByCreatedAtAsc(UUID conversationId, AiPendingActionStatus status);
    void deleteByConversationId(UUID conversationId);

    /**
     * Transizione atomica di stato (es. PENDING → CONFIRMED): ritorna 1 solo per chi "vince" la gara tra
     * conferma e annullamento automatico, 0 se l'azione era già stata gestita/annullata.
     */
    @Transactional
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("update AiPendingAction p set p.status = :to where p.id = :id and p.status = :from")
    int transition(@Param("id") UUID id, @Param("from") AiPendingActionStatus from, @Param("to") AiPendingActionStatus to);
}
