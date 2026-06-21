package com.worktogether.repository;

import com.worktogether.domain.entity.ChannelMember;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface ChannelMemberRepository extends JpaRepository<ChannelMember, UUID> {
    Optional<ChannelMember> findByChannelIdAndUserId(UUID channelId, UUID userId);
    List<ChannelMember> findByChannelId(UUID channelId);
    boolean existsByChannelIdAndUserId(UUID channelId, UUID userId);
    void deleteByChannelId(UUID channelId);
}
