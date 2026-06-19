package com.worktogether.security;

import com.worktogether.domain.entity.ApiKey;
import com.worktogether.repository.ApiKeyRepository;
import com.worktogether.repository.UserRepository;
import com.worktogether.service.ApiKeyService;
import jakarta.servlet.*;
import jakarta.servlet.http.*;
import lombok.RequiredArgsConstructor;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.time.Duration;
import java.time.OffsetDateTime;
import java.util.List;

/**
 * Autentica le richieste delle integrazioni esterne tramite API key
 * ("Authorization: Bearer wt_..."). La chiave agisce per conto dell'utente
 * che l'ha creata; gli scope vengono poi applicati da {@link ApiKeyScopeInterceptor}.
 */
@Component
@RequiredArgsConstructor
public class ApiKeyAuthFilter extends OncePerRequestFilter {

    public static final String ATTR_API_KEY = "wt.apiKey";
    private static final Duration LAST_USED_THROTTLE = Duration.ofSeconds(60);

    private final ApiKeyRepository apiKeyRepository;
    private final UserRepository userRepository;

    @Override
    protected void doFilterInternal(HttpServletRequest request,
                                    HttpServletResponse response,
                                    FilterChain chain) throws ServletException, IOException {
        String token = extractToken(request);
        if (token != null && token.startsWith("wt_")
                && SecurityContextHolder.getContext().getAuthentication() == null) {
            String hash = ApiKeyService.sha256Hex(token);
            ApiKey key = apiKeyRepository.findByKeyHash(hash).orElse(null);
            if (key != null && key.isActive()) {
                userRepository.findById(key.getCreatedBy()).ifPresent(user -> {
                    var auth = new UsernamePasswordAuthenticationToken(
                            user, null, List.of(new SimpleGrantedAuthority("ROLE_API")));
                    SecurityContextHolder.getContext().setAuthentication(auth);
                    request.setAttribute(ATTR_API_KEY, key);
                    touchLastUsed(key);
                });
            }
        }
        chain.doFilter(request, response);
    }

    // Aggiorna "ultimo utilizzo" al massimo una volta al minuto, per evitare scritture continue.
    private void touchLastUsed(ApiKey key) {
        OffsetDateTime now = OffsetDateTime.now();
        if (key.getLastUsedAt() == null || key.getLastUsedAt().isBefore(now.minus(LAST_USED_THROTTLE))) {
            key.setLastUsedAt(now);
            try { apiKeyRepository.save(key); } catch (Exception ignored) { /* best-effort */ }
        }
    }

    private String extractToken(HttpServletRequest request) {
        String header = request.getHeader("Authorization");
        if (StringUtils.hasText(header) && header.startsWith("Bearer ")) {
            return header.substring(7);
        }
        return null;
    }
}
