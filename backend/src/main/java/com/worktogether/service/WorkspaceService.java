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

    @Transactional
    public void removeMember(UUID workspaceId, UUID userId, User requester) {
        assertRole(workspaceId, requester, WorkspaceRole.ADMIN);
        memberRepository.findByWorkspaceIdAndUserId(workspaceId, userId)
                .ifPresent(memberRepository::delete);
    }

    @Transactional
    public UserResponse createUser(UUID workspaceId, CreateUserRequest req, User requester) {
        assertRole(workspaceId, requester, WorkspaceRole.ADMIN);
        if (userRepository.existsByEmail(req.email())) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Email already in use");
        }
        Workspace ws = workspaceRepository.findById(workspaceId)
                .orElseThrow(() -> new EntityNotFoundException("Workspace not found"));
        User newUser = User.builder()
                .email(req.email())
                .displayName(req.displayName())
                .passwordHash(passwordEncoder.encode(req.temporaryPassword()))
                .mustResetPassword(true)
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
