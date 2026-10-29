package com.worktogether.config;

import com.worktogether.security.ApiKeyAuthFilter;
import com.worktogether.security.OidcAuthFilter;
import lombok.RequiredArgsConstructor;
import org.springframework.context.annotation.*;
import org.springframework.http.HttpMethod;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.config.annotation.web.configurers.AbstractHttpConfigurer;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.HttpStatusEntryPoint;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;
import org.springframework.http.HttpStatus;
import org.springframework.web.cors.*;

import jakarta.servlet.DispatcherType;
import java.util.List;

@Configuration
@EnableWebSecurity
@RequiredArgsConstructor
public class SecurityConfig {

    private final OidcAuthFilter oidcAuthFilter;
    private final ApiKeyAuthFilter apiKeyAuthFilter;

    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        return http
                .csrf(AbstractHttpConfigurer::disable)
                .cors(cors -> cors.configurationSource(corsConfigurationSource()))
                .sessionManagement(sm -> sm.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                .authorizeHttpRequests(auth -> auth
                        // I dispatch interni (continuazione async dello streaming SSE, forward, pagina di
                        // errore) non vanno ri-autorizzati: la richiesta originale è già stata autenticata.
                        // Senza questo, al termine di uno stream SSE l'AuthorizationFilter rivaluta il
                        // dispatch ASYNC senza SecurityContext e logga un AccessDeniedException spurio.
                        .dispatcherTypeMatchers(DispatcherType.ASYNC, DispatcherType.FORWARD, DispatcherType.ERROR).permitAll()
                        .requestMatchers("/ws/**").permitAll()
                        // Webhook LiveKit: niente token utente; autenticato per firma nel controller.
                        .requestMatchers("/api/livekit/webhook").permitAll()
                        .requestMatchers("/actuator/health").permitAll()
                        // --- Avatar, sicurezza WS e modalità nascosta ---
                        // Foto profilo caricate da <img> (senza header Authorization): pubbliche ma
                        // raggiungibili solo conoscendo lo UUID dell'utente (vedi UserController#avatar).
                        .requestMatchers(HttpMethod.GET, "/api/users/*/avatar").permitAll()
                        .anyRequest().authenticated()
                )
                // Senza questo, una richiesta non autenticata torna 403: il frontend
                // non sa distinguere "token scaduto/assente" da "permesso negato".
                // Con 401 il frontend rinnova il token con Authentik o rifà il login.
                .exceptionHandling(ex -> ex.authenticationEntryPoint(
                        new HttpStatusEntryPoint(HttpStatus.UNAUTHORIZED)))
                // Access token OIDC di Authentik (persone).
                .addFilterBefore(oidcAuthFilter, UsernamePasswordAuthenticationFilter.class)
                // L'autenticazione via API key (token "wt_...") precede il filtro OIDC.
                .addFilterBefore(apiKeyAuthFilter, OidcAuthFilter.class)
                .build();
    }

    @Bean
    public CorsConfigurationSource corsConfigurationSource() {
        CorsConfiguration config = new CorsConfiguration();
        config.setAllowedOriginPatterns(List.of("*"));
        config.setAllowedMethods(List.of("GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"));
        config.setAllowedHeaders(List.of("*"));
        config.setAllowCredentials(true);
        UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
        source.registerCorsConfiguration("/**", config);
        return source;
    }
}
