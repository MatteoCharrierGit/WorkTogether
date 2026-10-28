package com.worktogether.config;

import com.worktogether.security.JwtUtil;
import lombok.RequiredArgsConstructor;
import org.springframework.context.annotation.Configuration;
import org.springframework.messaging.Message;
import org.springframework.messaging.MessageChannel;
import org.springframework.messaging.simp.config.ChannelRegistration;
import org.springframework.messaging.simp.config.MessageBrokerRegistry;
import org.springframework.messaging.simp.stomp.StompCommand;
import org.springframework.messaging.simp.stomp.StompHeaderAccessor;
import org.springframework.messaging.support.ChannelInterceptor;
import org.springframework.messaging.support.MessageHeaderAccessor;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.web.socket.config.annotation.*;

import java.util.List;
import java.util.UUID;

@Configuration
@EnableWebSocketMessageBroker
@RequiredArgsConstructor
public class WebSocketConfig implements WebSocketMessageBrokerConfigurer {

    private final JwtUtil jwtUtil;

    @Override
    public void configureMessageBroker(MessageBrokerRegistry registry) {
        // /topic = broadcast per workspace; /queue = code personali raggiunte via /user/queue/...
        registry.enableSimpleBroker("/topic", "/queue");
        registry.setApplicationDestinationPrefixes("/app");
        registry.setUserDestinationPrefix("/user");
    }

    @Override
    public void registerStompEndpoints(StompEndpointRegistry registry) {
        registry.addEndpoint("/ws")
                .setAllowedOriginPatterns("*")
                .withSockJS();
    }

    /**
     * Associa alla sessione STOMP l'utente del JWT passato nell'header nativo "Authorization" della
     * CONNECT (il frontend lo invia già): il Principal ha come nome lo userId, così
     * {@code convertAndSendToUser(userId, "/queue/events", ...)} raggiunge tutte le sue sessioni.
     * Un token assente/scaduto NON rifiuta la connessione (compatibilità: il client riusa il token
     * iniziale nei reconnect): semplicemente quella sessione non riceve gli eventi personali.
     */
    @Override
    public void configureClientInboundChannel(ChannelRegistration registration) {
        registration.interceptors(new ChannelInterceptor() {
            @Override
            public Message<?> preSend(Message<?> message, MessageChannel channel) {
                StompHeaderAccessor accessor = MessageHeaderAccessor.getAccessor(message, StompHeaderAccessor.class);
                if (accessor != null && StompCommand.CONNECT.equals(accessor.getCommand())) {
                    String header = accessor.getFirstNativeHeader("Authorization");
                    if (header != null && header.startsWith("Bearer ")) {
                        String token = header.substring(7);
                        if (jwtUtil.isValid(token)) {
                            UUID userId = jwtUtil.extractUserId(token);
                            accessor.setUser(new UsernamePasswordAuthenticationToken(
                                    userId.toString(), null, List.of(new SimpleGrantedAuthority("ROLE_USER"))));
                        }
                    }
                }
                return message;
            }
        });
    }
}
