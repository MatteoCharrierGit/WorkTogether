package com.worktogether.service;

import com.worktogether.domain.entity.User;
import com.worktogether.domain.entity.VerificationCode;
import com.worktogether.domain.enums.VerificationPurpose;
import com.worktogether.repository.VerificationCodeRepository;
import jakarta.mail.internet.MimeMessage;
import jakarta.transaction.Transactional;
import lombok.RequiredArgsConstructor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.mail.javamail.MimeMessageHelper;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.time.Duration;
import java.time.OffsetDateTime;
import java.util.UUID;

/**
 * Servizio condiviso per i codici di verifica monouso (OTP a 6 cifre e token di sessione)
 * e per l'invio delle relative email. Riutilizzato da reset password, onboarding e (per il
 * solo invio mail) dagli inviti.
 */
@Service
@RequiredArgsConstructor
public class EmailVerificationService {

    private static final Logger log = LoggerFactory.getLogger(EmailVerificationService.class);
    private static final SecureRandom RANDOM = new SecureRandom();
    private static final int MAX_ATTEMPTS = 5;

    private final VerificationCodeRepository verificationRepository;
    private final PasswordEncoder passwordEncoder;
    private final JavaMailSender mailSender;
    private final MarkdownEmailRenderer markdownRenderer;

    @Value("${app.mail.from:}")
    private String from;

    public boolean isMailConfigured() {
        return from != null && !from.isBlank();
    }

    /**
     * Genera un OTP a 6 cifre per lo scopo dato, invalidando i precedenti pendenti.
     * Ritorna il codice in chiaro (da inviare via email): nel DB resta solo l'hash bcrypt.
     */
    @Transactional
    public String issueOtp(User user, VerificationPurpose purpose, String payloadJson, Duration ttl) {
        verificationRepository.deletePendingByUserAndPurpose(user.getId(), purpose);
        String code = String.format("%06d", RANDOM.nextInt(1_000_000));
        VerificationCode vc = VerificationCode.builder()
                .user(user)
                .purpose(purpose)
                .codeHash(passwordEncoder.encode(code))
                .payload(payloadJson)
                .expiresAt(OffsetDateTime.now().plus(ttl))
                .build();
        verificationRepository.save(vc);
        return code;
    }

    /**
     * Genera un token opaco (UUID) di sessione/uso singolo per lo scopo dato. Il token viene
     * salvato in chiaro come codeHash per consentirne il lookup diretto. Ritorna il token.
     */
    @Transactional
    public String issueToken(User user, VerificationPurpose purpose, String payloadJson, Duration ttl) {
        verificationRepository.deletePendingByUserAndPurpose(user.getId(), purpose);
        String token = UUID.randomUUID().toString() + UUID.randomUUID();
        VerificationCode vc = VerificationCode.builder()
                .user(user)
                .purpose(purpose)
                .codeHash(token)
                .payload(payloadJson)
                .expiresAt(OffsetDateTime.now().plus(ttl))
                .build();
        verificationRepository.save(vc);
        return token;
    }

    /** Recupera (senza consumare) un token valido e non scaduto per lo scopo indicato. */
    @Transactional
    public VerificationCode requireValidToken(String token, VerificationPurpose purpose) {
        if (token == null || token.isBlank()) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Sessione non valida");
        }
        VerificationCode vc = verificationRepository.findByCodeHash(token)
                .filter(v -> v.getPurpose() == purpose)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Sessione non valida o scaduta"));
        if (vc.getConsumedAt() != null || vc.getExpiresAt().isBefore(OffsetDateTime.now())) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Sessione scaduta, riprova dal login");
        }
        return vc;
    }

    /**
     * Verifica un OTP a 6 cifre per l'utente/scopo: controlla scadenza e numero di tentativi,
     * confronta con l'hash. Ritorna il record (NON consumato) se valido; altrimenti solleva
     * un errore. Il chiamante consuma il record con {@link #consume} dopo aver applicato l'effetto.
     */
    @Transactional
    public VerificationCode verifyOtp(User user, VerificationPurpose purpose, String code) {
        VerificationCode vc = verificationRepository
                .findFirstByUserIdAndPurposeAndConsumedAtIsNullOrderByCreatedAtDesc(user.getId(), purpose)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.BAD_REQUEST,
                        "Nessun codice attivo: richiedine uno nuovo"));
        if (vc.getExpiresAt().isBefore(OffsetDateTime.now())) {
            throw new ResponseStatusException(HttpStatus.GONE, "Codice scaduto: richiedine uno nuovo");
        }
        if (vc.getAttempts() >= MAX_ATTEMPTS) {
            throw new ResponseStatusException(HttpStatus.TOO_MANY_REQUESTS,
                    "Troppi tentativi: richiedi un nuovo codice");
        }
        if (code == null || !passwordEncoder.matches(code.trim(), vc.getCodeHash())) {
            vc.setAttempts(vc.getAttempts() + 1);
            verificationRepository.save(vc);
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Codice non valido");
        }
        return vc;
    }

    /** Marca il record come consumato (usa-e-getta). */
    @Transactional
    public void consume(VerificationCode vc) {
        vc.setConsumedAt(OffsetDateTime.now());
        verificationRepository.save(vc);
    }

    /**
     * Invia un'email Markdown a un singolo destinatario. Ritorna true se inviata.
     * No-op (false) se la posta non è configurata, così i flussi degradano senza errori.
     */
    public boolean sendEmail(String to, String subject, String markdownBody) {
        if (!isMailConfigured() || to == null || to.isBlank()) return false;
        try {
            String html = markdownRenderer.renderEmail(markdownBody);
            MimeMessage msg = mailSender.createMimeMessage();
            MimeMessageHelper helper = new MimeMessageHelper(msg, true, StandardCharsets.UTF_8.name());
            helper.setFrom(from);
            helper.setTo(to);
            helper.setSubject(subject);
            helper.setText(markdownBody, html);
            mailSender.send(msg);
            return true;
        } catch (Exception e) {
            log.warn("Invio email '{}' a {} non riuscito: {}", subject, to, e.getMessage());
            return false;
        }
    }
}
