package com.worktogether.repository;

import com.worktogether.domain.entity.Message;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

public interface MessageRepository extends JpaRepository<Message, UUID> {

    // Tutti i messaggi di un canale in ordine cronologico (per l'export/backup).
    List<Message> findByChannelIdOrderByCreatedAtAsc(UUID channelId);

    // Pagina più recente di un canale (ordinata desc; il chiamante la inverte per la UI).
    @Query("""
        SELECT m FROM Message m JOIN FETCH m.author
        WHERE m.channel.id = :channelId
        ORDER BY m.createdAt DESC
    """)
    List<Message> findLatest(@Param("channelId") UUID channelId, Pageable pageable);

    // Pagina di messaggi precedenti a un cursore (per "carica precedenti").
    @Query("""
        SELECT m FROM Message m JOIN FETCH m.author
        WHERE m.channel.id = :channelId AND m.createdAt < :before
        ORDER BY m.createdAt DESC
    """)
    List<Message> findBefore(@Param("channelId") UUID channelId,
                             @Param("before") OffsetDateTime before,
                             Pageable pageable);

    // Ultimo messaggio di ciascun canale in UNA query: per ogni canale una sola probe all'indietro
    // sull'indice idx_messages_channel(channel_id, created_at) (LATERAL ... LIMIT 1).
    @Query(value = """
        SELECT lm.* FROM channels c
        CROSS JOIN LATERAL (
            SELECT m.* FROM messages m
            WHERE m.channel_id = c.id
            ORDER BY m.created_at DESC
            LIMIT 1
        ) lm
        WHERE c.id IN (:channelIds)
    """, nativeQuery = true)
    List<Message> findLastMessages(@Param("channelIds") java.util.Collection<UUID> channelIds);

    // Non-letti per canale in UNA query: messaggi non scritti dall'utente e successivi al suo
    // last_read_at (se assente — nessuna riga membro o mai letto — contano tutti).
    // Righe: [channel_id (UUID), conteggio (Number)].
    @Query(value = """
        SELECT c.id,
               (SELECT COUNT(*) FROM messages m
                 WHERE m.channel_id = c.id
                   AND m.author_id <> :userId
                   AND m.created_at > COALESCE(cm.last_read_at, CAST('-infinity' AS timestamptz))) AS unread
        FROM channels c
        LEFT JOIN channel_members cm ON cm.channel_id = c.id AND cm.user_id = :userId
        WHERE c.id IN (:channelIds)
    """, nativeQuery = true)
    List<Object[]> countUnreadByChannel(@Param("channelIds") java.util.Collection<UUID> channelIds,
                                        @Param("userId") UUID userId);
}
