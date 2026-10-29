package com.worktogether.websocket;

import org.junit.jupiter.api.Test;
import org.springframework.web.socket.WebSocketHandler;
import org.springframework.web.socket.WebSocketSession;

import java.time.Instant;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class WsSessionExpiryGuardTest {

    private WebSocketSession session(String id) {
        WebSocketSession s = mock(WebSocketSession.class);
        when(s.getId()).thenReturn(id);
        when(s.isOpen()).thenReturn(true);
        return s;
    }

    @Test
    void closesOnlySessionsExpiredBeyondGrace() throws Exception {
        WsSessionExpiryGuard guard = new WsSessionExpiryGuard(60);
        WebSocketHandler decorated = guard.decorate(mock(WebSocketHandler.class));
        WebSocketSession expired = session("a");
        WebSocketSession inGrace = session("b");
        WebSocketSession valid = session("c");
        decorated.afterConnectionEstablished(expired);
        decorated.afterConnectionEstablished(inGrace);
        decorated.afterConnectionEstablished(valid);

        Instant now = Instant.now();
        guard.track("a", now.minusSeconds(120)); // scaduto da 2 minuti > 60 s di tolleranza
        guard.track("b", now.minusSeconds(30));  // scaduto ma ancora in tolleranza
        guard.track("c", now.plusSeconds(300));

        assertEquals(1, guard.closeExpired(now));
        verify(expired).close(WsSessionExpiryGuard.TOKEN_EXPIRED);
        verify(inGrace, never()).close(any());
        verify(valid, never()).close(any());
        assertEquals(2, guard.trackedCount());

        // Dopo altri 60 s anche "b" va chiusa; "c" no.
        assertEquals(1, guard.closeExpired(now.plusSeconds(61)));
        verify(inGrace).close(WsSessionExpiryGuard.TOKEN_EXPIRED);
        verify(valid, never()).close(any());
    }

    @Test
    void closedConnectionsAreForgotten() throws Exception {
        WsSessionExpiryGuard guard = new WsSessionExpiryGuard(0);
        WebSocketHandler decorated = guard.decorate(mock(WebSocketHandler.class));
        WebSocketSession s = session("x");
        decorated.afterConnectionEstablished(s);
        guard.track("x", Instant.now().minusSeconds(10));
        decorated.afterConnectionClosed(s, org.springframework.web.socket.CloseStatus.NORMAL);
        assertEquals(0, guard.trackedCount());
        assertEquals(0, guard.closeExpired(Instant.now()));
        verify(s, never()).close(any());
    }

    private static org.springframework.web.socket.CloseStatus any() {
        return org.mockito.ArgumentMatchers.any();
    }
}
