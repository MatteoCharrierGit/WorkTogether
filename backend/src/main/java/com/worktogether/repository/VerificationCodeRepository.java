package com.worktogether.repository;

import com.worktogether.domain.entity.VerificationCode;
import com.worktogether.domain.enums.VerificationPurpose;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;

import java.util.Optional;
import java.util.UUID;

public interface VerificationCodeRepository extends JpaRepository<VerificationCode, UUID> {

    Optional<VerificationCode> findByCodeHash(String codeHash);

    Optional<VerificationCode> findFirstByUserIdAndPurposeAndConsumedAtIsNullOrderByCreatedAtDesc(
            UUID userId, VerificationPurpose purpose);

    // Invalida i codici pendenti dello stesso scopo: un nuovo invio sostituisce i precedenti.
    @Modifying
    @Query("DELETE FROM VerificationCode v WHERE v.user.id = :userId AND v.purpose = :purpose AND v.consumedAt IS NULL")
    void deletePendingByUserAndPurpose(UUID userId, VerificationPurpose purpose);
}
