package com.worktogether.repository;

import com.worktogether.domain.entity.NotificationPreference;
import com.worktogether.domain.enums.NotificationType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

import java.util.Collection;
import java.util.List;
import java.util.UUID;

public interface NotificationPreferenceRepository
        extends JpaRepository<NotificationPreference, NotificationPreference.Key> {

    List<NotificationPreference> findByUserId(UUID userId);

    // Utenti (tra quelli indicati) che hanno disattivato il tipo: una query per tutti i destinatari.
    @Query("SELECT p.userId FROM NotificationPreference p WHERE p.userId IN :userIds AND p.type = :type AND p.enabled = false")
    List<UUID> findDisabledUserIds(Collection<UUID> userIds, NotificationType type);
}
