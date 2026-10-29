package com.worktogether.service;

import jakarta.mail.MessagingException;
import jakarta.mail.internet.MimeMessage;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.mail.MailException;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.mail.javamail.MimeMessageHelper;
import org.springframework.stereotype.Service;

import java.nio.charset.StandardCharsets;

/**
 * Invio di email Markdown a un singolo destinatario (inviti ai workspace, credenziali dei nuovi account).
 * Degrada senza errori se la posta non è configurata.
 */
@Service
public class MailService {

    private static final Logger log = LoggerFactory.getLogger(MailService.class);

    private final JavaMailSender mailSender;
    private final MarkdownEmailRenderer markdownRenderer;
    private final String from;
    private final String host;
    private final String username;
    private final String password;

    public MailService(JavaMailSender mailSender,
                       MarkdownEmailRenderer markdownRenderer,
                       @Value("${app.mail.from:}") String from,
                       @Value("${spring.mail.host:}") String host,
                       @Value("${spring.mail.username:}") String username,
                       @Value("${spring.mail.password:}") String password) {
        this.mailSender = mailSender;
        this.markdownRenderer = markdownRenderer;
        this.host = blankToEmpty(host);
        this.username = blankToEmpty(username);
        this.password = password == null ? "" : password;
        // MAIL_FROM vuoto (il compose lo passa sempre, anche vuoto) ⇒ si usa la casella SMTP.
        String f = blankToEmpty(from);
        this.from = f.isEmpty() ? this.username : f;
    }

    /** Mittente effettivo: MAIL_FROM, oppure MAIL_USERNAME se MAIL_FROM è vuoto. */
    public String getFrom() {
        return from;
    }

    public boolean isMailConfigured() {
        return !from.isEmpty();
    }

    /**
     * SMTP davvero utilizzabile: host, credenziali (l'autenticazione SMTP è sempre attiva, vedi
     * application.yml) e mittente. Senza, non ha senso nemmeno tentare l'invio.
     */
    public boolean isSmtpConfigured() {
        return !host.isEmpty() && !username.isEmpty() && !password.isBlank() && !from.isEmpty();
    }

    /** Invia un'email Markdown. Ritorna true se inviata; false (no-op) se la posta non è configurata. */
    public boolean sendEmail(String to, String subject, String markdownBody) {
        if (!isMailConfigured() || to == null || to.isBlank()) return false;
        try {
            sendEmailOrThrow(to, subject, markdownBody);
            return true;
        } catch (Exception e) {
            log.warn("Invio email '{}' a {} non riuscito: {}", subject, to, e.getMessage());
            return false;
        }
    }

    /**
     * Come {@link #sendEmail} ma propaga l'errore, per chi deve riferirlo all'utente.
     * Non registra nulla nei log (il corpo può contenere dati riservati).
     */
    public void sendEmailOrThrow(String to, String subject, String markdownBody) throws MessagingException, MailException {
        String html = markdownRenderer.renderEmail(markdownBody);
        MimeMessage msg = mailSender.createMimeMessage();
        MimeMessageHelper helper = new MimeMessageHelper(msg, true, StandardCharsets.UTF_8.name());
        helper.setFrom(from);
        helper.setTo(to);
        helper.setSubject(subject);
        helper.setText(markdownBody, html);
        mailSender.send(msg);
    }

    private static String blankToEmpty(String s) {
        return s == null || s.isBlank() ? "" : s.trim();
    }
}
