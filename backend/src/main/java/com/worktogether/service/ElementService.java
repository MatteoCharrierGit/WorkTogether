package com.worktogether.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.worktogether.domain.entity.*;
import com.worktogether.domain.enums.*;
import com.worktogether.dto.request.ElementRequest;
import com.worktogether.dto.response.ElementResponse;
import com.worktogether.repository.*;
import com.worktogether.websocket.WorkspaceEventPublisher;
import jakarta.persistence.EntityNotFoundException;
import jakarta.transaction.Transactional;
import lombok.RequiredArgsConstructor;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.stereotype.Service;

import java.time.OffsetDateTime;
import java.util.*;

@Service
@RequiredArgsConstructor
public class ElementService {

    private final ElementRepository elementRepository;
    private final WorkspaceRepository workspaceRepository;
    private final UserRepository userRepository;
    private final TagRepository tagRepository;
    private final WorkspaceService workspaceService;
    private final WorkspaceEventPublisher eventPublisher;
    private final ObjectMapper objectMapper;

    @Transactional
    public List<ElementResponse> getElements(UUID workspaceId, User user) {
        workspaceService.assertMember(workspaceId, user);
        return elementRepository.findByWorkspaceId(workspaceId)
                .stream()
                .map(e -> {
                    Integer progress = null;
                    if (e.getType() == ElementType.EPICA) {
                        progress = calcProgress(e.getId());
                    }
                    return ElementResponse.from(e, progress);
                }).toList();
    }

    // Tutti gli elementi assegnati all'utente, attraverso tutti i workspace.
    public List<ElementResponse> getAssignedToUser(User user) {
        return elementRepository.findByAssigneeId(user.getId())
                .stream()
                .map(e -> {
                    Integer progress = e.getType() == ElementType.EPICA ? calcProgress(e.getId()) : null;
                    return ElementResponse.from(e, progress);
                }).toList();
    }

    @Transactional
    public ElementResponse createElement(UUID workspaceId, ElementRequest req, User user) {
        WorkspaceRole role = workspaceService.getUserRole(workspaceId, user);
        if (role == WorkspaceRole.GUEST) throw new AccessDeniedException("Guests cannot create elements");
        if (req.type() == ElementType.EPICA && role != WorkspaceRole.ADMIN) {
            throw new AccessDeniedException("Only admins can create Epics");
        }

        Workspace ws = workspaceRepository.findById(workspaceId)
                .orElseThrow(() -> new EntityNotFoundException("Workspace not found"));
        Element parent = null;
        if (req.parentId() != null) {
            parent = elementRepository.findById(req.parentId())
                    .orElseThrow(() -> new EntityNotFoundException("Parent not found"));
        }

        // Anti-duplicato per i caricamenti via API: un'integrazione esterna che ri-sincronizza
        // ricrea spesso le stesse EPICHE/STORIE (per titolo). Invece di duplicarle, riusiamo
        // quella già presente (stesso titolo, e per le storie lo stesso padre) così i figli
        // finiscono sotto l'elemento esistente. Vale solo per le richieste autenticate via API key:
        // dalla UI un utente resta libero di creare elementi con lo stesso titolo.
        if (isApiKeyRequest() && (req.type() == ElementType.EPICA || req.type() == ElementType.STORIA)) {
            Element existing = findExistingContainer(workspaceId, req.type(), req.title(),
                    parent != null ? parent.getId() : null);
            if (existing != null) {
                Integer progress = existing.getType() == ElementType.EPICA ? calcProgress(existing.getId()) : null;
                return ElementResponse.from(existing, progress);
            }
        }

        Set<Tag> tags = new HashSet<>();
        if (req.tagIds() != null) {
            tags.addAll(tagRepository.findAllById(req.tagIds()));
        }
        Set<User> assignees = new HashSet<>();
        if (req.assigneeIds() != null) {
            assignees.addAll(userRepository.findAllById(req.assigneeIds()));
        }

        ElementStatus status = req.status() != null ? req.status() : ElementStatus.DA_FARE;
        Element element = Element.builder()
                .workspace(ws)
                .parent(parent)
                .type(req.type())
                .status(status)
                .completedAt(status == ElementStatus.COMPLETATO ? OffsetDateTime.now() : null)
                .blocked(req.blocked() != null ? req.blocked() : false)
                .title(req.title())
                .body(normalizeBody(req.body()))
                .startDate(req.startDate())
                .endDate(req.endDate())
                .allDay(req.allDay() != null ? req.allDay() : false)
                .position(req.position() != null ? req.position() : 0)
                .createdBy(user)
                .tags(tags)
                .assignees(assignees)
                .build();

        element = elementRepository.save(element);

        // Se il nuovo elemento finisce sotto una storia/epica già contrassegnata come COMPLETATO,
        // quel ramo non è più davvero concluso: riattiviamo gli antenati completati (IN_CORSO) così
        // non restano "completati" pur avendo lavoro nuovo aperto sotto di sé.
        reactivateCompletedAncestors(parent, workspaceId);

        ElementResponse response = ElementResponse.from(element);
        eventPublisher.publish(workspaceId, "ELEMENT_CREATED", response);
        return response;
    }

    // Cerca un'EPICA/STORIA già esistente con lo stesso titolo (case-insensitive) e, per le storie,
    // sotto lo stesso padre. Restituisce la più vecchia (la "canonica") oppure null se non esiste.
    private Element findExistingContainer(UUID workspaceId, ElementType type, String title, UUID parentId) {
        if (title == null) return null;
        String wanted = title.trim();
        return elementRepository.findByWorkspaceIdAndType(workspaceId, type).stream()
                .filter(e -> e.getTitle() != null && e.getTitle().trim().equalsIgnoreCase(wanted))
                .filter(e -> {
                    if (type != ElementType.STORIA) return true; // le epiche stanno alla radice
                    UUID existingParent = e.getParent() != null ? e.getParent().getId() : null;
                    return Objects.equals(existingParent, parentId);
                })
                .min(Comparator.comparing(Element::getCreatedAt))
                .orElse(null);
    }

    // True se la richiesta corrente è autenticata via API key (vedi ApiKeyAuthFilter).
    private boolean isApiKeyRequest() {
        try {
            var attrs = org.springframework.web.context.request.RequestContextHolder.getRequestAttributes();
            if (attrs instanceof org.springframework.web.context.request.ServletRequestAttributes sra) {
                return sra.getRequest().getAttribute(
                        com.worktogether.security.ApiKeyAuthFilter.ATTR_API_KEY) != null;
            }
        } catch (Exception ignored) {
            // fuori da un contesto web (es. test): trattiamo come richiesta non-API
        }
        return false;
    }

    // Risale la catena dei padri e riporta a IN_CORSO ogni antenato che risulta COMPLETATO,
    // azzerando completedAt. Pubblica un ELEMENT_UPDATED per ciascuno così la UI si aggiorna.
    private void reactivateCompletedAncestors(Element parent, UUID workspaceId) {
        Element ancestor = parent;
        while (ancestor != null) {
            if (ancestor.getStatus() == ElementStatus.COMPLETATO) {
                ancestor.setStatus(ElementStatus.IN_CORSO);
                ancestor.setCompletedAt(null);
                ancestor = elementRepository.save(ancestor);
                Integer progress = ancestor.getType() == ElementType.EPICA ? calcProgress(ancestor.getId()) : null;
                eventPublisher.publish(workspaceId, "ELEMENT_UPDATED", ElementResponse.from(ancestor, progress));
            }
            ancestor = ancestor.getParent();
        }
    }

    @Transactional
    public ElementResponse getElement(UUID workspaceId, UUID elementId, User user) {
        workspaceService.assertMember(workspaceId, user);
        Element element = findInWorkspace(workspaceId, elementId);
        Integer progress = element.getType() == ElementType.EPICA ? calcProgress(elementId) : null;
        return ElementResponse.from(element, progress);
    }

    @Transactional
    public ElementResponse updateElement(UUID workspaceId, UUID elementId, ElementRequest req, User user) {
        WorkspaceRole role = workspaceService.getUserRole(workspaceId, user);
        if (role == WorkspaceRole.GUEST) throw new AccessDeniedException("Guests cannot modify elements");

        Element element = findInWorkspace(workspaceId, elementId);

        if (req.type() == ElementType.EPICA && role != WorkspaceRole.ADMIN) {
            throw new AccessDeniedException("Only admins can modify Epics");
        }
        if ((element.getType() == ElementType.STORIA || element.getType() == ElementType.EVENTO)
                && req.title() != null && role == WorkspaceRole.GUEST) {
            throw new AccessDeniedException("Guests cannot modify elements");
        }

        if (req.title() != null) element.setTitle(req.title());
        if (req.body() != null) element.setBody(normalizeBody(req.body()));
        if (req.status() != null) applyStatus(element, req.status());
        if (req.blocked() != null) element.setBlocked(req.blocked());
        if (req.startDate() != null) element.setStartDate(req.startDate());
        if (req.endDate() != null) element.setEndDate(req.endDate());
        if (req.allDay() != null) {
            element.setAllDay(req.allDay());
            // Giornata intera: un solo giorno, nessuna data di fine.
            if (req.allDay()) element.setEndDate(null);
        }
        if (req.position() != null) element.setPosition(req.position());

        if (req.parentId() != null) {
            Element parent = elementRepository.findById(req.parentId())
                    .orElseThrow(() -> new EntityNotFoundException("Parent not found"));
            element.setParent(parent);
        }
        if (req.tagIds() != null) {
            element.setTags(new HashSet<>(tagRepository.findAllById(req.tagIds())));
        }
        if (req.assigneeIds() != null) {
            element.setAssignees(new HashSet<>(userRepository.findAllById(req.assigneeIds())));
        }

        element = elementRepository.save(element);
        Integer progress = element.getType() == ElementType.EPICA ? calcProgress(elementId) : null;
        ElementResponse response = ElementResponse.from(element, progress);
        eventPublisher.publish(workspaceId, "ELEMENT_UPDATED", response);
        return response;
    }

    // Applica un cambio di stato gestendo completed_at: lo valorizza quando il task diventa
    // COMPLETATO (se non già impostato), lo azzera se torna in qualsiasi altro stato. Usato anche
    // dalla timeline della sprint.
    private void applyStatus(Element element, ElementStatus newStatus) {
        element.setStatus(newStatus);
        if (newStatus == ElementStatus.COMPLETATO) {
            if (element.getCompletedAt() == null) element.setCompletedAt(OffsetDateTime.now());
        } else {
            element.setCompletedAt(null);
        }
    }

    @Transactional
    public void deleteElement(UUID workspaceId, UUID elementId, User user) {
        WorkspaceRole role = workspaceService.getUserRole(workspaceId, user);
        Element element = findInWorkspace(workspaceId, elementId);

        boolean isOwner = element.getCreatedBy().getId().equals(user.getId());
        boolean isAdmin = role == WorkspaceRole.ADMIN;
        if (!isAdmin && !isOwner) throw new AccessDeniedException("Cannot delete others' elements");
        if ((element.getType() == ElementType.EPICA || element.getType() == ElementType.STORIA) && !isAdmin) {
            throw new AccessDeniedException("Only admins can delete Epics and Stories");
        }

        elementRepository.delete(element);
        eventPublisher.publish(workspaceId, "ELEMENT_DELETED", Map.of("id", elementId));
    }

    /**
     * Normalizza il campo body: se è già JSON dell'editor (oggetto/array) lo lascia invariato;
     * se è testo semplice (es. inviato da un'integrazione esterna) lo avvolge in un documento
     * compatibile con l'editor, così viene salvato correttamente nella colonna jsonb e mostrato.
     */
    private String normalizeBody(String body) {
        if (body == null) return null;
        String trimmed = body.trim();
        if (trimmed.isEmpty()) return null;
        try {
            JsonNode node = objectMapper.readTree(trimmed);
            if (node.isObject() || node.isArray()) return trimmed; // già JSON editor
        } catch (JsonProcessingException ignored) {
            // non è JSON: lo trattiamo come testo semplice
        }
        return wrapPlainText(body);
    }

    private String wrapPlainText(String text) {
        ObjectNode doc = objectMapper.createObjectNode();
        doc.put("type", "doc");
        ArrayNode content = doc.putArray("content");
        // Una riga = un paragrafo; le righe vuote diventano paragrafi vuoti.
        for (String line : text.split("\n", -1)) {
            ObjectNode para = content.addObject();
            para.put("type", "paragraph");
            if (!line.isEmpty()) {
                ObjectNode textNode = para.putArray("content").addObject();
                textNode.put("type", "text");
                textNode.put("text", line);
            }
        }
        try {
            return objectMapper.writeValueAsString(doc);
        } catch (JsonProcessingException e) {
            return null;
        }
    }

    private Element findInWorkspace(UUID workspaceId, UUID elementId) {
        Element e = elementRepository.findById(elementId)
                .orElseThrow(() -> new EntityNotFoundException("Element not found"));
        if (!e.getWorkspace().getId().equals(workspaceId)) {
            throw new AccessDeniedException("Element not in workspace");
        }
        return e;
    }

    private Integer calcProgress(UUID epicId) {
        long total = elementRepository.countTasksByEpicId(epicId);
        if (total == 0) return 0;
        long completed = elementRepository.countCompletedTasksByEpicId(epicId);
        return (int) Math.round((double) completed / total * 100);
    }
}
