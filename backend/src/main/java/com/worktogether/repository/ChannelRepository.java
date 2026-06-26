package com.worktogether.repository;

import com.worktogether.domain.entity.Channel;
import com.worktogether.domain.enums.ChannelType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.UUID;

public interface ChannelRepository extends JpaRepository<Channel, UUID> {

    // Id del workspace di un canale (proiezione: evita il lazy-load della relazione, usata dal
    // webhook LiveKit che conosce solo room=channelId).
    @Query("SELECT c.workspace.id FROM Channel c WHERE c.id = :channelId")
    java.util.Optional<UUID> findWorkspaceIdById(@Param("channelId") UUID channelId);

    // ROOM pubbliche del workspace (accessibili a tutti i membri, senza riga in channel_members).
    @Query("""
        SELECT c FROM Channel c
        WHERE c.workspace.id = :workspaceId
          AND c.type = com.worktogether.domain.enums.ChannelType.ROOM
          AND c.isPrivate = false
        ORDER BY c.name ASC
    """)
    List<Channel> findPublicRooms(@Param("workspaceId") UUID workspaceId);

    // Canali (di qualsiasi tipo) del workspace di cui l'utente è membro esplicito.
    @Query("""
        SELECT c FROM Channel c
        WHERE c.workspace.id = :workspaceId
          AND c.id IN (SELECT m.channel.id FROM ChannelMember m WHERE m.user.id = :userId)
        ORDER BY c.updatedAt DESC
    """)
    List<Channel> findMemberChannels(@Param("workspaceId") UUID workspaceId, @Param("userId") UUID userId);

    // Tutte le ROOM del workspace (per la gestione admin).
    @Query("""
        SELECT c FROM Channel c
        WHERE c.workspace.id = :workspaceId
          AND c.type = com.worktogether.domain.enums.ChannelType.ROOM
        ORDER BY c.name ASC
    """)
    List<Channel> findRooms(@Param("workspaceId") UUID workspaceId);

    // DM 1:1 esistente tra due utenti nello stesso workspace (entrambi membri del channel).
    @Query("""
        SELECT c FROM Channel c
        WHERE c.workspace.id = :workspaceId
          AND c.type = com.worktogether.domain.enums.ChannelType.DM
          AND (SELECT COUNT(m) FROM ChannelMember m WHERE m.channel.id = c.id) = 2
          AND EXISTS (SELECT 1 FROM ChannelMember m1 WHERE m1.channel.id = c.id AND m1.user.id = :userA)
          AND EXISTS (SELECT 1 FROM ChannelMember m2 WHERE m2.channel.id = c.id AND m2.user.id = :userB)
    """)
    List<Channel> findDmBetween(@Param("workspaceId") UUID workspaceId,
                                @Param("userA") UUID userA,
                                @Param("userB") UUID userB);

    List<Channel> findByWorkspaceIdAndType(UUID workspaceId, ChannelType type);

    // Canale chat dedicato a una sprint (type = SPRINT).
    java.util.Optional<Channel> findBySprintId(UUID sprintId);

    // Tutti i canali del workspace (per l'export/backup).
    List<Channel> findByWorkspaceId(UUID workspaceId);
}
