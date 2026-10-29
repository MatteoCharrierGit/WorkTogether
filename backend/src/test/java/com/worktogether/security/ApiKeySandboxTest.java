package com.worktogether.security;

import com.worktogether.config.SecurityConfig;
import com.worktogether.config.WebConfig;
import com.worktogether.controller.AiController;
import com.worktogether.controller.ApiKeyController;
import com.worktogether.controller.ChannelController;
import com.worktogether.controller.ElementController;
import com.worktogether.controller.GlobalExceptionHandler;
import com.worktogether.controller.SprintController;
import com.worktogether.controller.WorkspaceController;
import com.worktogether.domain.entity.ApiKey;
import com.worktogether.domain.entity.User;
import com.worktogether.domain.enums.ElementStatus;
import com.worktogether.domain.enums.ElementType;
import com.worktogether.domain.enums.WorkspaceRole;
import com.worktogether.dto.request.ElementFilter;
import com.worktogether.dto.response.ApiMemberResponse;
import com.worktogether.dto.response.SprintDetailResponse;
import com.worktogether.repository.ApiKeyRepository;
import com.worktogether.repository.UserRepository;
import com.worktogether.service.*;
import com.worktogether.service.ai.*;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/**
 * Sandbox delle API key con la catena di sicurezza reale (ApiKeyAuthFilter + ApiKeyScopeInterceptor)
 * davanti ai controller veri; servizi e repository mockati. Verifica scope, confinamento al
 * workspace e negazione per default delle rotte non elencate.
 */
@WebMvcTest(controllers = {WorkspaceController.class, SprintController.class, ElementController.class,
        ApiKeyController.class, AiController.class, ChannelController.class})
@Import({SecurityConfig.class, WebConfig.class, OidcConfig.class, OidcUserService.class,
        OidcAuthFilter.class, ApiKeyAuthFilter.class, ApiKeyScopeInterceptor.class, GlobalExceptionHandler.class})
class ApiKeySandboxTest {

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
    }

    @AfterAll
    static void stop() {
        OIDC.close();
    }

    static final UUID WS = UUID.randomUUID();
    static final UUID OTHER_WS = UUID.randomUUID();
    static final UUID SPRINT = UUID.randomUUID();
    static final UUID TASK = UUID.randomUUID();
    static final String ALL_SCOPES = "elements:read,elements:write,drive:read,drive:write,tags:read,tags:write,"
            + "members:read,sprints:read,sprints:write";
    // Scope di una chiave creata prima di questa modifica: nessuno scope nuovo implicito.
    static final String LEGACY_SCOPES = "elements:read,elements:write,drive:read,drive:write,tags:read,tags:write";

    @Autowired MockMvc mvc;
    @MockBean UserRepository userRepository;
    @MockBean ApiKeyRepository apiKeyRepository;
    @MockBean WorkspaceService workspaceService;
    @MockBean SprintService sprintService;
    @MockBean ElementService elementService;
    @MockBean ApiKeyService apiKeyService;
    @MockBean ChannelService channelService;
    @MockBean AiSettingsService aiSettingsService;
    @MockBean AiConversationService aiConversationService;
    @MockBean AiChatService aiChatService;
    @MockBean AiCommandService aiCommandService;
    @MockBean AiAdminService aiAdminService;
    @MockBean UserAvatarService avatarService;

    User owner = User.builder().id(UUID.randomUUID()).email("matteo@example.com").displayName("Matteo").build();
    int keyCounter = 0;

    @BeforeEach
    void defaults() {
        when(userRepository.findById(owner.getId())).thenReturn(Optional.of(owner));
        when(elementService.getElements(any(), any(), anyBoolean(), any()))
                .thenReturn(new ElementService.ElementPage(List.of(), 0));
        when(sprintService.list(any(), any())).thenReturn(List.of());
        when(sprintService.getOne(any(), any(), any())).thenReturn(new SprintDetailResponse(null, List.of()));
        when(sprintService.getActive(any(), any())).thenReturn(new SprintDetailResponse(null, List.of()));
    }

    /** Crea una chiave (vera entità) del workspace indicato con gli scope dati; ritorna il segreto. */
    private String key(UUID ws, String scopes) {
        String raw = "wt_test" + (++keyCounter);
        ApiKey k = ApiKey.builder().id(UUID.randomUUID()).workspaceId(ws).name("test").keyHash("h").keyPrefix("wt_test")
                .scopes(scopes).createdBy(owner.getId()).lastUsedAt(OffsetDateTime.now()).build();
        when(apiKeyRepository.findByKeyHash(ApiKeyService.sha256Hex(raw))).thenReturn(Optional.of(k));
        return raw;
    }

    private MockHttpServletRequestBuilder as(MockHttpServletRequestBuilder b, String raw) {
        return b.header("Authorization", "Bearer " + raw);
    }

    private String ws(String path) {
        return "/api/workspaces/" + WS + path;
    }

    // ---- members:read ----

    @Test
    void membersReadReturnsReducedList() throws Exception {
        when(workspaceService.getMembersForApiKey(WS, owner)).thenReturn(
                List.of(new ApiMemberResponse(owner.getId(), "Matteo", WorkspaceRole.ADMIN)));
        mvc.perform(as(get(ws("/members")), key(WS, "members:read")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].userId").value(owner.getId().toString()))
                .andExpect(jsonPath("$[0].displayName").value("Matteo"))
                .andExpect(jsonPath("$[0].role").value("ADMIN"))
                .andExpect(jsonPath("$[0].email").doesNotExist())
                .andExpect(jsonPath("$[0].hidden").doesNotExist());
        verify(workspaceService, never()).getMembers(any(), any());
    }

    @Test
    void membersWithoutScopeIs403() throws Exception {
        mvc.perform(as(get(ws("/members")), key(WS, LEGACY_SCOPES)))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.error").value("Scope insufficienti per questa operazione: serve members:read"));
        verifyNoInteractions(workspaceService);
    }

    @Test
    void membersOfAnotherWorkspaceIs403() throws Exception {
        mvc.perform(as(get("/api/workspaces/" + OTHER_WS + "/members"), key(WS, ALL_SCOPES)))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.error").value("La API key non è abilitata per questo workspace"));
        verifyNoInteractions(workspaceService);
    }

    @Test
    void memberWritesAreDeniedEvenWithAllScopes() throws Exception {
        String k = key(WS, ALL_SCOPES);
        UUID u = UUID.randomUUID();
        mvc.perform(as(patch(ws("/members/" + u + "/role")).param("role", "ADMIN"), k)).andExpect(status().isForbidden());
        mvc.perform(as(post(ws("/members")).param("userId", u.toString()).param("role", "GUEST"), k)).andExpect(status().isForbidden());
        mvc.perform(as(delete(ws("/members/" + u)), k)).andExpect(status().isForbidden());
        mvc.perform(as(patch(ws("/members/me/hidden")).contentType(MediaType.APPLICATION_JSON).content("{\"hidden\":true}"), k))
                .andExpect(status().isForbidden());
        verifyNoInteractions(workspaceService);
    }

    // ---- sprints:read / sprints:write ----

    @Test
    void sprintsReadAllowsListActiveAndDetail() throws Exception {
        String k = key(WS, "sprints:read");
        mvc.perform(as(get(ws("/sprints")), k)).andExpect(status().isOk());
        mvc.perform(as(get(ws("/sprints/active")), k)).andExpect(status().isOk());
        mvc.perform(as(get(ws("/sprints/" + SPRINT)), k)).andExpect(status().isOk());
        verify(sprintService).list(WS, owner);
        verify(sprintService).getActive(WS, owner);
        verify(sprintService).getOne(WS, SPRINT, owner);
    }

    @Test
    void sprintsReadWithoutScopeIs403() throws Exception {
        // Né le chiavi esistenti né sprints:write danno la lettura: nessuno scope implicito.
        mvc.perform(as(get(ws("/sprints")), key(WS, LEGACY_SCOPES))).andExpect(status().isForbidden());
        mvc.perform(as(get(ws("/sprints")), key(WS, "sprints:write"))).andExpect(status().isForbidden());
        verifyNoInteractions(sprintService);
    }

    @Test
    void sprintsWriteAddsAndRemovesTask() throws Exception {
        String k = key(WS, "sprints:write");
        mvc.perform(as(post(ws("/sprints/" + SPRINT + "/tasks/" + TASK)), k)).andExpect(status().isNoContent());
        mvc.perform(as(delete(ws("/sprints/" + SPRINT + "/tasks/" + TASK)), k)).andExpect(status().isNoContent());
        verify(sprintService).addTask(WS, SPRINT, TASK, owner);
        verify(sprintService).removeTask(WS, SPRINT, TASK, owner);
    }

    @Test
    void sprintTaskAssignmentNeedsWriteScope() throws Exception {
        String k = key(WS, "sprints:read,elements:write");
        mvc.perform(as(post(ws("/sprints/" + SPRINT + "/tasks/" + TASK)), k)).andExpect(status().isForbidden());
        mvc.perform(as(delete(ws("/sprints/" + SPRINT + "/tasks/" + TASK)), k)).andExpect(status().isForbidden());
        verify(sprintService, never()).addTask(any(), any(), any(), any());
        verify(sprintService, never()).removeTask(any(), any(), any(), any());
    }

    @Test
    void sprintTaskAssignmentInAnotherWorkspaceIs403() throws Exception {
        mvc.perform(as(post("/api/workspaces/" + OTHER_WS + "/sprints/" + SPRINT + "/tasks/" + TASK), key(WS, ALL_SCOPES)))
                .andExpect(status().isForbidden());
        verifyNoInteractions(sprintService);
    }

    @Test
    void sprintLifecycleIsDeniedEvenWithAllScopes() throws Exception {
        String k = key(WS, ALL_SCOPES);
        String body = "{\"name\":\"S1\"}";
        mvc.perform(as(post(ws("/sprints")).contentType(MediaType.APPLICATION_JSON).content(body), k)).andExpect(status().isForbidden());
        mvc.perform(as(patch(ws("/sprints/" + SPRINT)).contentType(MediaType.APPLICATION_JSON).content(body), k)).andExpect(status().isForbidden());
        mvc.perform(as(delete(ws("/sprints/" + SPRINT)), k)).andExpect(status().isForbidden());
        mvc.perform(as(post(ws("/sprints/" + SPRINT + "/start")), k)).andExpect(status().isForbidden());
        mvc.perform(as(post(ws("/sprints/" + SPRINT + "/close")), k)).andExpect(status().isForbidden());
        verifyNoInteractions(sprintService);
    }

    // ---- negazione per default ----

    @Test
    void unlistedRoutesAreDeniedEvenWithAllScopes() throws Exception {
        String k = key(WS, ALL_SCOPES);
        mvc.perform(as(patch(ws("/settings")).contentType(MediaType.APPLICATION_JSON).content("{}"), k)).andExpect(status().isForbidden());
        mvc.perform(as(delete("/api/workspaces/" + WS), k)).andExpect(status().isForbidden());
        mvc.perform(as(get("/api/workspaces"), k)).andExpect(status().isForbidden());
        mvc.perform(as(get(ws("/api-keys")), k)).andExpect(status().isForbidden());
        mvc.perform(as(post(ws("/api-keys")).contentType(MediaType.APPLICATION_JSON)
                .content("{\"name\":\"x\",\"scopes\":[\"members:read\"]}"), k)).andExpect(status().isForbidden());
        mvc.perform(as(get(ws("/ai/status")), k)).andExpect(status().isForbidden());
        mvc.perform(as(get(ws("/channels")), k)).andExpect(status().isForbidden());
        mvc.perform(as(get(ws("/nonesiste")), k)).andExpect(status().isForbidden());
        verifyNoInteractions(workspaceService, apiKeyService, channelService, aiSettingsService, aiChatService, aiAdminService);
    }

    // ---- filtri su GET /elements ----

    @Test
    void elementFiltersArePassedToService() throws Exception {
        UUID parent = UUID.randomUUID();
        UUID tag = UUID.randomUUID();
        when(elementService.getElements(any(), any(), anyBoolean(), any()))
                .thenReturn(new ElementService.ElementPage(List.of(), 42));
        mvc.perform(as(get(ws("/elements")).param("type", "TASK").param("status", "IN_CORSO")
                        .param("parentId", parent.toString()).param("q", "Login").param("sprintId", SPRINT.toString())
                        .param("tagId", tag.toString()).param("limit", "10").param("offset", "20"),
                        key(WS, "elements:read")))
                .andExpect(status().isOk())
                .andExpect(header().string("X-Total-Count", "42"));
        ArgumentCaptor<ElementFilter> f = ArgumentCaptor.forClass(ElementFilter.class);
        verify(elementService).getElements(eq(WS), eq(owner), eq(true), f.capture());
        assertEquals(new ElementFilter(ElementType.TASK, ElementStatus.IN_CORSO, parent, "Login", SPRINT, null, tag, 10, 20),
                f.getValue());
    }

    @Test
    void elementListWithoutParamsIsUnfiltered() throws Exception {
        mvc.perform(as(get(ws("/elements")), key(WS, "elements:read"))).andExpect(status().isOk());
        verify(elementService).getElements(WS, owner, true, ElementFilter.NONE);
    }

    @Test
    void invalidElementFilterIs400() throws Exception {
        mvc.perform(as(get(ws("/elements")).param("type", "NONESISTE"), key(WS, "elements:read")))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error").value("Valore non valido per il parametro type"));
    }

    @Test
    void elementsOfAnotherWorkspaceIs403() throws Exception {
        mvc.perform(as(get("/api/workspaces/" + OTHER_WS + "/elements"), key(WS, ALL_SCOPES)))
                .andExpect(status().isForbidden());
        verifyNoInteractions(elementService);
    }

    @Test
    void elementsWithoutScopeIs403() throws Exception {
        mvc.perform(as(get(ws("/elements")), key(WS, "members:read,sprints:read,sprints:write")))
                .andExpect(status().isForbidden());
        verifyNoInteractions(elementService);
    }
}
