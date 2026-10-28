package com.worktogether.repository;

import com.worktogether.domain.entity.AiUsage;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

public interface AiUsageRepository extends JpaRepository<AiUsage, Long> {

    /** Incrementa atomicamente il contatore richieste del giorno e ritorna il nuovo valore. */
    @Query(value = """
            INSERT INTO ai_usage (workspace_id, user_id, day, requests)
            VALUES (:ws, :userId, :day, 1)
            ON CONFLICT ON CONSTRAINT ai_usage_ws_user_day_uq
            DO UPDATE SET requests = ai_usage.requests + 1, updated_at = NOW()
            RETURNING requests""", nativeQuery = true)
    int incrementRequests(@Param("ws") UUID workspaceId, @Param("userId") UUID userId, @Param("day") LocalDate day);

    @Modifying
    @Query(value = """
            UPDATE ai_usage SET requests = GREATEST(requests - 1, 0), updated_at = NOW()
            WHERE workspace_id = :ws AND user_id IS NOT DISTINCT FROM :userId AND day = :day""", nativeQuery = true)
    int decrementRequests(@Param("ws") UUID workspaceId, @Param("userId") UUID userId, @Param("day") LocalDate day);

    @Modifying
    @Query(value = """
            INSERT INTO ai_usage (workspace_id, user_id, day, input_tokens, output_tokens, cache_read_tokens)
            VALUES (:ws, :userId, :day, :in, :out, :cache)
            ON CONFLICT ON CONSTRAINT ai_usage_ws_user_day_uq
            DO UPDATE SET input_tokens = ai_usage.input_tokens + :in,
                          output_tokens = ai_usage.output_tokens + :out,
                          cache_read_tokens = ai_usage.cache_read_tokens + :cache,
                          updated_at = NOW()""", nativeQuery = true)
    int addTokens(@Param("ws") UUID workspaceId, @Param("userId") UUID userId, @Param("day") LocalDate day,
                  @Param("in") long inputTokens, @Param("out") long outputTokens, @Param("cache") long cacheReadTokens);

    @Query(value = """
            SELECT COALESCE(SUM(requests), 0) FROM ai_usage
            WHERE workspace_id = :ws AND user_id IS NOT DISTINCT FROM :userId AND day = :day""", nativeQuery = true)
    int requestsOn(@Param("ws") UUID workspaceId, @Param("userId") UUID userId, @Param("day") LocalDate day);

    List<AiUsage> findByWorkspaceIdAndDayGreaterThanEqualOrderByDayAsc(UUID workspaceId, LocalDate from);
}
