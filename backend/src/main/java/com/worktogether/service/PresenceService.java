package com.worktogether.service;

import com.worktogether.dto.response.PresenceDto;
import com.worktogether.websocket.WorkspaceEventPublisher;
import lombok.RequiredArgsConstructor;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import java.util.*;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Presenza utenti in-memory: "online" + "in chiamata", per workspace.
 *
 * <p>Coerente con l'architettura realtime esistente: i client mandano un heartbeat via REST
 * (con l'eventuale canale vocale corrente) e i cambiamenti vengono diffusi sul topic STOMP del
 * workspace ({@code PRESENCE}). Nessuna persistenza: lo stato vive finché il server è su.
 */
@Service
@RequiredArgsConstructor
public class PresenceService {
    // Modalità invisibile: gli admin nascosti non compaiono MAI nella presenza diffusa (né online
    // né "in chiamata"), per nessuno; il loro client si considera online da sé (PresenceManager).

    /** Un utente è "online" se ha mandato un heartbeat negli ultimi 30s. */
    private static final long ONLINE_TTL_MS = 30_000;

    private final WorkspaceEventPublisher eventPublisher;
    private final HiddenMemberRegistry hiddenMembers;

    // workspaceId -> (userId -> stato)
    private final Map<UUID, Map<UUID, UserPresence>> presence = new ConcurrentHashMap<>();

    private static final class UserPresence {
        volatile long lastSeen;
        volatile UUID inCallChannelId; // null se non in chiamata
    }

    /** Registra un heartbeat; diffonde solo se cambia qualcosa (nuovo online o cambio stato call). */
    public void heartbeat(UUID workspaceId, UUID userId, UUID inCallChannelId) {
        Map<UUID, UserPresence> ws = presence.computeIfAbsent(workspaceId, k -> new ConcurrentHashMap<>());
        UserPresence prev = ws.get(userId);
        boolean wasOnline = prev != null && isOnline(prev);
        UUID prevCall = prev != null ? prev.inCallChannelId : null;

        UserPresence cur = ws.computeIfAbsent(userId, k -> new UserPresence());
        cur.lastSeen = System.currentTimeMillis();
        cur.inCallChannelId = inCallChannelId;

        // Un utente invisibile non cambia ciò che vedono gli altri: nessun broadcast.
        if ((!wasOnline || !Objects.equals(prevCall, inCallChannelId))
                && !hiddenMembers.isHidden(workspaceId, userId)) {
            broadcast(workspaceId);
        }
    }

    /**
     * Rimuove subito un utente dalla presenza del workspace (online + in chiamata) e notifica.
     * Chiamato quando il client chiude/abbandona la pagina (beacon): così non resta un "fantasma"
     * online/in chiamata per i ~30s del TTL dell'heartbeat.
     */
    public void goOffline(UUID workspaceId, UUID userId) {
        Map<UUID, UserPresence> ws = presence.get(workspaceId);
        if (ws == null) return;
        if (ws.remove(userId) != null && !hiddenMembers.isHidden(workspaceId, userId)) broadcast(workspaceId);
    }

    /**
     * Ridiffonde lo snapshot (es. dopo l'attivazione/disattivazione della modalità invisibile o la
     * rimozione di un membro): gli altri client vedono subito sparire/ricomparire l'utente.
     */
    public void rebroadcast(UUID workspaceId) {
        if (presence.containsKey(workspaceId)) broadcast(workspaceId);
    }

    /** Toglie un utente dalla presenza del workspace (membro rimosso) e notifica. */
    public void forget(UUID workspaceId, UUID userId) {
        Map<UUID, UserPresence> ws = presence.get(workspaceId);
        if (ws != null && ws.remove(userId) != null) broadcast(workspaceId);
    }

    /**
     * Azzera lo stato "in chiamata" di un utente mantenendolo online (usato dal webhook LiveKit
     * quando il partecipante lascia la room ma può restare nell'app).
     */
    public void clearCall(UUID workspaceId, UUID userId) {
        Map<UUID, UserPresence> ws = presence.get(workspaceId);
        if (ws == null) return;
        UserPresence p = ws.get(userId);
        if (p != null && p.inCallChannelId != null) {
            p.inCallChannelId = null;
            if (!hiddenMembers.isHidden(workspaceId, userId)) broadcast(workspaceId);
        }
    }

    /** Snapshot degli utenti online del workspace. */
    public List<PresenceDto> snapshot(UUID workspaceId) {
        Map<UUID, UserPresence> ws = presence.get(workspaceId);
        if (ws == null) return List.of();
        long now = System.currentTimeMillis();
        Set<UUID> hidden = hiddenMembers.hiddenUsers(workspaceId);
        List<PresenceDto> out = new ArrayList<>();
        for (Map.Entry<UUID, UserPresence> e : ws.entrySet()) {
            if (hidden.contains(e.getKey())) continue;
            if (now - e.getValue().lastSeen <= ONLINE_TTL_MS) {
                UUID call = e.getValue().inCallChannelId;
                out.add(new PresenceDto(e.getKey().toString(), call != null ? call.toString() : null));
            }
        }
        return out;
    }

    private boolean isOnline(UserPresence p) {
        return System.currentTimeMillis() - p.lastSeen <= ONLINE_TTL_MS;
    }

    private void broadcast(UUID workspaceId) {
        eventPublisher.publishNow(workspaceId, "PRESENCE", Map.of("online", snapshot(workspaceId)));
    }

    /** Espelle le voci scadute e notifica chi è andato offline. */
    @Scheduled(fixedRate = 15_000)
    public void sweep() {
        long now = System.currentTimeMillis();
        for (Map.Entry<UUID, Map<UUID, UserPresence>> wsEntry : presence.entrySet()) {
            Set<UUID> hidden = hiddenMembers.hiddenUsers(wsEntry.getKey());
            boolean[] visibleChanged = {false};
            wsEntry.getValue().entrySet().removeIf(e -> {
                boolean expired = now - e.getValue().lastSeen > ONLINE_TTL_MS;
                if (expired && !hidden.contains(e.getKey())) visibleChanged[0] = true;
                return expired;
            });
            if (visibleChanged[0]) broadcast(wsEntry.getKey());
        }
    }
}
