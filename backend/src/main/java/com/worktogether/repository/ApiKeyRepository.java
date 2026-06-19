package com.worktogether.repository;

import com.worktogether.domain.entity.ApiKey;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface ApiKeyRepository extends JpaRepository<ApiKey, UUID> {
    Optional<ApiKey> findByKeyHash(String keyHash);
    List<ApiKey> findByWorkspaceIdOrderByCreatedAtDesc(UUID workspaceId);
    Optional<ApiKey> findByIdAndWorkspaceId(UUID id, UUID workspaceId);
}
