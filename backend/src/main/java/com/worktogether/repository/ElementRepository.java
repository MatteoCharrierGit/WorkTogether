package com.worktogether.repository;

import com.worktogether.domain.entity.Element;
import com.worktogether.domain.enums.ElementStatus;
import com.worktogether.domain.enums.ElementType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import java.util.List;
import java.util.UUID;

public interface ElementRepository extends JpaRepository<Element, UUID> {

    // Cleanup alla rimozione di un membro: stacca l'utente dagli assegnatari di tutti gli
    // elementi del workspace (la cascade DB scatta solo cancellando l'utente, non la membership).
    @Modifying
    @Query(value = "DELETE FROM element_assignees ea USING elements e " +
            "WHERE ea.element_id = e.id AND e.workspace_id = :workspaceId AND ea.user_id = :userId",
            nativeQuery = true)
    void removeAssigneeFromWorkspace(UUID workspaceId, UUID userId);

    @Query("SELECT e FROM Element e WHERE e.workspace.id = :workspaceId AND e.type = :type ORDER BY e.position ASC, e.createdAt ASC")
    List<Element> findByWorkspaceIdAndType(UUID workspaceId, ElementType type);

    @Query("SELECT e FROM Element e WHERE e.workspace.id = :workspaceId AND e.status <> :status ORDER BY e.position ASC, e.createdAt ASC")
    List<Element> findByWorkspaceIdExcludingStatus(UUID workspaceId, ElementStatus status);

    @Query("SELECT e FROM Element e WHERE e.parent.id = :parentId ORDER BY e.position ASC, e.createdAt ASC")
    List<Element> findByParentId(UUID parentId);

    @Query("SELECT DISTINCT e FROM Element e JOIN e.assignees a WHERE a.id = :userId ORDER BY e.endDate ASC, e.createdAt DESC")
    List<Element> findByAssigneeId(UUID userId);

    @Query("SELECT e FROM Element e WHERE e.workspace.id = :workspaceId ORDER BY e.position ASC, e.createdAt ASC")
    List<Element> findByWorkspaceId(UUID workspaceId);

    // ---- Sprint ----

    @Query("SELECT e FROM Element e WHERE e.sprintId = :sprintId ORDER BY e.position ASC, e.createdAt ASC")
    List<Element> findBySprintId(UUID sprintId);

    long countBySprintId(UUID sprintId);

    long countBySprintIdAndStatus(UUID sprintId, ElementStatus status);

    // Task della sprint non ancora completati né archiviati (da gestire alla chiusura).
    @Query("""
        SELECT e FROM Element e
        WHERE e.sprintId = :sprintId
          AND e.status NOT IN (com.worktogether.domain.enums.ElementStatus.COMPLETATO,
                               com.worktogether.domain.enums.ElementStatus.ARCHIVIATO)
    """)
    List<Element> findIncompleteBySprintId(UUID sprintId);

    @Query("""
        SELECT COUNT(e) FROM Element e
        WHERE e.parent.id IN (
            SELECT s.id FROM Element s WHERE s.parent.id = :epicId
        )
        AND e.type = com.worktogether.domain.enums.ElementType.TASK
    """)
    long countTasksByEpicId(UUID epicId);

    @Query("""
        SELECT COUNT(e) FROM Element e
        WHERE e.parent.id IN (
            SELECT s.id FROM Element s WHERE s.parent.id = :epicId
        )
        AND e.type = com.worktogether.domain.enums.ElementType.TASK
        AND e.status = com.worktogether.domain.enums.ElementStatus.COMPLETATO
    """)
    long countCompletedTasksByEpicId(UUID epicId);
}
