package com.worktogether.websocket;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.WebSocketHandler;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.WebSocketHandlerDecorator;

import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Scadenza delle connessioni STOMP: l'access token di Authentik viene controllato alla CONNECT,
 * ma la connessione può restare aperta molto più a lungo del token (pochi minuti). Qui si ricorda
 * la scadenza ({@code exp}) del token usato per ogni sessione e, passata la scadenza più una
 * tolleranza ({@code app.oidc.ws-expiry-grace-seconds}), si chiude la connessione.
 *
 * <p>Il client (lib/websocket.ts) si riconnette da solo dopo pochi secondi e in {@code beforeConnect}
 * usa il token corrente, già rinnovato da oidc-client-ts col refresh token; al rientro riallinea i
 * dati (evento "reconnect"). Se la sessione Authentik è finita il rinnovo fallisce e il client torna
 * al login. Così un utente disattivato o rimosso da Authentik smette di ricevere eventi al più
 * dopo la durata di un access token + tolleranza.
 */
@Slf4j
@Component
public class WsSessionExpiryGuard {

    /** Codice di chiusura applicativo (range 4000-4999) per "token scaduto". */
    public static final CloseStatus TOKEN_EXPIRED = new CloseStatus(4001, "Token scaduto");

    private final Map<String, WebSocketSession> sessions = new ConcurrentHashMap<>();
    private final Map<String, Instant> expiries = new ConcurrentHashMap<>();
    private final Duration grace;

    public WsSessionExpiryGuard(@Value("${app.oidc.ws-expiry-grace-seconds:60}") long graceSeconds) {
        this.grace = Duration.ofSeconds(Math.max(0, graceSeconds));
    }

    /** Decoratore dell'handler WebSocket: tiene traccia delle sessioni aperte (id = simpSessionId). */
    public WebSocketHandler decorate(WebSocketHandler handler) {
        return new WebSocketHandlerDecorator(handler) {
            @Override
            public void afterConnectionEstablished(WebSocketSession session) throws Exception {
                sessions.put(session.getId(), session);
                super.afterConnectionEstablished(session);
            }

            @Override
            public void afterConnectionClosed(WebSocketSession session, CloseStatus closeStatus) throws Exception {
                sessions.remove(session.getId());
                expiries.remove(session.getId());
                super.afterConnectionClosed(session, closeStatus);
            }
        };
    }

    /** Chiamato alla CONNECT autenticata: scadenza del token usato da quella sessione. */
    public void track(String sessionId, Instant expiresAt) {
        if (sessionId == null || expiresAt == null) return;
        expiries.put(sessionId, expiresAt);
    }

    @Scheduled(fixedDelayString = "${app.oidc.ws-expiry-check-ms:30000}")
    public void closeExpired() {
        closeExpired(Instant.now());
    }

    /** Chiude le sessioni con token scaduto da più della tolleranza. Ritorna quante. */
    public int closeExpired(Instant now) {
        int closed = 0;
        for (Map.Entry<String, Instant> e : expiries.entrySet()) {
            if (e.getValue().plus(grace).isAfter(now)) continue;
            String id = e.getKey();
            expiries.remove(id);
            WebSocketSession session = sessions.remove(id);
            if (session == null || !session.isOpen()) continue;
            try {
                session.close(TOKEN_EXPIRED);
                closed++;
            } catch (Exception ex) {
                log.debug("Chiusura sessione WS {} non riuscita: {}", id, ex.getMessage());
            }
        }
        if (closed > 0) log.debug("Chiuse {} connessioni WS con token scaduto", closed);
        return closed;
    }

    int trackedCount() {
        return expiries.size();
    }
}
