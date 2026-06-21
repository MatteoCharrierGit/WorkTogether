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
        SELECT m FROM Message m
        WHERE m.channel.id = :channelId
        ORDER BY m.createdAt DESC
    """)
    List<Message> findLatest(@Param("channelId") UUID channelId, Pageable pageable);

    // Pagina di messaggi precedenti a un cursore (per "carica precedenti").
    @Query("""
        SELECT m FROM Message m
        WHERE m.channel.id = :channelId AND m.createdAt < :before
        ORDER BY m.createdAt DESC
    """)
    List<Message> findBefore(@Param("channelId") UUID channelId,
                             @Param("before") OffsetDateTime before,
                             Pageable pageable);

    // Conteggio non-letti: messaggi dopo lastReadAt non scritti dall'utente stesso.
    @Query("""
        SELECT COUNT(m) FROM Message m
        WHERE m.channel.id = :channelId
          AND m.author.id <> :userId
          AND m.createdAt > :lastReadAt
    """)
    long countUnreadSince(@Param("channelId") UUID channelId,
                          @Param("userId") UUID userId,
                          @Param("lastReadAt") OffsetDateTime lastReadAt);

    // Variante senza lastReadAt: tutti i messaggi non scritti dall'utente sono non-letti.
    // Tenuta separata per non passare un parametro NULL a Postgres (errore 42P18 in "IS NULL").
    @Query("""
        SELECT COUNT(m) FROM Message m
        WHERE m.channel.id = :channelId
          AND m.author.id <> :userId
    """)
    long countUnreadAll(@Param("channelId") UUID channelId,
                        @Param("userId") UUID userId);

    // Ultimo messaggio di un canale (per la preview nella lista conversazioni).
    @Query("""
        SELECT m FROM Message m
        WHERE m.channel.id = :channelId
        ORDER BY m.createdAt DESC
    """)
    List<Message> findLastMessage(@Param("channelId") UUID channelId, Pageable pageable);
}
