package com.worktogether.config;

import com.worktogether.domain.entity.User;
import com.worktogether.repository.UserRepository;
import com.worktogether.repository.WorkspaceMemberRepository;
import com.worktogether.security.OidcConfig;
import com.worktogether.security.TestOidcProvider;
import com.worktogether.service.OidcUserService;
import com.worktogether.websocket.WorkspaceSubscriptionRegistry;
import com.worktogether.websocket.WsSessionExpiryGuard;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.springframework.messaging.Message;
import org.springframework.messaging.MessageChannel;
import org.springframework.messaging.MessageDeliveryException;
import org.springframework.messaging.simp.config.ChannelRegistration;
import org.springframework.messaging.simp.stomp.StompCommand;
import org.springframework.messaging.simp.stomp.StompHeaderAccessor;
import org.springframework.messaging.support.ChannelInterceptor;
import org.springframework.messaging.support.MessageBuilder;
import org.springframework.messaging.support.MessageHeaderAccessor;

import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;

/** La CONNECT STOMP accetta lo stesso access token di Authentik delle API REST. */
class WebSocketAuthTest {

    static TestOidcProvider oidc;

    @BeforeAll
    static void start() throws Exception { oidc = new TestOidcProvider(); }

    @AfterAll
    static void stop() { oidc.close(); }

    static class ExposedRegistration extends ChannelRegistration {
        ChannelInterceptor first() { return getInterceptors().get(0); }
    }

    private Message<byte[]> connect(String sessionId, String authorization) {
        StompHeaderAccessor acc = StompHeaderAccessor.create(StompCommand.CONNECT);
        acc.setSessionId(sessionId);
        if (authorization != null) acc.setNativeHeader("Authorization", authorization);
        acc.setLeaveMutable(true);
        return MessageBuilder.createMessage(new byte[0], acc.getMessageHeaders());
    }

    @Test
    void connectWithValidTokenSetsPrincipalAndTracksExpiry() throws Exception {
        UserRepository users = mock(UserRepository.class);
        User u = User.builder().id(UUID.randomUUID()).oidcSubject("sub-1").displayName("Mario").build();
        when(users.findByOidcSubject("sub-1")).thenReturn(Optional.of(u));
        WsSessionExpiryGuard guard = mock(WsSessionExpiryGuard.class);
        WebSocketConfig config = new WebSocketConfig(
                new OidcConfig().oidcJwtDecoder(oidc.issuer(), TestOidcProvider.AUDIENCE, oidc.jwksUrl()),
                new OidcUserService(users, "", true),
                guard,
                mock(WorkspaceMemberRepository.class),
                mock(WorkspaceSubscriptionRegistry.class));
        ExposedRegistration reg = new ExposedRegistration();
        config.configureClientInboundChannel(reg);
        ChannelInterceptor interceptor = reg.first();

        Message<?> out = interceptor.preSend(connect("s1", "Bearer " + oidc.token("sub-1", b -> {})), mock(MessageChannel.class));
        StompHeaderAccessor acc = MessageHeaderAccessor.getAccessor(out, StompHeaderAccessor.class);
        assertNotNull(acc.getUser());
        assertEquals(u.getId().toString(), acc.getUser().getName());
        verify(guard).track(eq("s1"), any(Instant.class));

        assertThrows(MessageDeliveryException.class, () ->
                interceptor.preSend(connect("s2", "Bearer " + oidc.tokenSignedByOtherKey("sub-1")), mock(MessageChannel.class)));
        assertThrows(MessageDeliveryException.class, () ->
                interceptor.preSend(connect("s3", null), mock(MessageChannel.class)));
        verify(guard, never()).track(eq("s2"), any());
    }
}
