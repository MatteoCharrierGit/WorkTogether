package com.worktogether.repository;

import com.worktogether.domain.entity.ChannelMember;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface ChannelMemberRepository extends JpaRepository<ChannelMember, UUID> {
    Optional<ChannelMember> findByChannelIdAndUserId(UUID channelId, UUID userId);
    List<ChannelMember> findByChannelId(UUID channelId);
    boolean existsByChannelIdAndUserId(UUID channelId, UUID userId);
    void deleteByChannelId(UUID channelId);

    // Cleanup alla rimozione di un membro: lo toglie da tutti i canali del workspace.
    @Modifying
    @Query("DELETE FROM ChannelMember cm WHERE cm.user.id = :userId " +
           "AND cm.channel.id IN (SELECT c.id FROM Channel c WHERE c.workspace.id = :workspaceId)")
    void removeUserFromWorkspaceChannels(UUID workspaceId, UUID userId);
}
