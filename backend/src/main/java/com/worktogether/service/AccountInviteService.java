package com.worktogether.service;

import jakarta.mail.MessagingException;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.mail.MailAuthenticationException;
import org.springframework.mail.MailSendException;
import org.springframework.stereotype.Service;

/**
 * Email di benvenuto per un account appena creato dall'admin: username, password iniziale, link al
 * sito e avviso che al primo accesso va scelta una nuova password. Non solleva eccezioni: l'esito
 * torna come {@link Result}, perché l'account resta valido anche se la posta non parte.
 * La password non finisce mai nei log (né qui né in {@link MailService#sendEmailOrThrow}).
 */
@Slf4j
@Service
public class AccountInviteService {

    public static final String SUBJECT = "Il tuo account WorkTogether";
    static final String NOT_CONFIGURED = "SMTP non configurato";

    /** sent=true ⇒ email consegnata al server SMTP; altrimenti error è un messaggio leggibile. */
    public record Result(boolean sent, String error) {
        static Result ok() { return new Result(true, null); }
        static Result failed(String error) { return new Result(false, error); }
    }

    private final MailService mailService;
    private final String siteUrl;

    public AccountInviteService(MailService mailService,
                                @Value("${app.frontend.base-url:}") String frontendBaseUrl) {
        this.mailService = mailService;
        this.siteUrl = frontendBaseUrl == null ? "" : frontendBaseUrl.trim().replaceAll("/+$", "");
    }

    public Result send(String username, String email, String name, String password) {
        if (!mailService.isSmtpConfigured()) {
            log.info("Invito per l'account {} non inviato: SMTP non configurato", username);
            return Result.failed(NOT_CONFIGURED);
        }
        try {
            mailService.sendEmailOrThrow(email, SUBJECT, body(username, email, name, password));
            log.info("Invito per l'account {} inviato a {}", username, email);
            return Result.ok();
        } catch (MessagingException | RuntimeException e) {
            String reason = describe(e);
            // Solo il tipo e il messaggio dell'errore SMTP: il corpo (con la password) non viene mai registrato.
            log.warn("Invito per l'account {} non inviato a {}: {}", username, email, reason);
            return Result.failed(reason);
        }
    }

    String body(String username, String email, String name, String password) {
        StringBuilder md = new StringBuilder();
        md.append("Ciao ").append(escape(name)).append(",\n\n");
        md.append("è stato creato per te un account su **WorkTogether**.\n\n");
        if (!siteUrl.isEmpty()) md.append("- **Sito:** ").append(siteUrl).append("\n");
        md.append("- **Username:** ").append(code(username)).append("\n");
        md.append("- **Password temporanea:** ").append(code(password)).append("\n\n");
        md.append("Al primo accesso ti verrà chiesto di scegliere una nuova password: ")
                .append("quella temporanea smetterà di valere.\n\n");
        md.append("Per accedere puoi usare lo username oppure l'email (").append(escape(email)).append(").\n\n");
        md.append("Se non ti aspettavi questo messaggio puoi ignorarlo o avvisare chi gestisce WorkTogether.");
        return md.toString();
    }

    /** Messaggio breve e leggibile, senza dettagli di stack. */
    static String describe(Exception e) {
        if (e instanceof MailAuthenticationException) {
            return "il server SMTP ha rifiutato le credenziali (MAIL_USERNAME/MAIL_PASSWORD)";
        }
        Throwable root = e;
        while (root.getCause() != null && root.getCause() != root) root = root.getCause();
        String msg = root.getMessage() != null && !root.getMessage().isBlank() ? root.getMessage() : e.getMessage();
        if (msg == null || msg.isBlank()) msg = e.getClass().getSimpleName();
        msg = msg.replaceAll("\\s+", " ").trim();
        if (msg.length() > 200) msg = msg.substring(0, 200) + "…";
        if (e instanceof MailSendException) return "invio rifiutato dal server SMTP: " + msg;
        return "errore di invio: " + msg;
    }

    /** Code span CommonMark: il contenuto resta letterale (anche ` * _ <) e viene escapato in HTML. */
    static String code(String s) {
        int longest = 0, run = 0;
        for (char c : s.toCharArray()) {
            run = c == '`' ? run + 1 : 0;
            longest = Math.max(longest, run);
        }
        String fence = "`".repeat(longest + 1);
        boolean pad = longest > 0 || s.startsWith(" ") || s.endsWith(" ");
        return pad ? fence + " " + s + " " + fence : fence + s + fence;
    }

    /** Neutralizza Markdown e HTML nel testo libero (es. il nome scelto dall'admin). */
    static String escape(String s) {
        if (s == null) return "";
        StringBuilder out = new StringBuilder(s.length());
        for (char c : s.toCharArray()) {
            if ("\\`*_[]<>&#!|~".indexOf(c) >= 0) out.append('\\');
            out.append(c == '\n' || c == '\r' ? ' ' : c);
        }
        return out.toString();
    }
}
