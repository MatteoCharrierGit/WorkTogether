package com.worktogether.config;

import com.worktogether.domain.entity.User;
import com.worktogether.repository.WorkspaceMemberRepository;
import com.worktogether.security.OidcAccountException;
import com.worktogether.security.OidcAuthFilter;
import com.worktogether.service.OidcUserService;
import com.worktogether.websocket.WorkspaceSubscriptionRegistry;
import com.worktogether.websocket.WsSessionExpiryGuard;
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
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtDecoder;
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

    private final JwtDecoder oidcJwtDecoder;
    private final OidcUserService oidcUserService;
    // Chiude le connessioni il cui access token è scaduto (il client si riconnette col token rinnovato).
    private final WsSessionExpiryGuard expiryGuard;
    private final WorkspaceMemberRepository memberRepository;
    // Subscription ai topic di workspace, per revocarle alla rimozione del membro / eliminazione.
    private final WorkspaceSubscriptionRegistry subscriptionRegistry;

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

    @Override
    public void configureWebSocketTransport(WebSocketTransportRegistration registration) {
        registration.addDecoratorFactory(expiryGuard::decorate);
    }

    /**
     * Sicurezza STOMP (il canale /ws è aperto a livello HTTP per SockJS, l'autenticazione è qui):
     * <ul>
     *   <li>CONNECT: richiede l'access token di Authentik nell'header nativo "Authorization" (lo
     *       stesso delle chiamate REST; il frontend legge quello corrente in beforeConnect a ogni
     *       (ri)connessione). Token assente/non valido ⇒ ERROR e connessione chiusa. Il Principal ha
     *       come nome lo userId, così {@code convertAndSendToUser(userId, "/queue/events", ...)}
     *       raggiunge le sue sessioni. La scadenza del token è registrata in
     *       {@link WsSessionExpiryGuard}, che chiude la connessione quando il token scade.</li>
     *   <li>SUBSCRIBE: {@code /topic/workspace/{id}} solo ai membri del workspace;
     *       {@code /user/queue/**} (code personali, già isolate per utente) sempre; il resto è negato.
     *       Una SUBSCRIBE negata viene scartata (nessun ERROR): un ERROR chiuderebbe l'intera
     *       connessione e il client, riconnettendosi, ripeterebbe la stessa subscription in loop.</li>
     *   <li>Revoca: le SUBSCRIBE consentite a {@code /topic/workspace/{id}} sono tracciate in
     *       {@link WorkspaceSubscriptionRegistry}; alla rimozione del membro / eliminazione del
     *       workspace vengono chiuse lato broker (il controllo alla SUBSCRIBE da solo non basta).</li>
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
                    case CONNECT, STOMP -> accessor.setUser(
                            authenticate(accessor.getSessionId(), accessor.getFirstNativeHeader("Authorization")));
                    case SUBSCRIBE -> {
                        String denied = subscribeDenial(accessor.getUser(), accessor.getDestination());
                        if (denied != null) {
                            log.debug("SUBSCRIBE {} negata: {}", accessor.getDestination(), denied);
                            return null; // non arriva al broker: nessuna subscription registrata
                        }
                        trackWorkspaceSubscription(accessor);
                    }
                    case UNSUBSCRIBE -> subscriptionRegistry.unregister(accessor.getSessionId(), accessor.getSubscriptionId());
                    case SEND -> {
                        if (accessor.getUser() == null) throw new MessageDeliveryException("Non autenticato");
                    }
                    default -> { }
                }
                return message;
            }
        });
    }

    private Principal authenticate(String sessionId, String header) {
        if (header == null || !header.startsWith("Bearer ")) {
            throw new MessageDeliveryException("Token mancante");
        }
        Jwt jwt = OidcAuthFilter.decode(oidcJwtDecoder, header.substring(7).trim())
                .orElseThrow(() -> new MessageDeliveryException("Token non valido"));
        User user;
        try {
            user = oidcUserService.resolve(jwt);
        } catch (OidcAccountException e) {
            throw new MessageDeliveryException(e.getMessage());
        }
        expiryGuard.track(sessionId, jwt.getExpiresAt());
        return new UsernamePasswordAuthenticationToken(
                user.getId().toString(), null, List.of(new SimpleGrantedAuthority("ROLE_USER")));
    }

    private void trackWorkspaceSubscription(StompHeaderAccessor accessor) {
        String dest = accessor.getDestination();
        if (dest == null || !dest.startsWith(WORKSPACE_TOPIC) || accessor.getUser() == null) return;
        subscriptionRegistry.register(accessor.getSessionId(), accessor.getSubscriptionId(),
                UUID.fromString(accessor.getUser().getName()),
                UUID.fromString(dest.substring(WORKSPACE_TOPIC.length())));
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
