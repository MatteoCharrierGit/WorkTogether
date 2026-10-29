package com.worktogether.service;

import jakarta.mail.Multipart;
import jakarta.mail.Part;
import jakarta.mail.Session;
import jakarta.mail.internet.MimeMessage;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.springframework.mail.javamail.JavaMailSenderImpl;

import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.util.Properties;

import static org.junit.jupiter.api.Assertions.*;

/** Invio dell'email con le credenziali contro un server SMTP finto su localhost. */
@ExtendWith(OutputCaptureExtension.class)
class AccountInviteServiceTest {

    static final String PASSWORD = "Tmp-Segreta*42`x";
    static final String SITE = "https://worktogether.mchaservice.tech";

    FakeSmtpServer smtp;

    @BeforeEach
    void start() throws Exception { smtp = new FakeSmtpServer(); }

    @AfterEach
    void stop() throws Exception { smtp.close(); }

    private MailService mail(String host, int port, String user, String pass, String from) {
        JavaMailSenderImpl sender = new JavaMailSenderImpl();
        sender.setHost(host);
        sender.setPort(port);
        sender.setUsername(user);
        sender.setPassword(pass);
        Properties p = sender.getJavaMailProperties();
        p.put("mail.smtp.auth", "true");
        p.put("mail.smtp.starttls.enable", "false");
        p.put("mail.smtp.connectiontimeout", "3000");
        p.put("mail.smtp.timeout", "3000");
        return new MailService(sender, new MarkdownEmailRenderer(), from, host, user, pass);
    }

    private AccountInviteService service(MailService mail) {
        return new AccountInviteService(mail, SITE + "/");
    }

    @Test
    void sendsCredentialsLinkAndFirstLoginNotice(CapturedOutput output) throws Exception {
        AccountInviteService.Result r = service(mail("127.0.0.1", smtp.port(), "noreply@example.com", "smtp-pw", ""))
                .send("mario.rossi", "mario@example.com", "Mario <b>Rossi</b>", PASSWORD);

        assertTrue(r.sent(), r.error());
        assertNull(r.error());
        assertEquals(1, smtp.messages.size());
        assertTrue(smtp.commands.stream().anyMatch(c -> c.startsWith("RCPT TO:<mario@example.com>")));
        // MAIL_FROM vuoto ⇒ mittente = casella SMTP
        assertTrue(smtp.commands.stream().anyMatch(c -> c.startsWith("MAIL FROM:<noreply@example.com>")));

        MimeMessage msg = new MimeMessage(Session.getInstance(new Properties()),
                new ByteArrayInputStream(smtp.messages.get(0).getBytes(StandardCharsets.UTF_8)));
        assertEquals(AccountInviteService.SUBJECT, msg.getSubject());
        String text = part(msg, "text/plain");
        String html = part(msg, "text/html");
        assertTrue(text.contains("mario.rossi"), text);
        assertTrue(text.contains(PASSWORD), text);
        assertTrue(text.contains(SITE), text);
        assertTrue(text.contains("primo accesso ti verrà chiesto di scegliere una nuova password"), text);
        // HTML: password letterale (escapata), nome senza tag iniettati
        assertTrue(html.contains("Tmp-Segreta*42`x"), html);
        assertFalse(html.contains("<b>Rossi</b>"), html);
        assertTrue(html.contains("href=\"" + SITE + "\"") || html.contains(SITE), html);

        assertTrue(output.getAll().contains("Invito per l'account mario.rossi inviato"), output.getAll());
        assertFalse(output.getAll().contains(PASSWORD), "la password è finita nei log");
    }

    @Test
    void smtpNotConfiguredDoesNotTry(CapturedOutput output) {
        AccountInviteService.Result r = service(mail("", smtp.port(), "", "", ""))
                .send("mario", "mario@example.com", "Mario", PASSWORD);
        assertFalse(r.sent());
        assertEquals("SMTP non configurato", r.error());
        assertTrue(smtp.commands.isEmpty());
        assertFalse(output.getAll().contains(PASSWORD));
    }

    @Test
    void missingSmtpPasswordCountsAsNotConfigured() {
        AccountInviteService.Result r = service(mail("127.0.0.1", smtp.port(), "noreply@example.com", "", "noreply@example.com"))
                .send("mario", "mario@example.com", "Mario", PASSWORD);
        assertFalse(r.sent());
        assertEquals("SMTP non configurato", r.error());
    }

    @Test
    void rejectedCredentialsGiveReadableErrorWithoutPasswordInLogs(CapturedOutput output) {
        smtp.rejectAuth = true;
        AccountInviteService.Result r = service(mail("127.0.0.1", smtp.port(), "noreply@example.com", "wrong", ""))
                .send("mario", "mario@example.com", "Mario", PASSWORD);
        assertFalse(r.sent());
        assertTrue(r.error().contains("credenziali"), r.error());
        assertTrue(smtp.messages.isEmpty());
        assertTrue(output.getAll().contains("Invito per l'account mario non inviato"), output.getAll());
        assertFalse(output.getAll().contains(PASSWORD), "la password è finita nei log");
    }

    @Test
    void unreachableServerIsReportedNotThrown(CapturedOutput output) throws Exception {
        int port = smtp.port();
        smtp.close();
        AccountInviteService.Result r = service(mail("127.0.0.1", port, "noreply@example.com", "pw", ""))
                .send("mario", "mario@example.com", "Mario", PASSWORD);
        assertFalse(r.sent());
        assertNotNull(r.error());
        assertFalse(output.getAll().contains(PASSWORD));
    }

    @Test
    void codeSpanKeepsBackticksLiteral() {
        assertEquals("`abc`", AccountInviteService.code("abc"));
        assertEquals("`` a`b ``", AccountInviteService.code("a`b"));
        assertEquals("a\\*b\\_c \\<x\\>", AccountInviteService.escape("a*b_c <x>"));
    }

    private static String part(Part p, String type) throws Exception {
        if (p.isMimeType(type)) return p.getContent().toString();
        if (p.isMimeType("multipart/*")) {
            Multipart mp = (Multipart) p.getContent();
            for (int i = 0; i < mp.getCount(); i++) {
                String s = part(mp.getBodyPart(i), type);
                if (s != null) return s;
            }
        }
        return null;
    }
}
