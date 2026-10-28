package com.worktogether.websocket;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

import java.time.OffsetDateTime;
import java.util.Map;
import java.util.UUID;

/**
 * Pubblica gli eventi realtime via STOMP.
 * <p>
 * Se c'è una transazione attiva l'invio è rimandato a DOPO il commit: i client reagiscono agli
 * eventi rifacendo le query, e se il messaggio partisse dentro la transazione leggerebbero dati
 * non ancora committati (o mai committati, in caso di rollback). Fuori da una transazione
 * (thread dell'agente AI, presenza, scheduler) l'invio è immediato.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class WorkspaceEventPublisher {

    /** Coda personale (user destination): il client si iscrive a {@code /user/queue/events}. */
    public static final String USER_QUEUE = "/queue/events";

    private final SimpMessagingTemplate messagingTemplate;

    /** Evento per tutti i client iscritti al workspace ({@code /topic/workspace/{id}}). */
    public void publish(UUID workspaceId, String eventType, Object payload) {
        Map<String, Object> message = envelope(eventType, payload);
        String destination = "/topic/workspace/" + workspaceId;
        sendAfterCommit(() -> messagingTemplate.convertAndSend(destination, message));
    }

    /**
     * Evento destinato a un solo utente (tutte le sue sessioni STOMP autenticate), recapitato su
     * {@code /user/queue/events}. Richiede che la CONNECT STOMP porti il JWT (vedi WebSocketConfig).
     */
    public void publishToUser(UUID userId, String eventType, Object payload) {
        Map<String, Object> message = envelope(eventType, payload);
        String user = userId.toString();
        sendAfterCommit(() -> messagingTemplate.convertAndSendToUser(user, USER_QUEUE, message));
    }

    private Map<String, Object> envelope(String eventType, Object payload) {
        return Map.of(
                "type", eventType,
                "payload", payload,
                "timestamp", OffsetDateTime.now().toString()
        );
    }

    private void sendAfterCommit(Runnable send) {
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override
                public void afterCommit() {
                    safeSend(send);
                }
            });
        } else {
            safeSend(send);
        }
    }

    // Un errore di invio realtime non deve far fallire la richiesta (il dato è già committato).
    private void safeSend(Runnable send) {
        try {
            send.run();
        } catch (Exception e) {
            log.warn("Invio evento websocket fallito: {}", e.getMessage());
        }
    }
}
