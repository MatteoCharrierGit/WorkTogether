package com.worktogether.security;

import com.worktogether.config.SecurityConfig;
import com.worktogether.config.WebConfig;
import com.worktogether.controller.GlobalExceptionHandler;
import com.worktogether.controller.UserController;
import com.worktogether.domain.entity.ApiKey;
import com.worktogether.domain.entity.User;
import com.worktogether.repository.ApiKeyRepository;
import com.worktogether.repository.UserRepository;
import com.worktogether.service.ApiKeyService;
import com.worktogether.service.ElementService;
import com.worktogether.service.OidcUserService;
import com.worktogether.service.UserAvatarService;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;

import java.time.Instant;
import java.util.Date;
import java.util.Optional;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/**
 * Catena di sicurezza reale (SecurityConfig + OidcAuthFilter + ApiKeyAuthFilter + decoder Nimbus
 * con JWKS su HTTP locale) davanti a UserController; repository mockati.
 */
@WebMvcTest(controllers = UserController.class)
@Import({SecurityConfig.class, WebConfig.class, OidcConfig.class, OidcUserService.class,
        OidcAuthFilter.class, ApiKeyAuthFilter.class, ApiKeyScopeInterceptor.class, GlobalExceptionHandler.class})
class OidcAuthenticationTest {

    static final TestOidcProvider OIDC;
    static {
        try {
            OIDC = new TestOidcProvider();
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    @DynamicPropertySource
    static void oidcProps(DynamicPropertyRegistry r) {
        r.add("app.oidc.issuer", OIDC::issuer);
        r.add("app.oidc.audience", () -> TestOidcProvider.AUDIENCE);
        r.add("app.oidc.jwks-url", OIDC::jwksUrl);
        r.add("app.admin.init-email", () -> "Boss@Example.com");
    }

    @AfterAll
    static void stop() {
        OIDC.close();
    }

    @Autowired MockMvc mvc;
    @MockBean UserRepository userRepository;
    @MockBean ApiKeyRepository apiKeyRepository;
    @MockBean ElementService elementService;
    @MockBean UserAvatarService avatarService;

    @BeforeEach
    void defaults() {
        when(userRepository.findByOidcSubject(anyString())).thenReturn(Optional.empty());
        when(userRepository.findByEmail(anyString())).thenReturn(Optional.empty());
        when(userRepository.saveAndFlush(any(User.class))).thenAnswer(inv -> {
            User u = inv.getArgument(0);
            if (u.getId() == null) u.setId(UUID.randomUUID());
            return u;
        });
    }

    private User existing(String sub, String email, String name) {
        User u = User.builder().id(UUID.randomUUID()).oidcSubject(sub).email(email).displayName(name).build();
        if (sub != null) when(userRepository.findByOidcSubject(sub)).thenReturn(Optional.of(u));
        if (email != null) when(userRepository.findByEmail(email)).thenReturn(Optional.of(u));
        return u;
    }

    // ---- Validazione del token ----

    @Test
    void validTokenAuthenticatesUserBySub() throws Exception {
        User u = existing("sub-1", "mario@example.com", "Mario");
        mvc.perform(get("/api/users/me").header("Authorization", "Bearer " + OIDC.token("sub-1", b -> {})))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value(u.getId().toString()))
                .andExpect(jsonPath("$.displayName").value("Mario"))
                .andExpect(jsonPath("$.mustResetPassword").doesNotExist());
        verify(userRepository, never()).saveAndFlush(any());
    }

    @Test
    void missingTokenIs401() throws Exception {
        mvc.perform(get("/api/users/me")).andExpect(status().isUnauthorized());
    }

    @Test
    void wrongIssuerIs401() throws Exception {
        existing("sub-1", null, "Mario");
        String token = OIDC.token("sub-1", b -> b.issuer("https://evil.example.com/application/o/worktogether/"));
        mvc.perform(get("/api/users/me").header("Authorization", "Bearer " + token))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void wrongAudienceIs401() throws Exception {
        existing("sub-1", null, "Mario");
        String token = OIDC.token("sub-1", b -> b.audience("altra-app"));
        mvc.perform(get("/api/users/me").header("Authorization", "Bearer " + token))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void expiredTokenIs401() throws Exception {
        existing("sub-1", null, "Mario");
        Instant past = Instant.now().minusSeconds(3600);
        String token = OIDC.token("sub-1", b -> b.issueTime(Date.from(past)).expirationTime(Date.from(past.plusSeconds(300))));
        mvc.perform(get("/api/users/me").header("Authorization", "Bearer " + token))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void tokenWithoutExpIs401() throws Exception {
        existing("sub-1", null, "Mario");
        String token = OIDC.token("sub-1", b -> b.expirationTime(null));
        mvc.perform(get("/api/users/me").header("Authorization", "Bearer " + token))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void badSignatureIs401() throws Exception {
        existing("sub-1", null, "Mario");
        mvc.perform(get("/api/users/me").header("Authorization", "Bearer " + OIDC.tokenSignedByOtherKey("sub-1")))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void garbageTokenIs401() throws Exception {
        mvc.perform(get("/api/users/me").header("Authorization", "Bearer abc.def.ghi"))
                .andExpect(status().isUnauthorized());
    }

    // ---- Collegamento / creazione dell'utente interno ----

    @Test
    void firstAccessLinksExistingUserByVerifiedEmail() throws Exception {
        User legacy = existing(null, "mario@example.com", "Mario");
        String token = OIDC.token("sub-new", TestOidcProvider.profile("Mario@Example.com", true, "Mario Rossi"));
        mvc.perform(get("/api/users/me").header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value(legacy.getId().toString()))
                .andExpect(jsonPath("$.displayName").value("Mario"));
        assertEquals("sub-new", legacy.getOidcSubject());
        verify(userRepository).saveAndFlush(legacy);
    }

    @Test
    void unverifiedEmailDoesNotLinkAndIs403() throws Exception {
        User legacy = existing(null, "mario@example.com", "Mario");
        String token = OIDC.token("sub-new", TestOidcProvider.profile("mario@example.com", false, "Mario Rossi"));
        mvc.perform(get("/api/users/me").header("Authorization", "Bearer " + token))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("OIDC_ACCOUNT"));
        assertNull(legacy.getOidcSubject());
        verify(userRepository, never()).saveAndFlush(any());
    }

    @Test
    void emailAlreadyLinkedToAnotherIdentityIs409() throws Exception {
        existing("sub-old", "mario@example.com", "Mario");
        when(userRepository.findByOidcSubject("sub-new")).thenReturn(Optional.empty());
        String token = OIDC.token("sub-new", TestOidcProvider.profile("mario@example.com", true, "Mario Rossi"));
        mvc.perform(get("/api/users/me").header("Authorization", "Bearer " + token))
                .andExpect(status().isConflict());
    }

    @Test
    void unknownIdentityCreatesNormalUser() throws Exception {
        when(userRepository.existsByDisplayName("Luca Bianchi")).thenReturn(true); // omonimo
        String token = OIDC.token("sub-luca", TestOidcProvider.profile("luca@example.com", true, "Luca Bianchi"));
        mvc.perform(get("/api/users/me").header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.displayName").value("Luca Bianchi 2"))
                .andExpect(jsonPath("$.email").value("luca@example.com"))
                .andExpect(jsonPath("$.systemAdmin").value(false));
        ArgumentCaptor<User> saved = ArgumentCaptor.forClass(User.class);
        verify(userRepository).saveAndFlush(saved.capture());
        assertEquals("sub-luca", saved.getValue().getOidcSubject());
    }

    @Test
    void adminInitEmailBecomesSystemAdminOnFirstAccess() throws Exception {
        String token = OIDC.token("sub-boss", TestOidcProvider.profile("boss@example.com", true, "Matteo"));
        mvc.perform(get("/api/users/me").header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.systemAdmin").value(true));
    }

    @Test
    void adminInitEmailNotVerifiedIsNotAdmin() throws Exception {
        String token = OIDC.token("sub-boss", TestOidcProvider.profile("boss@example.com", false, "Matteo"));
        mvc.perform(get("/api/users/me").header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.systemAdmin").value(false))
                .andExpect(jsonPath("$.email").value(org.hamcrest.Matchers.nullValue()));
    }

    // ---- API key: continuano a funzionare accanto a OIDC ----

    @Test
    void apiKeyStillAuthenticates() throws Exception {
        User owner = existing("sub-1", "mario@example.com", "Mario");
        String raw = "wt_testkey123";
        ApiKey key = mock(ApiKey.class);
        when(key.isActive()).thenReturn(true);
        when(key.getCreatedBy()).thenReturn(owner.getId());
        when(key.getLastUsedAt()).thenReturn(java.time.OffsetDateTime.now());
        when(apiKeyRepository.findByKeyHash(ApiKeyService.sha256Hex(raw))).thenReturn(Optional.of(key));
        when(userRepository.findById(owner.getId())).thenReturn(Optional.of(owner));

        // Autenticata (non 401): poi lo scope interceptor nega /api/users/me alle API key (403).
        mvc.perform(get("/api/users/me").header("Authorization", "Bearer " + raw))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.error").value("Questa risorsa non è accessibile tramite API key"));
    }

    @Test
    void unknownApiKeyIs401() throws Exception {
        when(apiKeyRepository.findByKeyHash(anyString())).thenReturn(Optional.empty());
        mvc.perform(get("/api/users/me").header("Authorization", "Bearer wt_nope"))
                .andExpect(status().isUnauthorized());
    }
}
