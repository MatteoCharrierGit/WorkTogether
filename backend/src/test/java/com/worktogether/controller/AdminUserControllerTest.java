package com.worktogether.controller;

import com.worktogether.domain.entity.User;
import com.worktogether.domain.enums.WorkspaceRole;
import com.worktogether.repository.UserRepository;
import com.worktogether.service.AccountInviteService;
import com.worktogether.service.AdminUserService;
import com.worktogether.service.AuthentikClient;
import com.worktogether.service.MailService;
import com.worktogether.service.MarkdownEmailRenderer;
import com.worktogether.service.OidcUserService;
import com.worktogether.service.WorkspaceService;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.springframework.http.MediaType;
import org.springframework.mail.MailSendException;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.mail.javamail.JavaMailSenderImpl;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.web.method.annotation.AuthenticationPrincipalArgumentResolver;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import java.util.List;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/**
 * POST /api/admin/users con invito: AdminUserService e AccountInviteService reali; Authentik, database e
 * server SMTP sostituiti da mock. L'account va creato (201) anche quando l'email non parte.
 */
@ExtendWith(OutputCaptureExtension.class)
class AdminUserControllerTest {

    static final String PASSWORD = "Iniziale-9xQ!";
    static final UUID WS = UUID.randomUUID();

    AuthentikClient authentik = mock(AuthentikClient.class);
    UserRepository users = mock(UserRepository.class);
    OidcUserService oidc = mock(OidcUserService.class);
    WorkspaceService workspaces = mock(WorkspaceService.class);
    JavaMailSender sender = mock(JavaMailSender.class);
    User admin = User.builder().id(UUID.randomUUID()).email("admin@example.com").displayName("Admin").systemAdmin(true).build();

    @BeforeEach
    void setUp() {
        when(authentik.createUser(anyString(), anyString(), anyString(), anyString(), anyBoolean()))
                .thenReturn(new AuthentikClient.CreatedUser(42, "uid-42"));
        when(oidc.uniqueDisplayName(anyString())).thenAnswer(a -> a.getArgument(0));
        when(users.saveAndFlush(any(User.class))).thenAnswer(a -> {
            User u = a.getArgument(0);
            u.setId(UUID.randomUUID());
            return u;
        });
        when(sender.createMimeMessage()).thenAnswer(a -> new JavaMailSenderImpl().createMimeMessage());
        SecurityContextHolder.getContext().setAuthentication(
                new UsernamePasswordAuthenticationToken(admin, null, List.of()));
    }

    @AfterEach
    void clear() { SecurityContextHolder.clearContext(); }

    private MockMvc mvc(MailService mail) {
        AdminUserService service = new AdminUserService(authentik, users, oidc, workspaces,
                new AccountInviteService(mail, "https://worktogether.mchaservice.tech"));
        return MockMvcBuilders.standaloneSetup(new AdminUserController(service))
                .setCustomArgumentResolvers(new AuthenticationPrincipalArgumentResolver())
                .setControllerAdvice(new GlobalExceptionHandler())
                .build();
    }

    private MailService configuredMail() {
        return new MailService(sender, new MarkdownEmailRenderer(), "", "smtp.example.com", "noreply@example.com", "smtp-pw");
    }

    private MailService unconfiguredMail() {
        return new MailService(sender, new MarkdownEmailRenderer(), "", "", "", "");
    }

    private static String body(Boolean sendInvite) {
        return """
                {"username":"mario","email":"Mario@Example.com","name":"Mario Rossi","password":"%s",
                 "workspaceId":"%s","role":"COLLABORATORE"%s}
                """.formatted(PASSWORD, WS, sendInvite == null ? "" : ",\"sendInvite\":" + sendInvite);
    }

    @Test
    void inviteSent(CapturedOutput output) throws Exception {
        mvc(configuredMail()).perform(post("/api/admin/users").contentType(MediaType.APPLICATION_JSON).content(body(true)))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.email").value("mario@example.com"))
                .andExpect(jsonPath("$.inviteSent").value(true))
                .andExpect(jsonPath("$.inviteError").doesNotExist());
        verify(authentik).createUser("mario", "mario@example.com", "Mario Rossi", PASSWORD, true);
        verify(sender).send(any(jakarta.mail.internet.MimeMessage.class));
        verify(workspaces).addMember(eq(WS), any(), eq(WorkspaceRole.COLLABORATORE), eq(admin));
        assertFalse(output.getAll().contains(PASSWORD), "la password è finita nei log");
    }

    @Test
    void smtpNotConfiguredStillCreatesTheAccount(CapturedOutput output) throws Exception {
        mvc(unconfiguredMail()).perform(post("/api/admin/users").contentType(MediaType.APPLICATION_JSON).content(body(true)))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.inviteSent").value(false))
                .andExpect(jsonPath("$.inviteError").value("SMTP non configurato"));
        verify(authentik).createUser("mario", "mario@example.com", "Mario Rossi", PASSWORD, true);
        verify(users).saveAndFlush(any(User.class));
        verifyNoInteractions(sender);
        assertFalse(output.getAll().contains(PASSWORD));
    }

    @Test
    void sendFailureKeepsTheAccount(CapturedOutput output) throws Exception {
        doThrow(new MailSendException("Mail server connection failed"))
                .when(sender).send(any(jakarta.mail.internet.MimeMessage.class));
        mvc(configuredMail()).perform(post("/api/admin/users").contentType(MediaType.APPLICATION_JSON).content(body(true)))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.inviteSent").value(false))
                .andExpect(jsonPath("$.inviteError").value(org.hamcrest.Matchers.containsString("Mail server connection failed")));
        verify(users).saveAndFlush(any(User.class));
        verify(authentik, never()).deleteUserQuietly(anyLong());
        assertFalse(output.getAll().contains(PASSWORD), "la password è finita nei log");
    }

    @Test
    void withoutInviteNoMailAndNoForcedChange() throws Exception {
        mvc(configuredMail()).perform(post("/api/admin/users").contentType(MediaType.APPLICATION_JSON).content(body(null)))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.inviteSent").value(false))
                .andExpect(jsonPath("$.inviteError").doesNotExist());
        verify(authentik).createUser("mario", "mario@example.com", "Mario Rossi", PASSWORD, false);
        verifyNoInteractions(sender);
    }
}
