package com.worktogether.repository;

import com.worktogether.domain.entity.UserAvatar;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.UUID;

public interface UserAvatarRepository extends JpaRepository<UserAvatar, UUID> {
}
