package com.worktogether.repository;

import com.worktogether.domain.entity.Attachment;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.UUID;

public interface AttachmentRepository extends JpaRepository<Attachment, UUID> {
    List<Attachment> findByElementIdOrderByCreatedAtAsc(UUID elementId);
}
