package com.worktogether.service;

import com.worktogether.domain.entity.*;
import com.worktogether.domain.enums.*;
import com.worktogether.dto.request.ElementFilter;
import com.worktogether.dto.response.ApiMemberResponse;
import com.worktogether.dto.response.ElementResponse;
import com.worktogether.repository.*;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.web.server.ResponseStatusException;

import java.time.OffsetDateTime;
import java.util.*;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

/**
 * Logica di servizio usata dalle estensioni delle API key: filtri di GET /elements, elenco membri
 * ridotto (members:read) e assegnazione task/sprint (sprints:write) con le regole di dominio.
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class ApiKeyExtensionServiceTest {

    static final UUID WS = UUID.randomUUID();

    // ---------------------------------------------------------------- Filtri elementi

    @Mock ElementRepository elementRepository;
    @Mock WorkspaceService workspaceService;
    @InjectMocks ElementService elementService;

    final Workspace ws = Workspace.builder().id(WS).build();
    final User author = User.builder().id(UUID.randomUUID()).email("a@example.com").displayName("A").build();
    final Tag tagUi = Tag.builder().id(UUID.randomUUID()).name("ui").build();
    final UUID sprintId = UUID.randomUUID();

    Element story, taskLogin, taskLogout, taskSprint, epic, event;

    private Element el(String title, ElementType type, ElementStatus status, Element parent) {
        return Element.builder().id(UUID.randomUUID()).workspace(ws).title(title).type(type).status(status)
                .parent(parent).createdBy(author).createdAt(OffsetDateTime.now()).build();
    }

    @BeforeEach
    void elements() {
        epic = el("Epica autenticazione", ElementType.EPICA, ElementStatus.DA_FARE, null);
        story = el("Storia accesso", ElementType.STORIA, ElementStatus.IN_CORSO, epic);
        taskLogin = el("Pagina di LOGIN", ElementType.TASK, ElementStatus.DA_FARE, story);
        taskLogin.getTags().add(tagUi);
        taskLogout = el("Logout", ElementType.TASK, ElementStatus.COMPLETATO, story);
        taskSprint = el("Login con SSO", ElementType.TASK, ElementStatus.IN_CORSO, story);
        taskSprint.setSprintId(sprintId);
        event = el("Riunione", ElementType.EVENTO, ElementStatus.DA_FARE, null);
        when(elementRepository.findByWorkspaceId(WS))
                .thenReturn(List.of(epic, story, taskLogin, taskLogout, taskSprint, event));
        when(elementRepository.epicProgressByWorkspace(WS)).thenReturn(List.of());
    }

    private List<String> titles(ElementFilter f) {
        return elementService.getElements(WS, author, false, f).items().stream().map(ElementResponse::title).toList();
    }

    private ElementFilter f(ElementType type, ElementStatus status, UUID parentId, String q, UUID sprint,
                            Boolean backlog, UUID tag, Integer limit, Integer offset) {
        return new ElementFilter(type, status, parentId, q, sprint, backlog, tag, limit, offset);
    }

    @Test
    void noFilterReturnsEverythingInOrder() {
        assertEquals(6, titles(ElementFilter.NONE).size());
        assertEquals(6, elementService.getElements(WS, author, true).size());
    }

    @Test
    void filtersCombineInAnd() {
        assertEquals(List.of("Pagina di LOGIN", "Logout", "Login con SSO"),
                titles(f(ElementType.TASK, null, null, null, null, null, null, null, null)));
        assertEquals(List.of("Pagina di LOGIN", "Login con SSO"),
                titles(f(ElementType.TASK, null, story.getId(), "  login ", null, null, null, null, null)));
        assertEquals(List.of("Logout"),
                titles(f(null, ElementStatus.COMPLETATO, null, null, null, null, null, null, null)));
        assertEquals(List.of("Storia accesso"),
                titles(f(null, null, epic.getId(), null, null, null, null, null, null)));
        assertEquals(List.of("Login con SSO"),
                titles(f(null, null, null, null, sprintId, null, null, null, null)));
        assertEquals(List.of("Pagina di LOGIN", "Logout"),
                titles(f(ElementType.TASK, null, null, null, null, true, null, null, null)));
        assertEquals(List.of("Login con SSO"),
                titles(f(null, null, null, null, null, false, null, null, null)));
        assertEquals(List.of("Pagina di LOGIN"),
                titles(f(null, null, null, null, null, null, tagUi.getId(), null, null)));
    }

    @Test
    void paginationReportsTotalBeforeLimit() {
        var page = elementService.getElements(WS, author, false,
                f(ElementType.TASK, null, null, null, null, null, null, 2, 1));
        assertEquals(3, page.total());
        assertEquals(List.of("Logout", "Login con SSO"), page.items().stream().map(ElementResponse::title).toList());
        assertTrue(elementService.getElements(WS, author, false,
                f(null, null, null, null, null, null, null, 10, 100)).items().isEmpty());
    }

    @Test
    void invalidFiltersAre400() {
        for (ElementFilter bad : List.of(
                f(null, null, null, null, null, null, null, 0, null),
                f(null, null, null, null, null, null, null, ElementFilter.MAX_LIMIT + 1, null),
                f(null, null, null, null, null, null, null, null, -1),
                f(null, null, null, null, sprintId, true, null, null, null),
                f(null, null, null, "x".repeat(ElementFilter.MAX_QUERY_LENGTH + 1), null, null, null, null, null))) {
            var ex = assertThrows(ResponseStatusException.class, () -> elementService.getElements(WS, author, false, bad));
            assertEquals(HttpStatus.BAD_REQUEST, ex.getStatusCode());
        }
    }

    @Test
    void nonMemberCannotList() {
        doThrow(new AccessDeniedException("Not a member of this workspace")).when(workspaceService).assertMember(WS, author);
        assertThrows(AccessDeniedException.class, () -> elementService.getElements(WS, author, false, ElementFilter.NONE));
    }

    // ---------------------------------------------------------------- Membri via API key

    @Test
    void apiKeyMembersHideInvisibleAdminsAndSensitiveFields() {
        WorkspaceMemberRepository memberRepository = mock(WorkspaceMemberRepository.class);
        HiddenMemberRegistry hidden = mock(HiddenMemberRegistry.class);
        WorkspaceService service = new WorkspaceService(null, memberRepository, null, null, null, null, null, null,
                hidden, null, null);

        User owner = User.builder().id(UUID.randomUUID()).email("owner@example.com").displayName("Owner").build();
        User collab = User.builder().id(UUID.randomUUID()).email("c@example.com").displayName("Collab").build();
        User ghost = User.builder().id(UUID.randomUUID()).email("g@example.com").displayName("Ghost").build();
        WorkspaceMember mOwner = WorkspaceMember.builder().user(owner).role(WorkspaceRole.ADMIN).hidden(true).build();
        WorkspaceMember mCollab = WorkspaceMember.builder().user(collab).role(WorkspaceRole.COLLABORATORE).build();
        WorkspaceMember mGhost = WorkspaceMember.builder().user(ghost).role(WorkspaceRole.ADMIN).hidden(true).build();
        when(memberRepository.findByWorkspaceIdAndUserId(WS, owner.getId())).thenReturn(Optional.of(mOwner));
        when(memberRepository.findByWorkspaceId(WS)).thenReturn(List.of(mOwner, mCollab, mGhost));
        when(hidden.hiddenUsers(WS)).thenReturn(Set.of(owner.getId(), ghost.getId()));

        List<ApiMemberResponse> out = service.getMembersForApiKey(WS, owner);
        // L'autore della chiave è admin ma la chiave non vede gli altri admin invisibili.
        assertEquals(List.of(
                new ApiMemberResponse(owner.getId(), "Owner", WorkspaceRole.ADMIN),
                new ApiMemberResponse(collab.getId(), "Collab", WorkspaceRole.COLLABORATORE)), out);
        // Il record espone solo id, nome e ruolo.
        assertEquals(List.of("userId", "displayName", "role"),
                Arrays.stream(ApiMemberResponse.class.getRecordComponents()).map(c -> c.getName()).toList());

        User stranger = User.builder().id(UUID.randomUUID()).build();
        when(memberRepository.findByWorkspaceIdAndUserId(WS, stranger.getId())).thenReturn(Optional.empty());
        assertThrows(AccessDeniedException.class, () -> service.getMembersForApiKey(WS, stranger));
    }

    // ---------------------------------------------------------------- Task ↔ sprint

    @Test
    void sprintTaskAssignmentFollowsDomainRules() {
        SprintRepository sprintRepository = mock(SprintRepository.class);
        WorkspaceService wsService = mock(WorkspaceService.class);
        SprintService sprints = new SprintService(sprintRepository, elementRepository, mock(ChannelRepository.class),
                null, wsService, null, mock(com.worktogether.websocket.WorkspaceEventPublisher.class), null);

        Sprint planned = Sprint.builder().id(UUID.randomUUID()).workspace(ws).name("S2").status(SprintStatus.PLANNED).build();
        Sprint closed = Sprint.builder().id(UUID.randomUUID()).workspace(ws).name("S0").status(SprintStatus.CLOSED).build();
        when(sprintRepository.findById(planned.getId())).thenReturn(Optional.of(planned));
        when(sprintRepository.findById(closed.getId())).thenReturn(Optional.of(closed));
        when(elementRepository.findById(taskLogin.getId())).thenReturn(Optional.of(taskLogin));
        when(elementRepository.findById(story.getId())).thenReturn(Optional.of(story));

        // Collaboratore: può aggiungere e togliere un TASK.
        when(wsService.getUserRole(WS, author)).thenReturn(WorkspaceRole.COLLABORATORE);
        sprints.addTask(WS, planned.getId(), taskLogin.getId(), author);
        assertEquals(planned.getId(), taskLogin.getSprintId());
        sprints.removeTask(WS, planned.getId(), taskLogin.getId(), author);
        assertNull(taskLogin.getSprintId());

        // Solo TASK, mai in una sprint chiusa.
        var notTask = assertThrows(ResponseStatusException.class,
                () -> sprints.addTask(WS, planned.getId(), story.getId(), author));
        assertEquals(HttpStatus.BAD_REQUEST, notTask.getStatusCode());
        var closedEx = assertThrows(ResponseStatusException.class,
                () -> sprints.addTask(WS, closed.getId(), taskLogin.getId(), author));
        assertEquals(HttpStatus.CONFLICT, closedEx.getStatusCode());

        // Un GUEST (anche tramite una sua chiave) non guadagna scrittura.
        when(wsService.getUserRole(WS, author)).thenReturn(WorkspaceRole.GUEST);
        assertThrows(AccessDeniedException.class, () -> sprints.addTask(WS, planned.getId(), taskLogin.getId(), author));
        assertNull(taskLogin.getSprintId());

        // Sprint di un altro workspace: 404 anche se l'id esiste.
        Sprint foreign = Sprint.builder().id(UUID.randomUUID()).workspace(Workspace.builder().id(UUID.randomUUID()).build())
                .status(SprintStatus.PLANNED).build();
        when(sprintRepository.findById(foreign.getId())).thenReturn(Optional.of(foreign));
        when(wsService.getUserRole(WS, author)).thenReturn(WorkspaceRole.COLLABORATORE);
        assertThrows(jakarta.persistence.EntityNotFoundException.class,
                () -> sprints.addTask(WS, foreign.getId(), taskLogin.getId(), author));
    }
}
