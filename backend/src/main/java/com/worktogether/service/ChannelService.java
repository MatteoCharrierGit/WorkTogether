package com.worktogether.service;

import com.worktogether.domain.entity.*;
import com.worktogether.domain.enums.ChannelType;
import com.worktogether.domain.enums.WorkspaceRole;
import com.worktogether.dto.request.CreateGroupRequest;
import com.worktogether.dto.request.RoomRequest;
import com.worktogether.dto.response.ChannelMemberDto;
import com.worktogether.dto.response.ChannelResponse;
import com.worktogether.dto.response.MessageResponse;
import com.worktogether.dto.response.VoiceTokenResponse;
import com.worktogether.repository.*;
import com.worktogether.websocket.WorkspaceEventPublisher;
import jakarta.persistence.EntityNotFoundException;
import jakarta.transaction.Transactional;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.PageRequest;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

import java.time.OffsetDateTime;
import java.util.*;

@Service
@RequiredArgsConstructor
public class ChannelService {

    private final ChannelRepository channelRepository;
    private final ChannelMemberRepository memberRepository;
    private final MessageRepository messageRepository;
    private final WorkspaceRepository workspaceRepository;
    private final UserRepository userRepository;
    private final WorkspaceMemberRepository workspaceMemberRepository;
    private final WorkspaceService workspaceService;
    private final WorkspaceEventPublisher eventPublisher;
    private final LiveKitService liveKit;

    // ---------------------------------------------------------------- Lettura

    @Transactional
    public List<ChannelResponse> listChannels(UUID workspaceId, User user) {
        workspaceService.assertMember(workspaceId, user);

        // Canali di cui l'utente è membro esplicito (DM, GROUP, ROOM private) + ROOM pubbliche.
        Map<UUID, Channel> accessible = new LinkedHashMap<>();
        for (Channel c : channelRepository.findMemberChannels(workspaceId, user.getId())) {
            accessible.put(c.getId(), c);
        }
        for (Channel c : channelRepository.findPublicRooms(workspaceId)) {
            accessible.putIfAbsent(c.getId(), c);
        }

        List<ChannelResponse> result = new ArrayList<>();
        for (Channel c : accessible.values()) {
            result.add(buildResponse(c, user));
        }
        // Ordina per ultimo messaggio (o updatedAt) decrescente.
        result.sort(Comparator.comparing(
                (ChannelResponse r) -> r.lastMessage() != null ? r.lastMessage().createdAt() : r.updatedAt(),
                Comparator.nullsLast(Comparator.reverseOrder())));
        return result;
    }

    @Transactional
    public List<ChannelResponse> listRooms(UUID workspaceId, User user) {
        workspaceService.assertRole(workspaceId, user, WorkspaceRole.ADMIN);
        return channelRepository.findRooms(workspaceId).stream()
                .map(c -> buildResponse(c, user))
                .toList();
    }

    @Transactional
    public List<MessageResponse> getMessages(UUID workspaceId, UUID channelId, User user,
                                             OffsetDateTime before, int limit) {
        Channel channel = loadChannel(workspaceId, channelId);
        assertChannelAccess(channel, user);
        int size = Math.min(Math.max(limit, 1), 100);
        PageRequest page = PageRequest.of(0, size);
        List<Message> msgs = (before != null)
                ? messageRepository.findBefore(channelId, before, page)
                : messageRepository.findLatest(channelId, page);
        // findLatest/findBefore restituiscono desc; la UI li vuole in ordine cronologico.
        List<MessageResponse> out = new ArrayList<>(msgs.stream().map(MessageResponse::from).toList());
        Collections.reverse(out);
        return out;
    }

    // ---------------------------------------------------------------- DM / Gruppi

    @Transactional
    public ChannelResponse getOrCreateDm(UUID workspaceId, User user, UUID otherUserId) {
        workspaceService.assertMember(workspaceId, user);
        if (otherUserId.equals(user.getId())) {
            throw new AccessDeniedException("Non puoi aprire un DM con te stesso");
        }
        User other = userRepository.findById(otherUserId)
                .orElseThrow(() -> new EntityNotFoundException("Utente non trovato"));
        workspaceService.assertMember(workspaceId, other);

        List<Channel> existing = channelRepository.findDmBetween(workspaceId, user.getId(), otherUserId);
        if (!existing.isEmpty()) {
            return buildResponse(existing.get(0), user);
        }

        Workspace ws = workspaceRepository.getReferenceById(workspaceId);
        Channel dm = channelRepository.save(Channel.builder()
                .workspace(ws).type(ChannelType.DM).createdBy(user).build());
        addMember(dm, user);
        addMember(dm, other);
        broadcastChannelEvent(workspaceId, "CHANNEL_CREATED", dm.getId());
        return buildResponse(dm, user);
    }

    @Transactional
    public ChannelResponse createGroup(UUID workspaceId, User user, CreateGroupRequest req) {
        workspaceService.assertMember(workspaceId, user);
        Workspace ws = workspaceRepository.getReferenceById(workspaceId);
        Channel group = channelRepository.save(Channel.builder()
                .workspace(ws).type(ChannelType.GROUP).name(req.name().trim()).createdBy(user).build());
        addMember(group, user);
        if (req.memberIds() != null) {
            for (UUID id : new HashSet<>(req.memberIds())) {
                if (id.equals(user.getId())) continue;
                addMember(group, requireWorkspaceMember(workspaceId, id));
            }
        }
        broadcastChannelEvent(workspaceId, "CHANNEL_CREATED", group.getId());
        return buildResponse(group, user);
    }

    // ---------------------------------------------------------------- Stanze (admin)

    @Transactional
    public ChannelResponse createRoom(UUID workspaceId, User user, RoomRequest req) {
        workspaceService.assertRole(workspaceId, user, WorkspaceRole.ADMIN);
        Workspace ws = workspaceRepository.getReferenceById(workspaceId);
        Channel room = channelRepository.save(Channel.builder()
                .workspace(ws).type(ChannelType.ROOM)
                .name(req.name().trim()).description(req.description())
                .isPrivate(req.isPrivate()).voiceEnabled(req.voiceEnabled())
                .screenShareEnabled(req.screenShareEnabled())
                .createdBy(user).build());
        if (req.isPrivate()) {
            syncRoomMembers(room, workspaceId, req.memberIds());
        }
        broadcastChannelEvent(workspaceId, "CHANNEL_CREATED", room.getId());
        return buildResponse(room, user);
    }

    @Transactional
    public ChannelResponse updateRoom(UUID workspaceId, UUID roomId, User user, RoomRequest req) {
        workspaceService.assertRole(workspaceId, user, WorkspaceRole.ADMIN);
        Channel room = loadRoom(workspaceId, roomId);
        room.setName(req.name().trim());
        room.setDescription(req.description());
        room.setPrivate(req.isPrivate());
        room.setVoiceEnabled(req.voiceEnabled());
        room.setScreenShareEnabled(req.screenShareEnabled());
        channelRepository.save(room);
        if (req.isPrivate()) {
            syncRoomMembers(room, workspaceId, req.memberIds());
        }
        broadcastChannelEvent(workspaceId, "CHANNEL_UPDATED", room.getId());
        return buildResponse(room, user);
    }

    @Transactional
    public void deleteRoom(UUID workspaceId, UUID roomId, User user) {
        workspaceService.assertRole(workspaceId, user, WorkspaceRole.ADMIN);
        Channel room = loadRoom(workspaceId, roomId);
        channelRepository.delete(room); // FK ON DELETE CASCADE rimuove membri e messaggi
        broadcastChannelEvent(workspaceId, "CHANNEL_DELETED", roomId);
    }

    // ---------------------------------------------------------------- Sprint

    /** Crea la chat dedicata a una sprint. È accessibile a tutti i membri del workspace (come una
     *  ROOM pubblica): le righe channel_members vengono create lazy al primo accesso/lettura. */
    @Transactional
    public Channel createSprintChannel(UUID workspaceId, UUID sprintId, String sprintName, User creator) {
        Workspace ws = workspaceRepository.getReferenceById(workspaceId);
        Channel channel = channelRepository.save(Channel.builder()
                .workspace(ws).type(ChannelType.SPRINT)
                .name("Sprint: " + sprintName)
                .sprintId(sprintId)
                .createdBy(creator).build());
        broadcastChannelEvent(workspaceId, "CHANNEL_CREATED", channel.getId());
        return channel;
    }

    // ---------------------------------------------------------------- Messaggi

    @Transactional
    public MessageResponse sendMessage(UUID workspaceId, UUID channelId, User user, String content) {
        Channel channel = loadChannel(workspaceId, channelId);
        assertChannelAccess(channel, user);
        Message msg = messageRepository.save(Message.builder()
                .channel(channel).author(user).content(content.trim()).build());
        // L'autore ha "letto" il proprio messaggio.
        ChannelMember cm = getOrCreateMember(channel, user);
        cm.setLastReadAt(msg.getCreatedAt());
        memberRepository.save(cm);
        // Broadcast leggero: il topic è di tutto il workspace, quindi NON mettiamo qui il
        // contenuto del messaggio (trapelerebbe DM/stanze private ai non-membri). Solo i
        // metadati già pubblici (chi/dove) + il nome autore, per una notifica sobria.
        eventPublisher.publish(workspaceId, "MESSAGE_CREATED", Map.of(
                "channelId", channelId.toString(),
                "authorId", user.getId().toString(),
                "authorName", user.getDisplayName()));
        return MessageResponse.from(msg);
    }

    @Transactional
    public void markRead(UUID workspaceId, UUID channelId, User user) {
        Channel channel = loadChannel(workspaceId, channelId);
        assertChannelAccess(channel, user);
        ChannelMember cm = getOrCreateMember(channel, user);
        cm.setLastReadAt(OffsetDateTime.now());
        memberRepository.save(cm);
        eventPublisher.publish(workspaceId, "CHANNEL_READ",
                Map.of("channelId", channelId.toString(), "userId", user.getId().toString()));
    }

    @Transactional
    public void notifyTyping(UUID workspaceId, UUID channelId, User user) {
        Channel channel = loadChannel(workspaceId, channelId);
        assertChannelAccess(channel, user);
        eventPublisher.publish(workspaceId, "TYPING", Map.of(
                "channelId", channelId.toString(),
                "userId", user.getId().toString(),
                "userName", user.getDisplayName()));
    }

    // ---------------------------------------------------------------- Voce (LiveKit)

    /**
     * Emette un token d'accesso LiveKit per la stanza vocale, dopo aver validato che
     * l'utente possa entrare nel canale e che la voce sia abilitata. La room LiveKit = channelId.
     */
    @Transactional
    public VoiceTokenResponse createVoiceToken(UUID workspaceId, UUID channelId, User user) {
        Channel channel = loadChannel(workspaceId, channelId);
        assertChannelAccess(channel, user);
        if (!channel.isVoiceEnabled()) {
            throw new AccessDeniedException("La voce non è abilitata su questo canale");
        }
        if (!liveKit.isConfigured()) {
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE,
                    "Servizio vocale non configurato sul server");
        }
        String token = liveKit.createToken(channelId.toString(), user.getId().toString(), user.getDisplayName());
        return new VoiceTokenResponse(liveKit.getUrl(), token, user.getId().toString(), channelId.toString());
    }

    // ---------------------------------------------------------------- Helper

    private ChannelResponse buildResponse(Channel c, User viewer) {
        List<ChannelMember> members = memberRepository.findByChannelId(c.getId());
        List<ChannelMemberDto> memberDtos = members.stream()
                .map(m -> ChannelMemberDto.from(m.getUser()))
                .toList();

        // Nome visualizzato: per i DM è il nome dell'altro partecipante.
        String displayName = c.getName();
        if (c.getType() == ChannelType.DM) {
            displayName = members.stream()
                    .map(ChannelMember::getUser)
                    .filter(u -> !u.getId().equals(viewer.getId()))
                    .map(User::getDisplayName)
                    .findFirst().orElse("Conversazione");
        }

        // Ultimo messaggio + non-letti per il viewer.
        List<Message> last = messageRepository.findLastMessage(c.getId(), PageRequest.of(0, 1));
        MessageResponse lastMsg = last.isEmpty() ? null : MessageResponse.from(last.get(0));

        OffsetDateTime lastReadAt = memberRepository.findByChannelIdAndUserId(c.getId(), viewer.getId())
                .map(ChannelMember::getLastReadAt).orElse(null);
        long unread = (lastReadAt != null)
                ? messageRepository.countUnreadSince(c.getId(), viewer.getId(), lastReadAt)
                : messageRepository.countUnreadAll(c.getId(), viewer.getId());

        return new ChannelResponse(
                c.getId(), c.getType(), displayName, c.getDescription(),
                c.isPrivate(), c.isVoiceEnabled(), c.isScreenShareEnabled(),
                memberDtos, lastMsg, unread, c.getCreatedAt(), c.getUpdatedAt());
    }

    private Channel loadChannel(UUID workspaceId, UUID channelId) {
        Channel c = channelRepository.findById(channelId)
                .orElseThrow(() -> new EntityNotFoundException("Canale non trovato"));
        if (!c.getWorkspace().getId().equals(workspaceId)) {
            throw new EntityNotFoundException("Canale non trovato");
        }
        return c;
    }

    private Channel loadRoom(UUID workspaceId, UUID roomId) {
        Channel c = loadChannel(workspaceId, roomId);
        if (c.getType() != ChannelType.ROOM) {
            throw new EntityNotFoundException("Stanza non trovata");
        }
        return c;
    }

    // Accesso: ROOM pubblica e chat SPRINT → qualsiasi membro del workspace; altrimenti membro esplicito.
    private void assertChannelAccess(Channel channel, User user) {
        workspaceService.assertMember(channel.getWorkspace().getId(), user);
        if (channel.getType() == ChannelType.ROOM && !channel.isPrivate()) {
            return;
        }
        if (channel.getType() == ChannelType.SPRINT) {
            return;
        }
        if (!memberRepository.existsByChannelIdAndUserId(channel.getId(), user.getId())) {
            throw new AccessDeniedException("Non hai accesso a questo canale");
        }
    }

    private ChannelMember addMember(Channel channel, User user) {
        return memberRepository.findByChannelIdAndUserId(channel.getId(), user.getId())
                .orElseGet(() -> memberRepository.save(
                        ChannelMember.builder().channel(channel).user(user).build()));
    }

    // Crea lazy la riga membro (necessaria per tracciare last_read anche nelle ROOM pubbliche).
    private ChannelMember getOrCreateMember(Channel channel, User user) {
        return memberRepository.findByChannelIdAndUserId(channel.getId(), user.getId())
                .orElseGet(() -> memberRepository.save(
                        ChannelMember.builder().channel(channel).user(user).build()));
    }

    private void syncRoomMembers(Channel room, UUID workspaceId, List<UUID> memberIds) {
        Set<UUID> desired = memberIds == null ? new HashSet<>() : new HashSet<>(memberIds);
        // Includi sempre il creatore.
        if (room.getCreatedBy() != null) desired.add(room.getCreatedBy().getId());

        List<ChannelMember> current = memberRepository.findByChannelId(room.getId());
        Set<UUID> currentIds = new HashSet<>();
        for (ChannelMember m : current) {
            currentIds.add(m.getUser().getId());
            if (!desired.contains(m.getUser().getId())) {
                memberRepository.delete(m);
            }
        }
        for (UUID id : desired) {
            if (!currentIds.contains(id)) {
                addMember(room, requireWorkspaceMember(workspaceId, id));
            }
        }
    }

    private User requireWorkspaceMember(UUID workspaceId, UUID userId) {
        workspaceMemberRepository.findByWorkspaceIdAndUserId(workspaceId, userId)
                .orElseThrow(() -> new AccessDeniedException("L'utente non è membro del workspace"));
        return userRepository.findById(userId)
                .orElseThrow(() -> new EntityNotFoundException("Utente non trovato"));
    }

    private void broadcastChannelEvent(UUID workspaceId, String type, UUID channelId) {
        eventPublisher.publish(workspaceId, type, Map.of("channelId", channelId.toString()));
    }
}
