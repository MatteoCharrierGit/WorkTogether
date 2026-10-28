package com.worktogether.repository;

import com.worktogether.domain.entity.AiUserSettings;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface AiUserSettingsRepository extends JpaRepository<AiUserSettings, AiUserSettings.Key> {
    Optional<AiUserSettings> findByWorkspaceIdAndUserId(UUID workspaceId, UUID userId);
    List<AiUserSettings> findByWorkspaceId(UUID workspaceId);
}
