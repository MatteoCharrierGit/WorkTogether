package com.worktogether.config;

import com.worktogether.repository.UserRepository;
import com.worktogether.repository.WorkspaceMemberRepository;
import com.worktogether.security.JwtUtil;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.context.annotation.Configuration;
import org.springframework.messaging.Message;
import org.springframework.messaging.MessageChannel;
import org.springframework.messaging.MessageDeliveryException;
import org.springframework.messaging.simp.config.ChannelRegistration;
import org.springframework.messaging.simp.config.MessageBrokerRegistry;
import org.springframework.messaging.simp.stomp.StompCommand;
import org.springframework.messaging.simp.stomp.StompHeaderAccessor;
import org.springframework.messaging.support.ChannelInterceptor;
import org.springframework.messaging.support.MessageHeaderAccessor;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.web.socket.config.annotation.*;

import java.security.Principal;
import java.util.List;
import java.util.UUID;

@Slf4j
@Configuration
@EnableWebSocketMessageBroker
@RequiredArgsConstructor
public class WebSocketConfig implements WebSocketMessageBrokerConfigurer {

    private static final String WORKSPACE_TOPIC = "/topic/workspace/";

    private final JwtUtil jwtUtil;
    private final UserRepository userRepository;
    private final WorkspaceMemberRepository memberRepository;

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
     * Sicurezza STOMP (il canale /ws è aperto a livello HTTP per SockJS, l'autenticazione è qui):
     * <ul>
     *   <li>CONNECT: richiede il JWT nell'header nativo "Authorization" (il frontend lo rinnova in
     *       beforeConnect a ogni (ri)connessione). Token assente/non valido/di una sessione superata
     *       ⇒ ERROR e connessione chiusa. Il Principal ha come nome lo userId, così
     *       {@code convertAndSendToUser(userId, "/queue/events", ...)} raggiunge le sue sessioni.</li>
     *   <li>SUBSCRIBE: {@code /topic/workspace/{id}} solo ai membri del workspace;
     *       {@code /user/queue/**} (code personali, già isolate per utente) sempre; il resto è negato.
     *       Una SUBSCRIBE negata viene scartata (nessun ERROR): un ERROR chiuderebbe l'intera
     *       connessione e il client, riconnettendosi, ripeterebbe la stessa subscription in loop.</li>
     * </ul>
     */
    @Override
    public void configureClientInboundChannel(ChannelRegistration registration) {
        registration.interceptors(new ChannelInterceptor() {
            @Override
            public Message<?> preSend(Message<?> message, MessageChannel channel) {
                StompHeaderAccessor accessor = MessageHeaderAccessor.getAccessor(message, StompHeaderAccessor.class);
                if (accessor == null || accessor.getCommand() == null) return message;
                switch (accessor.getCommand()) {
                    case CONNECT, STOMP -> accessor.setUser(authenticate(accessor.getFirstNativeHeader("Authorization")));
                    case SUBSCRIBE -> {
                        String denied = subscribeDenial(accessor.getUser(), accessor.getDestination());
                        if (denied != null) {
                            log.debug("SUBSCRIBE {} negata: {}", accessor.getDestination(), denied);
                            return null; // non arriva al broker: nessuna subscription registrata
                        }
                    }
                    case SEND -> {
                        if (accessor.getUser() == null) throw new MessageDeliveryException("Non autenticato");
                    }
                    default -> { }
                }
                return message;
            }
        });
    }

    private Principal authenticate(String header) {
        if (header == null || !header.startsWith("Bearer ")) {
            throw new MessageDeliveryException("Token mancante");
        }
        String token = header.substring(7);
        if (!jwtUtil.isValid(token)) throw new MessageDeliveryException("Token non valido");
        UUID userId = jwtUtil.extractUserId(token);
        int tokenVersion = jwtUtil.extractTokenVersion(token);
        // Sessione singola, come JwtAuthFilter: un token di una sessione superata non vale.
        boolean current = userRepository.findById(userId)
                .map(u -> u.getTokenVersion() == tokenVersion)
                .orElse(false);
        if (!current) throw new MessageDeliveryException("Sessione non valida");
        return new UsernamePasswordAuthenticationToken(
                userId.toString(), null, List.of(new SimpleGrantedAuthority("ROLE_USER")));
    }

    /** null se la SUBSCRIBE è consentita, altrimenti il motivo del rifiuto. */
    private String subscribeDenial(Principal user, String destination) {
        if (user == null) return "non autenticato";
        if (destination == null) return "destinazione mancante";
        if (destination.startsWith("/user/")) return null; // code personali: risolte sul Principal
        if (destination.startsWith(WORKSPACE_TOPIC)) {
            UUID workspaceId;
            try {
                workspaceId = UUID.fromString(destination.substring(WORKSPACE_TOPIC.length()));
            } catch (IllegalArgumentException e) {
                return "destinazione non valida";
            }
            UUID userId = UUID.fromString(user.getName());
            return memberRepository.findByWorkspaceIdAndUserId(workspaceId, userId).isPresent()
                    ? null : "non membro del workspace";
        }
        return "destinazione non consentita";
    }
}
