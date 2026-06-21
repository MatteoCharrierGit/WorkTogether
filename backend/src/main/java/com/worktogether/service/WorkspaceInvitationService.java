package com.worktogether.service;

import com.worktogether.domain.entity.*;
import com.worktogether.domain.enums.InvitationStatus;
import com.worktogether.domain.enums.WorkspaceRole;
import com.worktogether.dto.request.CreateInvitationRequest;
import com.worktogether.dto.response.InvitationPreviewResponse;
import com.worktogether.dto.response.InvitationResponse;
import com.worktogether.repository.*;
import jakarta.persistence.EntityNotFoundException;
import jakarta.transaction.Transactional;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

import java.time.Duration;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * Inviti a un workspace tramite link via email. Il bersaglio è risolto per username (displayName)
 * o email; l'invito viene accettato dall'utente loggato cliccando il link ricevuto.
 */
@Service
@RequiredArgsConstructor
public class WorkspaceInvitationService {

    private static final Duration INVITATION_TTL = Duration.ofDays(7);

    private final WorkspaceInvitationRepository invitationRepository;
    private final WorkspaceRepository workspaceRepository;
    private final WorkspaceMemberRepository memberRepository;
    private final UserRepository userRepository;
    private final WorkspaceService workspaceService;
    private final EmailVerificationService verification;

    @Value("${app.frontend.base-url:}")
    private String frontendBaseUrl;

    @Transactional
    public InvitationResponse create(UUID workspaceId, CreateInvitationRequest req, User requester) {
        workspaceService.assertRole(workspaceId, requester, WorkspaceRole.ADMIN);
        Workspace ws = workspaceRepository.findById(workspaceId)
                .orElseThrow(() -> new EntityNotFoundException("Workspace not found"));

        String identifier = req.identifier().trim();
        User target;
        String email;
        if (identifier.contains("@")) {
            email = identifier.toLowerCase();
            target = userRepository.findByEmail(email).orElse(null);
        } else {
            target = userRepository.findByDisplayName(identifier)
                    .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND,
                            "Nessun utente con questo username"));
            email = target.getEmail();
            if (email == null || email.isBlank()) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                        "L'utente non ha ancora un'email: non è possibile inviargli un invito");
            }
        }

        if (target != null && memberRepository.findByWorkspaceIdAndUserId(workspaceId, target.getId()).isPresent()) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "L'utente è già membro del workspace");
        }
        if (target != null && invitationRepository
                .findByWorkspaceIdAndInvitedUserIdAndStatus(workspaceId, target.getId(), InvitationStatus.PENDING)
                .isPresent()) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Esiste già un invito pendente per questo utente");
        }

        WorkspaceRole role = req.role() != null ? req.role() : WorkspaceRole.COLLABORATORE;
        WorkspaceInvitation inv = WorkspaceInvitation.builder()
                .workspace(ws)
                .invitedUser(target)
                .email(email)
                .role(role)
                .token(UUID.randomUUID().toString() + UUID.randomUUID())
                .status(InvitationStatus.PENDING)
                .invitedBy(requester)
                .expiresAt(OffsetDateTime.now().plus(INVITATION_TTL))
                .build();
        inv = invitationRepository.save(inv);

        sendInvitationEmail(inv, requester);
        return InvitationResponse.from(inv);
    }

    @Transactional
    public List<InvitationResponse> list(UUID workspaceId, User requester) {
        workspaceService.assertRole(workspaceId, requester, WorkspaceRole.ADMIN);
        return invitationRepository
                .findByWorkspaceIdAndStatusOrderByCreatedAtDesc(workspaceId, InvitationStatus.PENDING)
                .stream().map(InvitationResponse::from).toList();
    }

    @Transactional
    public void revoke(UUID workspaceId, UUID invitationId, User requester) {
        workspaceService.assertRole(workspaceId, requester, WorkspaceRole.ADMIN);
        WorkspaceInvitation inv = invitationRepository.findById(invitationId)
                .orElseThrow(() -> new EntityNotFoundException("Invito non trovato"));
        if (!inv.getWorkspace().getId().equals(workspaceId)) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Invito non trovato");
        }
        inv.setStatus(InvitationStatus.REVOKED);
        invitationRepository.save(inv);
    }

    /** Anteprima pubblica per la schermata di accettazione. */
    @Transactional
    public InvitationPreviewResponse preview(String token) {
        WorkspaceInvitation inv = requirePendingInvitation(token);
        String inviter = inv.getInvitedBy() != null ? inv.getInvitedBy().getDisplayName() : "Un amministratore";
        return new InvitationPreviewResponse(inv.getWorkspace().getName(), inviter, inv.getEmail(), inv.getRole());
    }

    /** Accettazione da parte dell'utente autenticato: crea/aggiorna la membership. */
    @Transactional
    public InvitationResponse accept(String token, User currentUser) {
        WorkspaceInvitation inv = requirePendingInvitation(token);

        boolean matches = inv.getInvitedUser() != null
                ? inv.getInvitedUser().getId().equals(currentUser.getId())
                : (currentUser.getEmail() != null && currentUser.getEmail().equalsIgnoreCase(inv.getEmail()));
        if (!matches) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Questo invito è destinato a un altro account");
        }

        WorkspaceMember member = memberRepository
                .findByWorkspaceIdAndUserId(inv.getWorkspace().getId(), currentUser.getId())
                .orElseGet(() -> WorkspaceMember.builder()
                        .workspace(inv.getWorkspace()).user(currentUser).build());
        member.setRole(inv.getRole());
        memberRepository.save(member);

        inv.setStatus(InvitationStatus.ACCEPTED);
        inv.setAcceptedAt(OffsetDateTime.now());
        if (inv.getInvitedUser() == null) inv.setInvitedUser(currentUser);
        invitationRepository.save(inv);
        return InvitationResponse.from(inv);
    }

    private WorkspaceInvitation requirePendingInvitation(String token) {
        WorkspaceInvitation inv = invitationRepository.findByToken(token)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Invito non trovato"));
        if (inv.getStatus() != InvitationStatus.PENDING) {
            throw new ResponseStatusException(HttpStatus.GONE, "Invito non più valido");
        }
        if (inv.getExpiresAt().isBefore(OffsetDateTime.now())) {
            inv.setStatus(InvitationStatus.EXPIRED);
            invitationRepository.save(inv);
            throw new ResponseStatusException(HttpStatus.GONE, "Invito scaduto");
        }
        return inv;
    }

    private void sendInvitationEmail(WorkspaceInvitation inv, User inviter) {
        String base = (frontendBaseUrl == null || frontendBaseUrl.isBlank())
                ? "" : frontendBaseUrl.replaceAll("/+$", "");
        String link = base + "/invite/" + inv.getToken();
        String body = "Ciao,\n\n**" + inviter.getDisplayName() + "** ti ha invitato a unirti al workspace "
                + "**" + inv.getWorkspace().getName() + "** su WorkTogether con il ruolo *"
                + inv.getRole().name().toLowerCase() + "*.\n\n"
                + "Per accettare l'invito apri questo link:\n\n"
                + link + "\n\n"
                + "L'invito scade tra 7 giorni. Se non ti aspettavi questo messaggio puoi ignorarlo.";
        verification.sendEmail(inv.getEmail(), "Invito al workspace " + inv.getWorkspace().getName(), body);
    }
}
