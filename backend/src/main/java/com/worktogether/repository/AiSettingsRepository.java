package com.worktogether.repository;

import com.worktogether.domain.entity.AiSettings;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.UUID;

public interface AiSettingsRepository extends JpaRepository<AiSettings, UUID> {
}
