package com.worktogether.service;

import com.worktogether.domain.entity.*;
import com.worktogether.domain.enums.*;
import com.worktogether.dto.transfer.*;
import com.worktogether.dto.transfer.WorkspaceExport.*;
import com.worktogether.repository.*;
import jakarta.persistence.EntityNotFoundException;
import jakarta.transaction.Transactional;
import lombok.RequiredArgsConstructor;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.stereotype.Service;

import java.time.OffsetDateTime;
import java.util.*;

/**
 * Backup / ripristino / trasporto di una workspace come singolo JSON.
 *
 * <p><b>Export</b> (admin del workspace): serializza le sezioni selezionate. Gli ID non vengono
 * esportati (in import si rigenerano); i riferimenti interni usano refId, quelli agli utenti l'email.
 * Esclusi per scelta: chiave AI e file binari del Drive.
 *
 * <p><b>Import</b> (system admin): crea sempre una <b>nuova</b> workspace e vi ricostruisce dentro
 * tutte le sezioni presenti nel file. Membri/autori sono riagganciati per email agli account
 * esistenti; le email senza corrispondenza ricadono sull'admin che importa (con un avviso).
 */
@Service
@RequiredArgsConstructor
public class WorkspaceTransferService {

    private final WorkspaceRepository workspaceRepository;
    private final WorkspaceMemberRepository memberRepository;
    private final UserRepository userRepository;
    private final ElementRepository elementRepository;
    private final TagRepository tagRepository;
    private final ChannelRepository channelRepository;
    private final MessageRepository messageRepository;
    private final ChannelMemberRepository channelMemberRepository;
    private final AiSettingsRepository aiSettingsRepository;
    private final WorkspaceService workspaceService;

    // ----------------------------------------------------------------- EXPORT

    @Transactional
    public WorkspaceExport export(UUID workspaceId, User requester, ExportRequest opts) {
        workspaceService.assertRole(workspaceId, requester, WorkspaceRole.ADMIN);
        Workspace ws = workspaceRepository.findById(workspaceId)
                .orElseThrow(() -> new EntityNotFoundException("Workspace non trovato"));

        SettingsData settings = opts.wantSettings() ? new SettingsData(
                ws.isCardShowTags(), ws.isCardShowAssignees(), ws.isCardShowDueDate(),
                ws.getReminderDaysBefore(), ws.isEventRemindersEnabled(),
                ws.isWeeklyRecapEnabled(), ws.isMondayDigestEnabled()) : null;
        WorkspaceData workspaceData = new WorkspaceData(ws.getName(), ws.getDescription(), ws.getAvatar(), settings);

        List<MemberData> members = opts.wantMembers()
                ? memberRepository.findByWorkspaceId(workspaceId).stream()
                    .map(m -> new MemberData(m.getUser().getEmail(), m.getUser().getDisplayName(), m.getRole().name()))
                    .toList()
                : null;

        // Mappa tag → refId: serve sia per la sezione tag sia per i riferimenti degli elementi.
        List<Tag> wsTags = tagRepository.findByWorkspaceIdOrderByNameAsc(workspaceId);
        Map<UUID, String> tagRef = new HashMap<>();
        List<TagData> tags = null;
        if (opts.wantTags()) {
            tags = new ArrayList<>();
            int i = 0;
            for (Tag t : wsTags) {
                String ref = "t" + (i++);
                tagRef.put(t.getId(), ref);
                tags.add(new TagData(ref, t.getName(), t.getColor()));
            }
        }

        List<ElementData> elements = null;
        if (opts.wantElements()) {
            List<Element> all = elementRepository.findByWorkspaceId(workspaceId);
            Map<UUID, String> elemRef = new HashMap<>();
            int i = 0;
            for (Element e : all) elemRef.put(e.getId(), "e" + (i++));
            elements = new ArrayList<>();
            for (Element e : all) {
                List<String> tagRefIds = e.getTags().stream()
                        .map(t -> tagRef.get(t.getId())).filter(Objects::nonNull).toList();
                List<String> assigneeEmails = e.getAssignees().stream().map(User::getEmail).toList();
                elements.add(new ElementData(
                        elemRef.get(e.getId()),
                        e.getParent() != null ? elemRef.get(e.getParent().getId()) : null,
                        e.getType().name(), e.getStatus().name(), e.getTitle(), e.getBody(),
                        e.getStartDate(), e.getEndDate(), e.isAllDay(), e.getPosition(),
                        e.getCreatedAt(), e.getCreatedBy().getEmail(), tagRefIds, assigneeEmails));
            }
        }

        List<ChannelData> channels = null;
        if (opts.wantChat()) {
            channels = new ArrayList<>();
            int i = 0;
            for (Channel c : channelRepository.findByWorkspaceId(workspaceId)) {
                // Le chat di sprint non vengono esportate: le sprint non fanno parte del backup,
                // quindi il canale risulterebbe orfano nella nuova workspace.
                if (c.getType() == ChannelType.SPRINT) continue;
                String ref = "c" + (i++);
                List<String> memberEmails = channelMemberRepository.findByChannelId(c.getId()).stream()
                        .map(m -> m.getUser().getEmail()).toList();
                List<MessageData> messages = messageRepository.findByChannelIdOrderByCreatedAtAsc(c.getId()).stream()
                        .map(m -> new MessageData(m.getAuthor().getEmail(), m.getContent(), m.getCreatedAt(), m.getEditedAt()))
                        .toList();
                channels.add(new ChannelData(ref, c.getType().name(), c.getName(), c.getDescription(),
                        c.isPrivate(), c.isVoiceEnabled(), c.isScreenShareEnabled(), c.getCreatedAt(),
                        c.getCreatedBy() != null ? c.getCreatedBy().getEmail() : null, memberEmails, messages));
            }
        }

        AiData ai = null;
        if (opts.wantAi()) {
            ai = aiSettingsRepository.findById(workspaceId).map(s -> new AiData(
                    s.isEnabled(), s.getModel(), s.getTemperature(), s.getMaxTokens(),
                    s.getContextWindowTokens(), s.getCompactThresholdPct(), s.getAutonomy().name(),
                    s.getMemoryMode().name(), s.getMaxToolIterations(), s.getPersonalityMd(),
                    s.getMemoryMd(), s.getToolsMd())).orElse(null);
        }

        return new WorkspaceExport(WorkspaceExport.FORMAT_VERSION, OffsetDateTime.now(),
                workspaceData, members, tags, elements, channels, ai);
    }

    // ----------------------------------------------------------------- IMPORT

    @Transactional
    public ImportResult importWorkspace(ImportRequest req, User admin) {
        if (!admin.isSystemAdmin()) {
            throw new AccessDeniedException("Solo un amministratore di sistema può importare una workspace");
        }
        WorkspaceExport data = req.data();
        WorkspaceData wd = data.workspace();
        if (wd == null) throw new IllegalArgumentException("Il file non contiene una workspace valida");

        Set<String> warnings = new LinkedHashSet<>();
        Set<String> missingEmails = new HashSet<>();

        // 1. Nuova workspace (ID rigenerati). Le impostazioni applicate solo se presenti nel file.
        String name = (req.newName() != null && !req.newName().isBlank()) ? req.newName().trim() : wd.name();
        Workspace.WorkspaceBuilder b = Workspace.builder()
                .name(name).description(wd.description()).avatar(wd.avatar()).createdBy(admin);
        SettingsData s = wd.settings();
        if (s != null) {
            b.cardShowTags(s.cardShowTags()).cardShowAssignees(s.cardShowAssignees())
             .cardShowDueDate(s.cardShowDueDate()).reminderDaysBefore(s.reminderDaysBefore())
             .eventRemindersEnabled(s.eventRemindersEnabled()).weeklyRecapEnabled(s.weeklyRecapEnabled())
             .mondayDigestEnabled(s.mondayDigestEnabled());
        }
        Workspace ws = workspaceRepository.save(b.build());

        // L'admin che importa è sempre membro ADMIN (così può accedere alla workspace).
        Set<UUID> addedMembers = new HashSet<>();
        memberRepository.save(WorkspaceMember.builder().workspace(ws).user(admin).role(WorkspaceRole.ADMIN).build());
        addedMembers.add(admin.getId());

        // 2. Membri (riagganciati per email; gli sconosciuti vengono saltati con avviso).
        int memberCount = 1;
        if (data.members() != null) {
            for (MemberData m : data.members()) {
                User u = userRepository.findByEmail(m.email()).orElse(null);
                if (u == null) { warnings.add("Membro non trovato (saltato): " + m.email()); continue; }
                if (addedMembers.add(u.getId())) {
                    memberRepository.save(WorkspaceMember.builder()
                            .workspace(ws).user(u).role(parseRole(m.role())).build());
                    memberCount++;
                }
            }
        }

        // 3. Tag.
        Map<String, Tag> tagsByRef = new HashMap<>();
        int tagCount = 0;
        if (data.tags() != null) {
            for (TagData t : data.tags()) {
                Tag saved = tagRepository.save(Tag.builder()
                        .workspace(ws).name(t.name()).color(t.color() != null ? t.color() : "#94a3b8").build());
                tagsByRef.put(t.refId(), saved);
                tagCount++;
            }
        }

        // 4. Elementi (2 passaggi: prima creazione, poi link al parent).
        Map<String, Element> elemByRef = new HashMap<>();
        int elemCount = 0;
        if (data.elements() != null) {
            for (ElementData e : data.elements()) {
                Set<Tag> tags = new HashSet<>();
                if (e.tagRefIds() != null) for (String r : e.tagRefIds()) {
                    Tag t = tagsByRef.get(r);
                    if (t != null) tags.add(t);
                }
                Set<User> assignees = new HashSet<>();
                if (e.assigneeEmails() != null) for (String email : e.assigneeEmails()) {
                    userRepository.findByEmail(email).ifPresentOrElse(assignees::add,
                            () -> { if (email != null) warnings.add("Assegnatario non trovato (saltato): " + email); });
                }
                Element saved = elementRepository.save(Element.builder()
                        .workspace(ws)
                        .type(ElementType.valueOf(e.type()))
                        .status(ElementStatus.valueOf(e.status()))
                        .title(e.title()).body(e.body())
                        .startDate(e.startDate()).endDate(e.endDate()).allDay(e.allDay())
                        .position(e.position())
                        .createdAt(e.createdAt() != null ? e.createdAt() : OffsetDateTime.now())
                        .createdBy(resolveUserOrAdmin(e.createdByEmail(), admin, warnings, missingEmails))
                        .tags(tags).assignees(assignees)
                        .build());
                elemByRef.put(e.refId(), saved);
                elemCount++;
            }
            // Passaggio 2: imposta i parent ora che tutti i refId sono mappati.
            for (ElementData e : data.elements()) {
                if (e.parentRefId() == null) continue;
                Element child = elemByRef.get(e.refId());
                Element parent = elemByRef.get(e.parentRefId());
                if (child != null && parent != null) {
                    child.setParent(parent);
                    elementRepository.save(child);
                }
            }
        }

        // 5. Chat: canali + membri + messaggi.
        int channelCount = 0, messageCount = 0;
        if (data.channels() != null) {
            for (ChannelData c : data.channels()) {
                Channel channel = channelRepository.save(Channel.builder()
                        .workspace(ws)
                        .type(ChannelType.valueOf(c.type()))
                        .name(c.name()).description(c.description())
                        .isPrivate(c.isPrivate()).voiceEnabled(c.voiceEnabled())
                        .screenShareEnabled(c.screenShareEnabled())
                        .createdAt(c.createdAt() != null ? c.createdAt() : OffsetDateTime.now())
                        .createdBy(c.createdByEmail() != null
                                ? resolveUserOrAdmin(c.createdByEmail(), admin, warnings, missingEmails) : null)
                        .build());
                channelCount++;

                if (c.memberEmails() != null) {
                    Set<UUID> seen = new HashSet<>();
                    for (String email : c.memberEmails()) {
                        User u = userRepository.findByEmail(email).orElse(null);
                        if (u != null && seen.add(u.getId())) {
                            channelMemberRepository.save(ChannelMember.builder()
                                    .channel(channel).user(u).build());
                        }
                    }
                }
                if (c.messages() != null) {
                    for (MessageData m : c.messages()) {
                        messageRepository.save(Message.builder()
                                .channel(channel)
                                .author(resolveUserOrAdmin(m.authorEmail(), admin, warnings, missingEmails))
                                .content(m.content())
                                .createdAt(m.createdAt() != null ? m.createdAt() : OffsetDateTime.now())
                                .editedAt(m.editedAt())
                                .build());
                        messageCount++;
                    }
                }
            }
        }

        // 6. Impostazioni AI (senza chiave API: esclusa per scelta).
        boolean aiImported = false;
        if (data.ai() != null) {
            AiData a = data.ai();
            aiSettingsRepository.save(AiSettings.builder()
                    .workspaceId(ws.getId())
                    .enabled(a.enabled())
                    .openrouterApiKey(null)
                    .model(a.model())
                    .temperature(a.temperature())
                    .maxTokens(a.maxTokens())
                    .contextWindowTokens(a.contextWindowTokens())
                    .compactThresholdPct(a.compactThresholdPct())
                    .autonomy(AiAutonomy.valueOf(a.autonomy()))
                    .memoryMode(AiMemoryMode.valueOf(a.memoryMode()))
                    .maxToolIterations(a.maxToolIterations())
                    .personalityMd(a.personalityMd() != null ? a.personalityMd() : "")
                    .memoryMd(a.memoryMd() != null ? a.memoryMd() : "")
                    .toolsMd(a.toolsMd() != null ? a.toolsMd() : "")
                    .build());
            aiImported = true;
            if (a.enabled()) warnings.add("AI importata: reinserisci la chiave OpenRouter (non è inclusa nel backup).");
        }

        return new ImportResult(ws.getId(), ws.getName(), memberCount, tagCount,
                elemCount, channelCount, messageCount, aiImported, new ArrayList<>(warnings));
    }

    // ----------------------------------------------------------------- Helper

    /** Risolve l'utente per email; se manca attribuisce all'admin che importa (con avviso una volta). */
    private User resolveUserOrAdmin(String email, User admin, Set<String> warnings, Set<String> missingEmails) {
        if (email != null) {
            User u = userRepository.findByEmail(email).orElse(null);
            if (u != null) return u;
            if (missingEmails.add(email)) {
                warnings.add("Email senza account (attribuita all'admin): " + email);
            }
        }
        return admin;
    }

    private WorkspaceRole parseRole(String role) {
        try {
            return role != null ? WorkspaceRole.valueOf(role) : WorkspaceRole.COLLABORATORE;
        } catch (IllegalArgumentException ex) {
            return WorkspaceRole.COLLABORATORE;
        }
    }
}
