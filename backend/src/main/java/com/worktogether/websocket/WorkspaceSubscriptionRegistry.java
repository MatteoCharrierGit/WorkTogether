package com.worktogether.websocket;

import lombok.extern.slf4j.Slf4j;
import org.springframework.context.ApplicationContext;
import org.springframework.context.event.EventListener;
import org.springframework.messaging.MessageChannel;
import org.springframework.messaging.simp.SimpMessageHeaderAccessor;
import org.springframework.messaging.simp.SimpMessageType;
import org.springframework.messaging.support.MessageBuilder;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.messaging.SessionDisconnectEvent;

import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Registro delle subscription STOMP a {@code /topic/workspace/{id}} (sessionId + subscriptionId per
 * utente e workspace). Il controllo di appartenenza avviene solo alla SUBSCRIBE (WebSocketConfig):
 * senza questo registro un membro rimosso continuerebbe a ricevere gli eventi del workspace finché
 * la sua connessione resta aperta.
 *
 * <p>Revoca: per ogni subscription interessata si invia al broker (brokerChannel, sincrono) un
 * UNSUBSCRIBE sintetico con sessionId/subscriptionId: il SimpleBroker la rimuove dal proprio
 * registro e da quel momento non recapita più nulla. La connessione resta aperta (le altre
 * subscription, es. altri workspace e la coda personale, non sono toccate); se il client si
 * riconnette, la nuova SUBSCRIBE viene di nuovo verificata e negata.
 */
@Slf4j
@Component
public class WorkspaceSubscriptionRegistry {

    private record Sub(String sessionId, String subscriptionId, UUID userId, UUID workspaceId) {}

    // sessionId -> (subscriptionId -> Sub)
    private final Map<String, Map<String, Sub>> bySession = new ConcurrentHashMap<>();

    private final ApplicationContext context;
    private volatile MessageChannel brokerChannel;

    public WorkspaceSubscriptionRegistry(ApplicationContext context) {
        this.context = context;
    }

    public void register(String sessionId, String subscriptionId, UUID userId, UUID workspaceId) {
        if (sessionId == null || subscriptionId == null) return;
        bySession.computeIfAbsent(sessionId, k -> new ConcurrentHashMap<>())
                .put(subscriptionId, new Sub(sessionId, subscriptionId, userId, workspaceId));
    }

    public void unregister(String sessionId, String subscriptionId) {
        if (sessionId == null || subscriptionId == null) return;
        Map<String, Sub> subs = bySession.get(sessionId);
        if (subs != null) subs.remove(subscriptionId);
    }

    @EventListener
    public void onDisconnect(SessionDisconnectEvent event) {
        bySession.remove(event.getSessionId());
    }

    /** Chiude le subscription di {@code userId} al topic del workspace (membro rimosso). */
    public int revoke(UUID workspaceId, UUID userId) {
        return revokeMatching(s -> s.workspaceId().equals(workspaceId) && s.userId().equals(userId));
    }

    /** Chiude tutte le subscription al topic del workspace (workspace eliminato). */
    public int revokeAll(UUID workspaceId) {
        return revokeMatching(s -> s.workspaceId().equals(workspaceId));
    }

    private int revokeMatching(java.util.function.Predicate<Sub> match) {
        List<Sub> targets = bySession.values().stream()
                .flatMap(m -> m.values().stream())
                .filter(match)
                .toList();
        for (Sub s : targets) {
            try {
                SimpMessageHeaderAccessor acc = SimpMessageHeaderAccessor.create(SimpMessageType.UNSUBSCRIBE);
                acc.setSessionId(s.sessionId());
                acc.setSubscriptionId(s.subscriptionId());
                acc.setLeaveMutable(true);
                broker().send(MessageBuilder.createMessage(new byte[0], acc.getMessageHeaders()));
            } catch (Exception e) {
                log.warn("Revoca subscription {} (sessione {}) fallita: {}", s.subscriptionId(), s.sessionId(), e.getMessage());
            }
            unregister(s.sessionId(), s.subscriptionId());
        }
        if (!targets.isEmpty()) log.debug("Revocate {} subscription WS", targets.size());
        return targets.size();
    }

    /** Numero di subscription tracciate (diagnostica/test). */
    public int size() {
        return bySession.values().stream().mapToInt(Map::size).sum();
    }

    // Lookup lazy: il brokerChannel è definito dalla configurazione STOMP che dipende da WebSocketConfig,
    // che a sua volta usa questo registro (iniettarlo nel costruttore creerebbe un ciclo).
    private MessageChannel broker() {
        MessageChannel c = brokerChannel;
        if (c == null) {
            c = context.getBean("brokerChannel", MessageChannel.class);
            brokerChannel = c;
        }
        return c;
    }

}
