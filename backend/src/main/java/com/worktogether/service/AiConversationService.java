package com.worktogether.service;

import com.worktogether.domain.entity.AiConversation;
import com.worktogether.domain.entity.User;
import com.worktogether.domain.enums.AiConversationScope;
import com.worktogether.domain.enums.WorkspaceRole;
import com.worktogether.dto.request.CreateConversationRequest;
import com.worktogether.dto.response.AiConversationResponse;
import com.worktogether.dto.response.AiMessageResponse;
import com.worktogether.repository.AiConversationRepository;
import com.worktogether.repository.AiMessageRepository;
import com.worktogether.repository.AiPendingActionRepository;
import jakarta.persistence.EntityNotFoundException;
import jakarta.transaction.Transactional;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

import java.util.List;
import java.util.UUID;

@Service
@RequiredArgsConstructor
public class AiConversationService {

    private final AiConversationRepository conversationRepository;
    private final AiMessageRepository messageRepository;
    private final AiPendingActionRepository pendingRepository;
    private final WorkspaceService workspaceService;

    public List<AiConversationResponse> list(UUID workspaceId, AiConversationScope scope, User user) {
        workspaceService.assertMember(workspaceId, user);
        List<AiConversation> convs = scope == AiConversationScope.PRIVATE
                ? conversationRepository.findByWorkspaceIdAndScopeAndOwnerUserIdOrderByUpdatedAtDesc(
                        workspaceId, AiConversationScope.PRIVATE, user.getId())
                : conversationRepository.findByWorkspaceIdAndScopeOrderByUpdatedAtDesc(
                        workspaceId, AiConversationScope.SHARED);
        return convs.stream().map(AiConversationResponse::from).toList();
    }

    @Transactional
    public AiConversationResponse create(UUID workspaceId, CreateConversationRequest req, User user) {
        workspaceService.assertMember(workspaceId, user);
        AiConversationScope scope = req.scope() != null ? req.scope() : AiConversationScope.PRIVATE;
        AiConversation conv = AiConversation.builder()
                .workspaceId(workspaceId)
                .scope(scope)
                .ownerUserId(scope == AiConversationScope.PRIVATE ? user.getId() : null)
                .title(req.title() != null && !req.title().isBlank() ? req.title().trim() : null)
                .build();
        return AiConversationResponse.from(conversationRepository.save(conv));
    }

    /** Recupera una conversazione verificando l'accesso (privata = solo proprietario). */
    public AiConversation getAccessible(UUID workspaceId, UUID conversationId, User user) {
        workspaceService.assertMember(workspaceId, user);
        AiConversation conv = conversationRepository.findByIdAndWorkspaceId(conversationId, workspaceId)
                .orElseThrow(() -> new EntityNotFoundException("Conversazione non trovata"));
        if (conv.getScope() == AiConversationScope.PRIVATE
                && !user.getId().equals(conv.getOwnerUserId())) {
            throw new AccessDeniedException("Conversazione privata di un altro utente");
        }
        return conv;
    }

    public List<AiMessageResponse> getMessages(UUID workspaceId, UUID conversationId, User user) {
        getAccessible(workspaceId, conversationId, user);
        return messageRepository.findByConversationIdOrderByCreatedAtAsc(conversationId).stream()
                // Mostra solo i messaggi utente e le risposte testuali dell'assistant;
                // i messaggi TOOL e quelli con sole chiamate tool restano interni.
                .filter(m -> m.getRole() == com.worktogether.domain.enums.AiMessageRole.USER
                        || m.getRole() == com.worktogether.domain.enums.AiMessageRole.ASSISTANT)
                .filter(m -> m.getContent() != null && !m.getContent().isBlank())
                .map(AiMessageResponse::from)
                .toList();
    }

    @Transactional
    public void delete(UUID workspaceId, UUID conversationId, User user) {
        AiConversation conv = getAccessible(workspaceId, conversationId, user);
        if (conv.getScope() == AiConversationScope.SHARED) {
            // Le conversazioni condivise può eliminarle solo un admin.
            WorkspaceRole role = workspaceService.getUserRole(workspaceId, user);
            if (role != WorkspaceRole.ADMIN) {
                throw new ResponseStatusException(HttpStatus.FORBIDDEN,
                        "Solo un admin può eliminare le conversazioni condivise");
            }
        }
        conversationRepository.delete(conv);
    }

    /**
     * Svuota la conversazione: elimina messaggi e azioni in attesa e azzera il riassunto,
     * mantenendo la conversazione stessa. Stessi permessi della delete (condivisa = solo admin).
     */
    @Transactional
    public void clear(UUID workspaceId, UUID conversationId, User user) {
        AiConversation conv = getAccessible(workspaceId, conversationId, user);
        if (conv.getScope() == AiConversationScope.SHARED) {
            WorkspaceRole role = workspaceService.getUserRole(workspaceId, user);
            if (role != WorkspaceRole.ADMIN) {
                throw new ResponseStatusException(HttpStatus.FORBIDDEN,
                        "Solo un admin può svuotare le conversazioni condivise");
            }
        }
        pendingRepository.deleteByConversationId(conversationId);
        messageRepository.deleteByConversationId(conversationId);
        conv.setSummary(null);
        conv.setSummarizedThrough(null);
        conversationRepository.save(conv);
    }
}
