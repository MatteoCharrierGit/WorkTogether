package com.worktogether.service;

import com.worktogether.domain.entity.Channel;
import com.worktogether.domain.entity.Element;
import com.worktogether.domain.entity.Sprint;
import com.worktogether.domain.entity.User;
import com.worktogether.domain.entity.Workspace;
import com.worktogether.domain.enums.ElementStatus;
import com.worktogether.domain.enums.ElementType;
import com.worktogether.domain.enums.SprintCarryOver;
import com.worktogether.domain.enums.SprintStatus;
import com.worktogether.domain.enums.WorkspaceRole;
import com.worktogether.dto.request.CloseSprintRequest;
import com.worktogether.dto.request.CreateSprintRequest;
import com.worktogether.dto.request.UpdateSprintRequest;
import com.worktogether.dto.response.ElementResponse;
import com.worktogether.dto.response.SprintDetailResponse;
import com.worktogether.dto.response.SprintResponse;
import com.worktogether.repository.ChannelRepository;
import com.worktogether.repository.ElementRepository;
import com.worktogether.repository.SprintRepository;
import com.worktogether.repository.WorkspaceRepository;
import com.worktogether.websocket.WorkspaceEventPublisher;
import jakarta.persistence.EntityNotFoundException;
import jakarta.transaction.Transactional;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;
import java.util.UUID;

@Service
@RequiredArgsConstructor
public class SprintService {

    private final SprintRepository sprintRepository;
    private final ElementRepository elementRepository;
    private final ChannelRepository channelRepository;
    private final WorkspaceRepository workspaceRepository;
    private final WorkspaceService workspaceService;
    private final ChannelService channelService;
    private final WorkspaceEventPublisher eventPublisher;

    // ---------------------------------------------------------------- Lettura

    @Transactional
    public List<SprintResponse> list(UUID workspaceId, User user) {
        workspaceService.assertMember(workspaceId, user);
        return sprintRepository.findByWorkspace(workspaceId).stream().map(this::toResponse).toList();
    }

    /** Sprint attiva con i suoi task. {@code sprint} è null se non c'è alcuna sprint attiva. */
    @Transactional
    public SprintDetailResponse getActive(UUID workspaceId, User user) {
        workspaceService.assertMember(workspaceId, user);
        return sprintRepository.findActive(workspaceId)
                .map(this::toDetail)
                .orElseGet(() -> new SprintDetailResponse(null, List.of()));
    }

    @Transactional
    public SprintDetailResponse getOne(UUID workspaceId, UUID sprintId, User user) {
        workspaceService.assertMember(workspaceId, user);
        return toDetail(load(workspaceId, sprintId));
    }

    // ---------------------------------------------------------------- Planning (admin)

    @Transactional
    public SprintResponse create(UUID workspaceId, CreateSprintRequest req, User user) {
        workspaceService.assertRole(workspaceId, user, WorkspaceRole.ADMIN);
        validateDates(req.startDate(), req.endDate());
        Workspace ws = workspaceRepository.getReferenceById(workspaceId);
        int nextPos = sprintRepository.findByWorkspace(workspaceId).stream()
                .mapToInt(s -> s.getPosition() == null ? 0 : s.getPosition())
                .max().orElse(-1) + 1;
        Sprint sprint = Sprint.builder()
                .workspace(ws)
                .name(req.name().trim())
                .goal(req.goal())
                .startDate(req.startDate())
                .endDate(req.endDate())
                .status(SprintStatus.PLANNED)
                .position(nextPos)
                .createdBy(user)
                .build();
        sprint = sprintRepository.save(sprint);
        notifySprintChanged(workspaceId);
        return toResponse(sprint);
    }

    @Transactional
    public SprintResponse update(UUID workspaceId, UUID sprintId, UpdateSprintRequest req, User user) {
        workspaceService.assertRole(workspaceId, user, WorkspaceRole.ADMIN);
        Sprint sprint = load(workspaceId, sprintId);
        if (sprint.getStatus() == SprintStatus.CLOSED) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Una sprint chiusa non è modificabile");
        }
        if (req.name() != null && !req.name().isBlank()) sprint.setName(req.name().trim());
        if (req.goal() != null) sprint.setGoal(req.goal());
        if (req.startDate() != null) sprint.setStartDate(req.startDate());
        if (req.endDate() != null) sprint.setEndDate(req.endDate());
        if (req.position() != null) sprint.setPosition(req.position());
        validateDates(sprint.getStartDate(), sprint.getEndDate());
        sprintRepository.save(sprint);
        notifySprintChanged(workspaceId);
        return toResponse(sprint);
    }

    @Transactional
    public void delete(UUID workspaceId, UUID sprintId, User user) {
        workspaceService.assertRole(workspaceId, user, WorkspaceRole.ADMIN);
        Sprint sprint = load(workspaceId, sprintId);
        if (sprint.getStatus() != SprintStatus.PLANNED) {
            throw new ResponseStatusException(HttpStatus.CONFLICT,
                    "Solo le sprint pianificate possono essere eliminate: chiudi prima la sprint attiva");
        }
        // Stacca eventuali task pre-assegnati (tornano al backlog generale).
        for (Element e : elementRepository.findBySprintId(sprintId)) {
            e.setSprintId(null);
            elementRepository.save(e);
        }
        sprintRepository.delete(sprint);
        notifySprintChanged(workspaceId);
    }

    // ---------------------------------------------------------------- Transizioni di stato (admin)

    @Transactional
    public SprintResponse start(UUID workspaceId, UUID sprintId, User user) {
        workspaceService.assertRole(workspaceId, user, WorkspaceRole.ADMIN);
        Sprint sprint = load(workspaceId, sprintId);
        if (sprint.getStatus() != SprintStatus.PLANNED) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Solo una sprint pianificata può essere avviata");
        }
        // Avvio singolo: non deve esserci già una sprint attiva (garantito anche dall'indice unico parziale).
        if (sprintRepository.findActive(workspaceId).isPresent()) {
            throw new ResponseStatusException(HttpStatus.CONFLICT,
                    "C'è già una sprint attiva: chiudila prima di avviarne un'altra");
        }
        sprint.setStatus(SprintStatus.ACTIVE);
        sprint.setActualStartAt(OffsetDateTime.now());
        sprintRepository.save(sprint);
        // Crea la chat dedicata (idempotente).
        if (channelRepository.findBySprintId(sprintId).isEmpty()) {
            channelService.createSprintChannel(workspaceId, sprintId, sprint.getName(), user);
        }
        notifySprintChanged(workspaceId);
        return toResponse(sprint);
    }

    @Transactional
    public SprintResponse close(UUID workspaceId, UUID sprintId, CloseSprintRequest req, User user) {
        workspaceService.assertRole(workspaceId, user, WorkspaceRole.ADMIN);
        Sprint sprint = load(workspaceId, sprintId);
        if (sprint.getStatus() != SprintStatus.ACTIVE) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Solo la sprint attiva può essere chiusa");
        }
        SprintCarryOver carry = req.carryOver() != null ? req.carryOver() : SprintCarryOver.BACKLOG;
        UUID targetSprintId = (carry == SprintCarryOver.NEXT_SPRINT)
                ? resolveTargetSprint(workspaceId, sprintId, req.targetSprintId())
                : null;

        // Gestione dei task incompleti: BACKLOG → sprint_id null, NEXT_SPRINT → sprint successiva.
        // I task completati mantengono sprint_id (storico/timeline della sprint chiusa).
        for (Element e : elementRepository.findIncompleteBySprintId(sprintId)) {
            e.setSprintId(targetSprintId);
            elementRepository.save(e);
        }

        sprint.setStatus(SprintStatus.CLOSED);
        sprint.setActualEndAt(OffsetDateTime.now());
        if (req.retrospective() != null) sprint.setRetrospectiveMd(req.retrospective());
        sprintRepository.save(sprint);

        notifySprintChanged(workspaceId);
        // I task spostati cambiano colonna nella Kanban: forza il refresh della board.
        eventPublisher.publish(workspaceId, "ELEMENT_UPDATED", Map.of("reason", "sprint_closed"));
        return toResponse(sprint);
    }

    // ---------------------------------------------------------------- Gestione task (collaboratore+)

    @Transactional
    public void addTask(UUID workspaceId, UUID sprintId, UUID elementId, User user) {
        assertCanManageTasks(workspaceId, user);
        Sprint sprint = load(workspaceId, sprintId);
        if (sprint.getStatus() == SprintStatus.CLOSED) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Non si possono aggiungere task a una sprint chiusa");
        }
        Element e = loadTask(workspaceId, elementId);
        if (e.getType() != ElementType.TASK) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Solo i task possono essere aggiunti a una sprint");
        }
        e.setSprintId(sprintId);
        elementRepository.save(e);
        notifySprintChanged(workspaceId);
        eventPublisher.publish(workspaceId, "ELEMENT_UPDATED", ElementResponse.from(e));
    }

    @Transactional
    public void removeTask(UUID workspaceId, UUID sprintId, UUID elementId, User user) {
        assertCanManageTasks(workspaceId, user);
        Element e = loadTask(workspaceId, elementId);
        if (!sprintId.equals(e.getSprintId())) {
            throw new EntityNotFoundException("Il task non appartiene a questa sprint");
        }
        e.setSprintId(null);
        elementRepository.save(e);
        notifySprintChanged(workspaceId);
        eventPublisher.publish(workspaceId, "ELEMENT_UPDATED", ElementResponse.from(e));
    }

    // ---------------------------------------------------------------- Helpers

    private void assertCanManageTasks(UUID workspaceId, User user) {
        WorkspaceRole role = workspaceService.getUserRole(workspaceId, user);
        if (role == WorkspaceRole.GUEST) {
            throw new AccessDeniedException("I guest non possono modificare la sprint");
        }
    }

    private UUID resolveTargetSprint(UUID workspaceId, UUID closingSprintId, UUID requested) {
        Sprint target;
        if (requested != null) {
            target = load(workspaceId, requested);
        } else {
            target = sprintRepository.findByWorkspaceAndStatus(workspaceId, SprintStatus.PLANNED).stream()
                    .findFirst()
                    .orElseThrow(() -> new ResponseStatusException(HttpStatus.BAD_REQUEST,
                            "Nessuna sprint successiva pianificata: creane una oppure riporta i task nel backlog"));
        }
        if (target.getId().equals(closingSprintId)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "La sprint di destinazione non può essere quella in chiusura");
        }
        if (target.getStatus() != SprintStatus.PLANNED) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "I task possono essere spostati solo in una sprint pianificata");
        }
        return target.getId();
    }

    private void validateDates(java.time.LocalDate start, java.time.LocalDate end) {
        if (start != null && end != null && end.isBefore(start)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "La data di fine non può precedere quella di inizio");
        }
    }

    private Sprint load(UUID workspaceId, UUID sprintId) {
        Sprint s = sprintRepository.findById(sprintId)
                .orElseThrow(() -> new EntityNotFoundException("Sprint non trovata"));
        if (!s.getWorkspace().getId().equals(workspaceId)) {
            throw new EntityNotFoundException("Sprint non trovata");
        }
        return s;
    }

    private Element loadTask(UUID workspaceId, UUID elementId) {
        Element e = elementRepository.findById(elementId)
                .orElseThrow(() -> new EntityNotFoundException("Task non trovato"));
        if (!e.getWorkspace().getId().equals(workspaceId)) {
            throw new EntityNotFoundException("Task non trovato");
        }
        return e;
    }

    private SprintDetailResponse toDetail(Sprint sprint) {
        List<ElementResponse> tasks = elementRepository.findBySprintId(sprint.getId()).stream()
                .map(ElementResponse::from)
                .toList();
        return new SprintDetailResponse(toResponse(sprint), tasks);
    }

    private SprintResponse toResponse(Sprint sprint) {
        long total = elementRepository.countBySprintId(sprint.getId());
        long completed = elementRepository.countBySprintIdAndStatus(sprint.getId(), ElementStatus.COMPLETATO);
        UUID channelId = channelRepository.findBySprintId(sprint.getId()).map(Channel::getId).orElse(null);
        return SprintResponse.from(sprint, total, completed, channelId);
    }

    private void notifySprintChanged(UUID workspaceId) {
        eventPublisher.publish(workspaceId, "SPRINT_CHANGED", Map.of());
    }
}
