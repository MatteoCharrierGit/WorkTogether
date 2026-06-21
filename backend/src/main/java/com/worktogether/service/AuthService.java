package com.worktogether.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.worktogether.domain.entity.*;
import com.worktogether.domain.enums.VerificationPurpose;
import com.worktogether.dto.request.*;
import com.worktogether.dto.response.AuthResponse;
import com.worktogether.repository.*;
import com.worktogether.security.JwtUtil;
import jakarta.transaction.Transactional;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.http.HttpStatus;
import org.springframework.security.authentication.BadCredentialsException;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

import java.time.Duration;
import java.time.OffsetDateTime;
import java.util.Optional;
import java.util.UUID;

@Service
@RequiredArgsConstructor
public class AuthService {

    private static final Duration ONBOARDING_SESSION_TTL = Duration.ofMinutes(30);
    private static final Duration OTP_TTL = Duration.ofMinutes(15);

    private final UserRepository userRepository;
    private final RefreshTokenRepository refreshTokenRepository;
    private final PasswordEncoder passwordEncoder;
    private final JwtUtil jwtUtil;
    private final EmailVerificationService verification;
    private final ObjectMapper objectMapper;

    @Value("${app.jwt.refresh-expiry-ms}")
    private long refreshExpiryMs;

    @Value("${app.admin.init-email}")
    private String adminEmail;

    @Value("${app.admin.init-password}")
    private String adminPassword;

    // Payload (JSON) custodito nell'OTP di onboarding: email scelta + hash della nuova password.
    private record OnboardingPayload(String email, String passwordHash) {}

    @EventListener(ApplicationReadyEvent.class)
    @Transactional
    public void initAdminUser() {
        if (!userRepository.existsByEmail(adminEmail)) {
            User admin = User.builder()
                    .email(adminEmail)
                    .displayName("Admin")
                    .passwordHash(passwordEncoder.encode(adminPassword))
                    .mustResetPassword(false)
                    .systemAdmin(true)
                    .build();
            userRepository.save(admin);
        }
    }

    @Transactional
    public AuthResponse login(LoginRequest req) {
        User user = resolveUser(req.identifier())
                .orElseThrow(() -> new BadCredentialsException("Invalid credentials"));

        // Account creato col solo username: nessuna password impostata ⇒ primo accesso = onboarding.
        if (user.getPasswordHash() == null) {
            String token = verification.issueToken(user, VerificationPurpose.ONBOARDING_SESSION, null, ONBOARDING_SESSION_TTL);
            return AuthResponse.onboarding(user.getId(), user.getDisplayName(), token);
        }

        if (req.password() == null || !passwordEncoder.matches(req.password(), user.getPasswordHash())) {
            throw new BadCredentialsException("Invalid credentials");
        }
        return buildAuthResponse(user);
    }

    // ---- Onboarding (primo accesso: imposta email + password con verifica via OTP) ----

    @Transactional
    public void onboardingStart(OnboardingStartRequest req) {
        VerificationCode session = verification.requireValidToken(
                req.onboardingToken(), VerificationPurpose.ONBOARDING_SESSION);
        User user = session.getUser();
        if (user.getPasswordHash() != null) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Account già configurato");
        }
        String email = req.email().trim().toLowerCase();
        userRepository.findByEmail(email)
                .filter(u -> !u.getId().equals(user.getId()))
                .ifPresent(u -> { throw new ResponseStatusException(HttpStatus.CONFLICT, "Email già in uso"); });

        String payload = writeJson(new OnboardingPayload(email, passwordEncoder.encode(req.password())));
        String code = verification.issueOtp(user, VerificationPurpose.ONBOARDING_EMAIL, payload, OTP_TTL);

        verification.sendEmail(email, "Conferma la tua email — WorkTogether",
                "Ciao **" + user.getDisplayName() + "**,\n\n"
                + "il tuo codice di verifica per completare la configurazione dell'account è:\n\n"
                + "## " + code + "\n\n"
                + "Il codice scade tra 15 minuti. Se non hai richiesto tu questa operazione, ignora questa email.");
    }

    @Transactional
    public AuthResponse onboardingVerify(OnboardingVerifyRequest req) {
        VerificationCode session = verification.requireValidToken(
                req.onboardingToken(), VerificationPurpose.ONBOARDING_SESSION);
        User user = session.getUser();

        VerificationCode otp = verification.verifyOtp(user, VerificationPurpose.ONBOARDING_EMAIL, req.code());
        OnboardingPayload payload = readJson(otp.getPayload(), OnboardingPayload.class);
        if (payload == null) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Dati di onboarding mancanti: ricomincia");
        }
        // Ricontrolla l'unicità dell'email subito prima di applicarla (potrebbe essere stata presa nel frattempo).
        userRepository.findByEmail(payload.email())
                .filter(u -> !u.getId().equals(user.getId()))
                .ifPresent(u -> { throw new ResponseStatusException(HttpStatus.CONFLICT, "Email già in uso"); });

        user.setEmail(payload.email());
        user.setPasswordHash(payload.passwordHash());
        user.setMustResetPassword(false);
        userRepository.save(user);

        verification.consume(otp);
        verification.consume(session);
        return buildAuthResponse(user);
    }

    // ---- Reset password via OTP email ----

    @Transactional
    public void passwordResetRequest(PasswordResetRequestRequest req) {
        // Nessuna user-enumeration: si risponde sempre 200, l'email parte solo se l'utente esiste e ha un'email.
        resolveUser(req.identifier()).ifPresent(user -> {
            if (user.getEmail() == null || user.getEmail().isBlank()) return;
            String code = verification.issueOtp(user, VerificationPurpose.PASSWORD_RESET, null, OTP_TTL);
            verification.sendEmail(user.getEmail(), "Reimposta la password — WorkTogether",
                    "Ciao **" + user.getDisplayName() + "**,\n\n"
                    + "hai richiesto di reimpostare la password. Il tuo codice è:\n\n"
                    + "## " + code + "\n\n"
                    + "Il codice scade tra 15 minuti. Se non sei stato tu, ignora questa email: la password resta invariata.");
        });
    }

    @Transactional
    public AuthResponse passwordResetVerify(PasswordResetVerifyRequest req) {
        User user = resolveUser(req.identifier())
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.BAD_REQUEST, "Codice non valido"));
        VerificationCode otp = verification.verifyOtp(user, VerificationPurpose.PASSWORD_RESET, req.code());
        user.setPasswordHash(passwordEncoder.encode(req.newPassword()));
        user.setMustResetPassword(false);
        userRepository.save(user);
        verification.consume(otp);
        // buildAuthResponse incrementa tokenVersion ed elimina i refresh token: le vecchie sessioni cadono.
        return buildAuthResponse(user);
    }

    // ---- Force reset (utente autenticato con password temporanea) ----

    @Transactional
    public AuthResponse resetPassword(User user, ResetPasswordRequest req) {
        if (user.getPasswordHash() == null || !passwordEncoder.matches(req.currentPassword(), user.getPasswordHash())) {
            throw new BadCredentialsException("Current password is incorrect");
        }
        user.setPasswordHash(passwordEncoder.encode(req.newPassword()));
        user.setMustResetPassword(false);
        userRepository.save(user);
        return buildAuthResponse(user);
    }

    @Transactional
    public AuthResponse refresh(String refreshToken) {
        RefreshToken token = refreshTokenRepository.findByToken(refreshToken)
                .orElseThrow(() -> new BadCredentialsException("Invalid refresh token"));
        if (token.getExpiresAt().isBefore(OffsetDateTime.now())) {
            refreshTokenRepository.delete(token);
            throw new BadCredentialsException("Refresh token expired");
        }
        // Refresh non distruttivo: manteniamo lo stesso refresh token (sliding
        // expiry) e rilasciamo solo un nuovo access token. Evita che richieste di
        // refresh concorrenti o da più tab/dispositivi invalidino la sessione,
        // causa dei logout casuali.
        User user = token.getUser();
        token.setExpiresAt(OffsetDateTime.now().plusNanos(refreshExpiryMs * 1_000_000L));
        refreshTokenRepository.save(token);
        // Stesso access token della sessione corrente: porta la versione attuale dell'utente.
        String accessToken = jwtUtil.generateToken(user.getId(), user.getEmail(), user.getTokenVersion());
        return new AuthResponse(
                accessToken, token.getToken(),
                user.getId(), user.getEmail(), user.getDisplayName(),
                user.isMustResetPassword(), user.isSystemAdmin(), user.isOnboardingCompleted(), user.getAvatar(),
                false, null
        );
    }

    @Transactional
    public void logout(User user) {
        refreshTokenRepository.deleteByUserId(user.getId());
    }

    /** Risolve un utente per username (display_name) o email. */
    private Optional<User> resolveUser(String identifier) {
        if (identifier == null || identifier.isBlank()) return Optional.empty();
        String id = identifier.trim();
        Optional<User> byName = userRepository.findByDisplayName(id);
        if (byName.isPresent()) return byName;
        return userRepository.findByEmail(id.toLowerCase());
    }

    private AuthResponse buildAuthResponse(User user) {
        // Sessione singola: a ogni login si incrementa la versione di sessione, così TUTTI gli access
        // token emessi prima (su altri dispositivi/browser) diventano subito invalidi (vedi JwtAuthFilter).
        // I refresh token esistenti vengono comunque eliminati qui sotto.
        user.setTokenVersion(user.getTokenVersion() + 1);
        userRepository.save(user);
        String accessToken = jwtUtil.generateToken(user.getId(), user.getEmail(), user.getTokenVersion());
        String refreshToken = UUID.randomUUID().toString();
        refreshTokenRepository.deleteByUserId(user.getId());
        RefreshToken rt = RefreshToken.builder()
                .user(user)
                .token(refreshToken)
                .expiresAt(OffsetDateTime.now().plusNanos(refreshExpiryMs * 1_000_000L))
                .build();
        refreshTokenRepository.save(rt);
        return new AuthResponse(
                accessToken, refreshToken,
                user.getId(), user.getEmail(), user.getDisplayName(),
                user.isMustResetPassword(), user.isSystemAdmin(), user.isOnboardingCompleted(), user.getAvatar(),
                false, null
        );
    }

    private String writeJson(Object o) {
        try {
            return objectMapper.writeValueAsString(o);
        } catch (Exception e) {
            throw new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR, "Errore interno");
        }
    }

    private <T> T readJson(String json, Class<T> type) {
        if (json == null) return null;
        try {
            return objectMapper.readValue(json, type);
        } catch (Exception e) {
            return null;
        }
    }
}
