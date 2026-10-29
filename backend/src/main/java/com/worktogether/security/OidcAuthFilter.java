package com.worktogether.security;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.worktogether.domain.entity.User;
import com.worktogether.service.OidcUserService;
import jakarta.servlet.*;
import jakarta.servlet.http.*;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.MediaType;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.JwtException;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * Autentica le persone con l'access token di Authentik ("Authorization: Bearer <jwt>").
 * Token non valido/scaduto ⇒ nessuna autenticazione ⇒ 401 dall'entry point (il frontend rinnova
 * o rifà il login). Il principal è l'entità {@link User} interna (risolta per {@code sub}, vedi
 * {@link OidcUserService}). I token {@code wt_...} sono API key e li gestisce {@link ApiKeyAuthFilter}.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class OidcAuthFilter extends OncePerRequestFilter {

    private final JwtDecoder oidcJwtDecoder;
    private final OidcUserService oidcUserService;
    private final ObjectMapper objectMapper;

    @Override
    protected void doFilterInternal(HttpServletRequest request,
                                    HttpServletResponse response,
                                    FilterChain chain) throws ServletException, IOException {
        String token = extractToken(request);
        if (token != null && !token.startsWith("wt_")
                && SecurityContextHolder.getContext().getAuthentication() == null) {
            try {
                decode(oidcJwtDecoder, token).ifPresent(jwt -> {
                    User user = oidcUserService.resolve(jwt);
                    var auth = new UsernamePasswordAuthenticationToken(
                            user, null, List.of(new SimpleGrantedAuthority("ROLE_USER")));
                    SecurityContextHolder.getContext().setAuthentication(auth);
                });
            } catch (OidcAccountException e) {
                response.setStatus(e.getStatus().value());
                response.setContentType(MediaType.APPLICATION_JSON_VALUE);
                response.setCharacterEncoding("UTF-8");
                response.getWriter().write(objectMapper.writeValueAsString(
                        Map.of("error", e.getMessage(), "code", "OIDC_ACCOUNT")));
                return;
            }
        }
        chain.doFilter(request, response);
    }

    /** Decodifica e valida il token; vuoto se non valido (firma, iss, aud, exp...). */
    public static Optional<Jwt> decode(JwtDecoder decoder, String token) {
        try {
            return Optional.of(decoder.decode(token));
        } catch (JwtException | IllegalArgumentException e) {
            log.debug("Access token OIDC rifiutato: {}", e.getMessage());
            return Optional.empty();
        }
    }

    private String extractToken(HttpServletRequest request) {
        String header = request.getHeader("Authorization");
        if (StringUtils.hasText(header) && header.startsWith("Bearer ")) {
            return header.substring(7).trim();
        }
        return null;
    }
}
