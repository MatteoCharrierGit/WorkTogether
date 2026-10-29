package com.worktogether.service;

import com.worktogether.domain.entity.User;
import com.worktogether.domain.enums.WorkspaceRole;
import com.worktogether.dto.request.CreateUserRequest;
import com.worktogether.dto.response.CreatedUserResponse;
import com.worktogether.dto.response.UserResponse;
import com.worktogether.repository.UserRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

import java.util.Locale;

/**
 * Creazione degli account (solo admin di sistema): niente registrazione pubblica, l'account nasce
 * in Authentik (password iniziale + gruppo dell'app) e subito dopo come utente interno collegato.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class AdminUserService {

    private final AuthentikClient authentik;
    private final UserRepository userRepository;
    private final OidcUserService oidcUserService;
    private final WorkspaceService workspaceService;
    private final AccountInviteService accountInviteService;

    /**
     * Con sendInvite: l'utente nasce in Authentik con l'obbligo di cambiare password al primo accesso
     * e riceve un'email con le credenziali. Se l'email non parte l'account resta creato e la risposta
     * lo dice (inviteSent=false, inviteError).
     */
    public CreatedUserResponse createUser(CreateUserRequest req, User requester) {
        if (!requester.isSystemAdmin()) {
            throw new AccessDeniedException("Solo l'amministratore può creare account");
        }
        String username = req.username().trim();
        String email = req.email().trim().toLowerCase(Locale.ROOT);
        String name = req.name() != null && !req.name().isBlank() ? req.name().trim() : username;

        // Controlli lato app prima di toccare Authentik.
        if (userRepository.existsByEmail(email)) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Esiste già un utente WorkTogether con questa email");
        }
        if (req.workspaceId() != null) {
            workspaceService.assertRole(req.workspaceId(), requester, WorkspaceRole.ADMIN);
        }

        boolean invite = req.inviteRequested();
        AuthentikClient.CreatedUser created = authentik.createUser(username, email, name, req.password(), invite);

        User user;
        try {
            // oidc_subject = uid di Authentik (il "sub" con la modalità di default del provider).
            // Se il provider usasse un'altra modalità, il collegamento avviene comunque al primo
            // accesso tramite l'email verificata.
            user = userRepository.saveAndFlush(User.builder()
                    .email(email)
                    .displayName(oidcUserService.uniqueDisplayName(name))
                    .oidcSubject(created.uid() == null || created.uid().isBlank() ? null : created.uid())
                    .build());
        } catch (RuntimeException e) {
            log.warn("Creazione dell'utente interno fallita, annullo l'account Authentik {}", created.pk(), e);
            authentik.deleteUserQuietly(created.pk());
            throw new ResponseStatusException(HttpStatus.CONFLICT,
                    "Impossibile creare l'utente: dati già usati da un altro account");
        }

        if (req.workspaceId() != null) {
            WorkspaceRole role = req.role() != null ? req.role() : WorkspaceRole.COLLABORATORE;
            workspaceService.addMember(req.workspaceId(), user.getId(), role, requester);
        }
        log.info("Account {} ({}) creato da {}", user.getId(), username, requester.getId());

        UserResponse response = UserResponse.from(user);
        if (!invite) return CreatedUserResponse.of(response, false, null);
        AccountInviteService.Result result = accountInviteService.send(username, email, name, req.password());
        return CreatedUserResponse.of(response, result.sent(), result.error());
    }
}
