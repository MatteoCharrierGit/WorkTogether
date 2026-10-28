package com.worktogether.repository;

import com.worktogether.domain.entity.Notification;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface NotificationRepository extends JpaRepository<Notification, UUID> {

    // Lista paginata a cursore (createdAt < before). L'attore è caricato subito (serve nel DTO).
    @Query("""
        SELECT n FROM Notification n LEFT JOIN FETCH n.actor
        WHERE n.userId = :userId
          AND (:unreadOnly = false OR n.readAt IS NULL)
          AND n.createdAt < :before
        ORDER BY n.createdAt DESC
    """)
    List<Notification> findPage(UUID userId, boolean unreadOnly, OffsetDateTime before, Pageable pageable);

    long countByUserIdAndReadAtIsNull(UUID userId);

    Optional<Notification> findByIdAndUserId(UUID id, UUID userId);

    @Modifying
    @Query("UPDATE Notification n SET n.readAt = :now WHERE n.userId = :userId AND n.readAt IS NULL")
    int markAllRead(UUID userId, OffsetDateTime now);

    @Modifying
    @Query("DELETE FROM Notification n WHERE n.createdAt < :cutoff")
    int deleteOlderThan(OffsetDateTime cutoff);
}
