package com.worktogether.service;

import com.worktogether.domain.entity.User;
import com.worktogether.repository.UserRepository;
import com.worktogether.security.OidcAccountException;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.stereotype.Service;

import java.util.Locale;
import java.util.Optional;

/**
 * Associa l'identità Authentik (access token già validato) all'utente interno.
 *
 * <ol>
 *   <li>Utente con {@code oidc_subject = sub} ⇒ è lui (caso normale, una query per richiesta).</li>
 *   <li>Primo accesso: utente interno con la stessa email ⇒ collegato (si salva il {@code sub}),
 *       solo se Authentik dichiara l'email verificata ({@code email_verified}) e l'utente non è
 *       già collegato a un'altra identità. Serve agli account nati prima di Authentik.</li>
 *   <li>Altrimenti si crea un utente normale (nome da {@code name}/{@code preferred_username}).</li>
 * </ol>
 * Chi entra è deciso da Authentik (gruppo dell'app sulla policy dell'applicazione): qui non si
 * filtrano i gruppi. L'utente con email verificata = ADMIN_INIT_EMAIL diventa admin di sistema
 * al primo accesso (creazione o collegamento).
 *
 * <p>Niente transazione esplicita: ogni save è atomico e i vincoli UNIQUE (oidc_subject, email,
 * display_name) proteggono dalle richieste concorrenti del primo accesso; in caso di conflitto si
 * rilegge l'utente creato dall'altra richiesta.
 */
@Slf4j
@Service
public class OidcUserService {

    private final UserRepository userRepository;
    private final String adminInitEmail;
    private final boolean requireEmailVerified;

    public OidcUserService(UserRepository userRepository,
                           @Value("${app.admin.init-email:}") String adminInitEmail,
                           @Value("${app.oidc.require-email-verified:true}") boolean requireEmailVerified) {
        this.userRepository = userRepository;
        this.adminInitEmail = normalizeEmail(adminInitEmail);
        this.requireEmailVerified = requireEmailVerified;
    }

    public User resolve(Jwt jwt) {
        String sub = jwt.getSubject();
        if (sub == null || sub.isBlank()) {
            throw new OidcAccountException(HttpStatus.UNAUTHORIZED, "Token senza soggetto");
        }
        Optional<User> bySub = userRepository.findByOidcSubject(sub);
        if (bySub.isPresent()) return syncEmail(bySub.get(), jwt);

        try {
            return firstAccess(sub, jwt);
        } catch (DataIntegrityViolationException e) {
            // Primo accesso concorrente (più richieste in parallelo al caricamento): un'altra
            // richiesta ha già creato/collegato l'utente.
            return userRepository.findByOidcSubject(sub).orElseThrow(() -> new OidcAccountException(
                    HttpStatus.CONFLICT, "Impossibile creare l'account: dati già usati da un altro utente"));
        }
    }

    private User firstAccess(String sub, Jwt jwt) {
        String email = normalizeEmail(jwt.getClaimAsString("email"));
        boolean verified = emailTrusted(jwt);

        if (email != null) {
            Optional<User> byEmail = userRepository.findByEmail(email);
            if (byEmail.isPresent()) {
                User existing = byEmail.get();
                if (!verified) {
                    throw new OidcAccountException(HttpStatus.FORBIDDEN,
                            "Esiste già un account WorkTogether con questa email, ma Authentik non la "
                            + "dichiara verificata: chiedi all'amministratore di collegare l'account");
                }
                if (existing.getOidcSubject() != null && !existing.getOidcSubject().equals(sub)) {
                    throw new OidcAccountException(HttpStatus.CONFLICT,
                            "L'email è già collegata a un altro account Authentik");
                }
                existing.setOidcSubject(sub);
                if (isInitAdmin(email, verified)) existing.setSystemAdmin(true);
                log.info("Utente {} collegato all'identità Authentik al primo accesso", existing.getId());
                return userRepository.saveAndFlush(existing);
            }
        }

        // Email salvata solo se verificata: un'email non verificata non deve "occupare" l'indirizzo
        // di un altro utente (né ricevere le sue notifiche).
        User created = User.builder()
                .oidcSubject(sub)
                .email(verified ? email : null)
                .displayName(uniqueDisplayName(preferredName(jwt)))
                .systemAdmin(isInitAdmin(email, verified))
                .build();
        created = userRepository.saveAndFlush(created);
        log.info("Creato utente {} al primo accesso OIDC (admin={})", created.getId(), created.isSystemAdmin());
        return created;
    }

    /** Aggiorna l'email se Authentik ne dichiara una nuova verificata (e libera). Scrive solo se cambia. */
    private User syncEmail(User user, Jwt jwt) {
        String email = normalizeEmail(jwt.getClaimAsString("email"));
        if (email == null || email.equals(user.getEmail()) || !emailTrusted(jwt)) return user;
        if (userRepository.existsByEmail(email)) return user; // occupata da un altro utente: si lascia com'è
        user.setEmail(email);
        try {
            return userRepository.saveAndFlush(user);
        } catch (DataIntegrityViolationException e) {
            return userRepository.findByOidcSubject(jwt.getSubject()).orElse(user);
        }
    }

    private boolean emailTrusted(Jwt jwt) {
        if (!requireEmailVerified) return true;
        return Boolean.TRUE.equals(jwt.getClaimAsBoolean("email_verified"));
    }

    private boolean isInitAdmin(String email, boolean verified) {
        return verified && email != null && email.equals(adminInitEmail);
    }

    private static String preferredName(Jwt jwt) {
        for (String claim : new String[]{"name", "preferred_username", "nickname"}) {
            String v = jwt.getClaimAsString(claim);
            if (v != null && !v.isBlank()) return v.trim();
        }
        String email = jwt.getClaimAsString("email");
        if (email != null && email.contains("@")) return email.substring(0, email.indexOf('@'));
        return "utente";
    }

    /** display_name è univoco: in caso di omonimia aggiunge " 2", " 3"... */
    public String uniqueDisplayName(String base) {
        String name = base.length() > 200 ? base.substring(0, 200) : base;
        if (!userRepository.existsByDisplayName(name)) return name;
        for (int i = 2; i < 1000; i++) {
            String candidate = name + " " + i;
            if (!userRepository.existsByDisplayName(candidate)) return candidate;
        }
        return name + " " + java.util.UUID.randomUUID().toString().substring(0, 8);
    }

    static String normalizeEmail(String email) {
        if (email == null || email.isBlank()) return null;
        return email.trim().toLowerCase(Locale.ROOT);
    }
}
