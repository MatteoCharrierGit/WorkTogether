package com.worktogether.service;

import com.worktogether.domain.entity.*;
import com.worktogether.domain.enums.WorkspaceRole;
import com.worktogether.dto.request.*;
import com.worktogether.dto.response.*;
import com.worktogether.repository.*;
import jakarta.persistence.EntityNotFoundException;
import jakarta.transaction.Transactional;
import lombok.RequiredArgsConstructor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.web.server.ResponseStatusException;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.*;
import java.util.stream.Stream;

@Service
@RequiredArgsConstructor
public class WorkspaceService {

    private static final Logger log = LoggerFactory.getLogger(WorkspaceService.class);

    private final WorkspaceRepository workspaceRepository;
    private final WorkspaceMemberRepository memberRepository;
    private final UserRepository userRepository;
    private final PasswordEncoder passwordEncoder;
    private final ElementRepository elementRepository;
    private final ChannelMemberRepository channelMemberRepository;
    private final AiConversationRepository aiConversationRepository;
    private final WorkspaceInvitationRepository invitationRepository;
    private final com.worktogether.websocket.WorkspaceEventPublisher eventPublisher;

    @Value("${app.upload.dir}")
    private String uploadDir;

    public List<WorkspaceResponse> getUserWorkspaces(User user) {
        return workspaceRepository.findByMemberUserId(user.getId()).stream()
                .map(w -> {
                    WorkspaceRole role = memberRepository
                            .findByWorkspaceIdAndUserId(w.getId(), user.getId())
                            .map(WorkspaceMember::getRole)
                            .orElse(WorkspaceRole.GUEST);
                    return WorkspaceResponse.from(w, role);
                }).toList();
    }

    @Transactional
    public WorkspaceResponse createWorkspace(User user, CreateWorkspaceRequest req) {
        if (!user.isSystemAdmin()) throw new AccessDeniedException("Only system admins can create workspaces");
        Workspace ws = Workspace.builder()
                .name(req.name())
                .description(req.description())
                .createdBy(user)
                .build();
        ws = workspaceRepository.save(ws);
        WorkspaceMember member = WorkspaceMember.builder()
                .workspace(ws)
                .user(user)
                .role(WorkspaceRole.ADMIN)
                .build();
        memberRepository.save(member);
        return WorkspaceResponse.from(ws, WorkspaceRole.ADMIN);
    }

    // @Transactional: serve a tenere aperta la sessione anche quando il metodo è
    // invocato fuori da una richiesta HTTP (es. dal thread di background dell'agente
    // o dalle automazioni), così il caricamento lazy di member.getUser() non fallisce.
    @Transactional
    public List<MemberResponse> getMembers(UUID workspaceId, User requester) {
        assertMember(workspaceId, requester);
        return memberRepository.findByWorkspaceId(workspaceId).stream()
                .map(MemberResponse::from).toList();
    }

    @Transactional
    public MemberResponse addMember(UUID workspaceId, UUID userId, WorkspaceRole role, User requester) {
        assertRole(workspaceId, requester, WorkspaceRole.ADMIN);
        Workspace ws = workspaceRepository.findById(workspaceId)
                .orElseThrow(() -> new EntityNotFoundException("Workspace not found"));
        User target = userRepository.findById(userId)
                .orElseThrow(() -> new EntityNotFoundException("User not found"));
        WorkspaceMember member = memberRepository
                .findByWorkspaceIdAndUserId(workspaceId, userId)
                .orElseGet(() -> WorkspaceMember.builder().workspace(ws).user(target).build());
        member.setRole(role);
        return MemberResponse.from(memberRepository.save(member));
    }

    @Transactional
    public void updateRole(UUID workspaceId, UUID userId, WorkspaceRole role, User requester) {
        assertRole(workspaceId, requester, WorkspaceRole.ADMIN);
        WorkspaceMember member = memberRepository.findByWorkspaceIdAndUserId(workspaceId, userId)
                .orElseThrow(() -> new EntityNotFoundException("Member not found"));
        member.setRole(role);
        memberRepository.save(member);
    }

    /**
     * Rimozione sicura di un membro dal workspace con detach bidirezionale:
     * - il workspace perde gli accessi/riferimenti diretti dell'utente (membership, assegnazioni
     *   sui task, appartenenza ai canali, conversazioni AI personali, inviti pendenti);
     * - l'utente perde il workspace dalla propria vista (membership cancellata).
     * I riferimenti storici globali (created_by/uploaded_by/author) restano validi: l'utente
     * continua a esistere a livello di sistema, quindi nessun record orfano.
     * Se questa era l'ultima membership dell'utente, display_name/email vengono liberati
     * (rinominati con un suffisso univoco) così l'username può essere riusato per un nuovo account,
     * senza cancellare la riga e quindi senza rompere i riferimenti storici.
     * Non è consentito rimuovere l'ultimo ADMIN del workspace.
     */
    @Transactional
    public void removeMember(UUID workspaceId, UUID userId, User requester) {
        assertRole(workspaceId, requester, WorkspaceRole.ADMIN);
        WorkspaceMember member = memberRepository.findByWorkspaceIdAndUserId(workspaceId, userId).orElse(null);
        if (member == null) return; // idempotente: già non membro

        if (member.getRole() == WorkspaceRole.ADMIN) {
            long admins = memberRepository.findByWorkspaceId(workspaceId).stream()
                    .filter(m -> m.getRole() == WorkspaceRole.ADMIN)
                    .count();
            if (admins <= 1) {
                throw new ResponseStatusException(HttpStatus.CONFLICT,
                        "Impossibile rimuovere l'unico amministratore del workspace");
            }
        }

        // Pulizia dei riferimenti per-workspace (nessuno di questi cade in cascade rimuovendo la membership).
        elementRepository.removeAssigneeFromWorkspace(workspaceId, userId);
        channelMemberRepository.removeUserFromWorkspaceChannels(workspaceId, userId);
        aiConversationRepository.deleteByWorkspaceIdAndOwnerUserId(workspaceId, userId);
        invitationRepository.revokePendingForUser(workspaceId, userId);

        memberRepository.delete(member);

        if (memberRepository.countByUserId(userId) == 0) {
            freeDisplayNameAndEmail(userId);
        }

        // Notifica realtime DOPO il commit: il client dell'utente rimosso esce subito dal
        // workspace e, rifacendo la lista, legge lo stato già aggiornato (niente race).
        publishAfterCommit(workspaceId, "MEMBER_REMOVED", Map.of("userId", userId.toString()));
    }

    // Suffisso basato sull'id (sempre univoco per costruzione) per liberare display_name/email
    // senza rischiare collisioni con altri utenti rinominati nello stesso momento.
    private void freeDisplayNameAndEmail(UUID userId) {
        userRepository.findById(userId).ifPresent(orphan -> {
            String suffix = "__removed_" + userId;
            orphan.setDisplayName(orphan.getDisplayName() + suffix);
            if (orphan.getEmail() != null) {
                orphan.setEmail(orphan.getEmail() + suffix);
            }
            userRepository.save(orphan);
        });
    }

    @Transactional
    public UserResponse createUser(UUID workspaceId, CreateUserRequest req, User requester) {
        assertRole(workspaceId, requester, WorkspaceRole.ADMIN);

        String displayName = req.displayName().trim();
        // display_name è l'handle di login: deve essere univoco.
        if (userRepository.existsByDisplayName(displayName)) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Username già in uso");
        }
        String email = (req.email() != null && !req.email().isBlank()) ? req.email().trim().toLowerCase() : null;
        if (email != null && userRepository.existsByEmail(email)) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Email già in uso");
        }
        Workspace ws = workspaceRepository.findById(workspaceId)
                .orElseThrow(() -> new EntityNotFoundException("Workspace not found"));

        // Username-only: email e password restano null finché l'utente non completa l'onboarding
        // al primo accesso. Se l'admin fornisce una password temporanea, si usa il flusso classico.
        boolean hasTempPassword = req.temporaryPassword() != null && !req.temporaryPassword().isBlank();
        User newUser = User.builder()
                .email(email)
                .displayName(displayName)
                .passwordHash(hasTempPassword ? passwordEncoder.encode(req.temporaryPassword()) : null)
                .mustResetPassword(hasTempPassword)
                .build();
        newUser = userRepository.save(newUser);
        WorkspaceRole role = req.role() != null ? req.role() : WorkspaceRole.COLLABORATORE;
        WorkspaceMember member = WorkspaceMember.builder()
                .workspace(ws).user(newUser).role(role).build();
        memberRepository.save(member);
        return UserResponse.from(newUser);
    }

    @Transactional
    public WorkspaceResponse updateSettings(UUID workspaceId, UpdateWorkspaceSettingsRequest req, User requester) {
        assertRole(workspaceId, requester, WorkspaceRole.ADMIN);
        Workspace ws = workspaceRepository.findById(workspaceId)
                .orElseThrow(() -> new EntityNotFoundException("Workspace not found"));
        if (req.avatar() != null) ws.setAvatar(req.avatar().isBlank() ? null : req.avatar());
        if (req.cardShowTags() != null) ws.setCardShowTags(req.cardShowTags());
        if (req.cardShowAssignees() != null) ws.setCardShowAssignees(req.cardShowAssignees());
        if (req.cardShowDueDate() != null) ws.setCardShowDueDate(req.cardShowDueDate());
        if (req.reminderDaysBefore() != null) {
            ws.setReminderDaysBefore(Math.max(0, Math.min(30, req.reminderDaysBefore())));
        }
        if (req.eventRemindersEnabled() != null) ws.setEventRemindersEnabled(req.eventRemindersEnabled());
        if (req.weeklyRecapEnabled() != null) ws.setWeeklyRecapEnabled(req.weeklyRecapEnabled());
        if (req.mondayDigestEnabled() != null) ws.setMondayDigestEnabled(req.mondayDigestEnabled());
        if (req.sprintEnabled() != null) ws.setSprintEnabled(req.sprintEnabled());
        ws = workspaceRepository.save(ws);
        return WorkspaceResponse.from(ws, getUserRole(workspaceId, requester));
    }

    // Cancellazione irreversibile: tutte le righe figlie (membri, canali, elementi, tag,
    // allegati, drive, api key, impostazioni AI...) hanno ON DELETE CASCADE sul DB
    // (vedi migration V1-V12), quindi basta cancellare la riga workspace. I file fisici
    // (allegati/drive) invece NON sono coperti dal cascade SQL: vivono sul filesystem
    // sotto uploadDir/{workspaceId}/ e vanno rimossi esplicitamente qui.
    @Transactional
    public void deleteWorkspace(UUID workspaceId, User requester) {
        assertRole(workspaceId, requester, WorkspaceRole.ADMIN);
        Workspace ws = workspaceRepository.findById(workspaceId)
                .orElseThrow(() -> new EntityNotFoundException("Workspace not found"));
        deleteUploadDir(workspaceId);
        workspaceRepository.delete(ws);
        // Notifica realtime DOPO il commit: i client connessi escono subito dall'area e,
        // rifacendo la lista workspace, leggono lo stato già aggiornato (niente race con
        // un refetch che legge ancora la riga non ancora committata).
        publishAfterCommit(workspaceId, "WORKSPACE_DELETED", Map.of("workspaceId", workspaceId.toString()));
    }

    /**
     * Pubblica un evento sul topic del workspace solo dopo il commit della transazione corrente,
     * così i client che reagiscono rifacendo le query leggono dati già persistiti. Se non c'è una
     * transazione attiva, pubblica subito.
     */
    private void publishAfterCommit(UUID workspaceId, String type, Object payload) {
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override public void afterCommit() {
                    eventPublisher.publish(workspaceId, type, payload);
                }
            });
        } else {
            eventPublisher.publish(workspaceId, type, payload);
        }
    }

    private void deleteUploadDir(UUID workspaceId) {
        Path dir = Path.of(uploadDir, workspaceId.toString());
        if (!Files.exists(dir)) return;
        try (Stream<Path> paths = Files.walk(dir)) {
            paths.sorted(Comparator.reverseOrder()).forEach(p -> {
                try {
                    Files.delete(p);
                } catch (IOException e) {
                    log.warn("Impossibile cancellare {} durante la rimozione del workspace {}", p, workspaceId, e);
                }
            });
        } catch (IOException e) {
            log.warn("Impossibile attraversare la cartella upload {} per il workspace {}", dir, workspaceId, e);
        }
    }

    public WorkspaceRole getUserRole(UUID workspaceId, User user) {
        return memberRepository.findByWorkspaceIdAndUserId(workspaceId, user.getId())
                .map(WorkspaceMember::getRole)
                .orElseThrow(() -> new AccessDeniedException("Not a member of this workspace"));
    }

    public void assertMember(UUID workspaceId, User user) {
        if (!memberRepository.findByWorkspaceIdAndUserId(workspaceId, user.getId()).isPresent()) {
            throw new AccessDeniedException("Not a member of this workspace");
        }
    }

    public void assertRole(UUID workspaceId, User user, WorkspaceRole minRole) {
        WorkspaceRole role = getUserRole(workspaceId, user);
        if (role.ordinal() > minRole.ordinal()) {
            throw new AccessDeniedException("Insufficient permissions");
        }
    }
}
