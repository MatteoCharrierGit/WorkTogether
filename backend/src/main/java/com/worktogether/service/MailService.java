package com.worktogether.service;

import jakarta.mail.internet.MimeMessage;
import lombok.RequiredArgsConstructor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.mail.javamail.MimeMessageHelper;
import org.springframework.stereotype.Service;

import java.nio.charset.StandardCharsets;

/**
 * Invio di email Markdown a un singolo destinatario (oggi: inviti ai workspace).
 * Degrada senza errori se la posta non è configurata.
 */
@Service
@RequiredArgsConstructor
public class MailService {

    private static final Logger log = LoggerFactory.getLogger(MailService.class);

    private final JavaMailSender mailSender;
    private final MarkdownEmailRenderer markdownRenderer;

    @Value("${app.mail.from:}")
    private String from;

    public boolean isMailConfigured() {
        return from != null && !from.isBlank();
    }

    /** Invia un'email Markdown. Ritorna true se inviata; false (no-op) se la posta non è configurata. */
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
