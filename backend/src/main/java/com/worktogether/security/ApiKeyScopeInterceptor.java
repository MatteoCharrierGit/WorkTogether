package com.worktogether.security;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.worktogether.domain.entity.ApiKey;
import com.worktogether.domain.enums.ApiScope;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.HandlerInterceptor;
import org.springframework.web.servlet.HandlerMapping;

import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * Sandbox per le richieste autenticate via API key (nega per default):
 * - confina la chiave al proprio workspace (id nell'URL e variabile di rotta {wsId});
 * - risorse "intere" drive/elements/tags: GET/HEAD richiedono lo scope :read, gli altri metodi :write
 *   (lo :write include la lettura, come da sempre);
 * - rotte puntuali (membri, sprint): sono consentite SOLO quelle elencate in {@link #ROUTE_RULES},
 *   confrontate col pattern della rotta Spring effettivamente scelta (non con l'URL grezzo), ognuna
 *   col suo scope esatto (nessuno scope ne implica un altro);
 * - qualsiasi altra rotta (impostazioni, api-keys, ai, channels, email, presenza, …) è negata.
 * Le richieste con login utente (attributo assente) passano senza modifiche.
 */
@Component
@RequiredArgsConstructor
public class ApiKeyScopeInterceptor implements HandlerInterceptor {

    private static final Set<String> RESOURCE_SCOPED = Set.of("drive", "elements", "tags");

    private static final String WS = "/api/workspaces/{wsId}";

    /** Rotte puntuali consentite alle API key oltre alle risorse intere: metodo + pattern → scope. */
    static final List<RouteRule> ROUTE_RULES = List.of(
            new RouteRule("GET", WS + "/members", ApiScope.MEMBERS_READ),
            new RouteRule("GET", WS + "/sprints", ApiScope.SPRINTS_READ),
            new RouteRule("GET", WS + "/sprints/active", ApiScope.SPRINTS_READ),
            new RouteRule("GET", WS + "/sprints/{sprintId}", ApiScope.SPRINTS_READ),
            new RouteRule("POST", WS + "/sprints/{sprintId}/tasks/{elementId}", ApiScope.SPRINTS_WRITE),
            new RouteRule("DELETE", WS + "/sprints/{sprintId}/tasks/{elementId}", ApiScope.SPRINTS_WRITE)
    );

    record RouteRule(String method, String pattern, ApiScope scope) {}

    private final ObjectMapper objectMapper;

    @Override
    public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler) throws Exception {
        Object attr = request.getAttribute(ApiKeyAuthFilter.ATTR_API_KEY);
        if (!(attr instanceof ApiKey key)) {
            return true; // non è una richiesta via API key: nessun vincolo aggiuntivo
        }
        String method = request.getMethod().toUpperCase();
        if ("OPTIONS".equals(method)) {
            return true; // preflight CORS
        }

        String[] seg = request.getRequestURI().split("/");
        // Attesa: /api/workspaces/{wsId}/{resource}/...
        // seg = ["", "api", "workspaces", "{wsId}", "{resource}", ...]
        if (seg.length < 5 || !"api".equals(seg[1]) || !"workspaces".equals(seg[2])) {
            return deny(response, "Questa risorsa non è accessibile tramite API key");
        }

        UUID pathWs;
        try {
            pathWs = UUID.fromString(seg[3]);
        } catch (IllegalArgumentException e) {
            return deny(response, "Workspace non valido");
        }
        if (!pathWs.equals(key.getWorkspaceId())) {
            return deny(response, "La API key non è abilitata per questo workspace");
        }
        // Doppio controllo sul workspace effettivamente passato al controller.
        if (request.getAttribute(HandlerMapping.URI_TEMPLATE_VARIABLES_ATTRIBUTE) instanceof Map<?, ?> vars
                && vars.get("wsId") != null
                && !key.getWorkspaceId().toString().equalsIgnoreCase(vars.get("wsId").toString())) {
            return deny(response, "La API key non è abilitata per questo workspace");
        }

        boolean read = "GET".equals(method) || "HEAD".equals(method);
        Set<ApiScope> scopes = key.getScopeSet();

        String resource = seg[4];
        Object best = request.getAttribute(HandlerMapping.BEST_MATCHING_PATTERN_ATTRIBUTE);
        if (RESOURCE_SCOPED.contains(resource)) {
            // La rotta scelta da Spring deve appartenere davvero alla stessa risorsa dell'URL.
            String prefix = WS + "/" + resource;
            if (best instanceof String p && !(p.equals(prefix) || p.startsWith(prefix + "/"))) {
                return deny(response, "Risorsa non accessibile tramite API key");
            }
            boolean allowed = scopes.stream().anyMatch(s ->
                    s.resource().equals(resource) && (read || s.isWrite()));
            return allowed || deny(response, "Scope insufficienti per questa operazione");
        }

        // Rotte puntuali: confronto col pattern della rotta Spring scelta (immune a varianti dell'URL).
        if (best instanceof String pattern) {
            String effective = "HEAD".equals(method) ? "GET" : method;
            for (RouteRule rule : ROUTE_RULES) {
                if (rule.method().equals(effective) && rule.pattern().equals(pattern)) {
                    return scopes.contains(rule.scope())
                            || deny(response, "Scope insufficienti per questa operazione: serve " + rule.scope().wire());
                }
            }
        }
        return deny(response, "Risorsa non accessibile tramite API key");
    }

    private boolean deny(HttpServletResponse response, String message) throws Exception {
        response.setStatus(HttpStatus.FORBIDDEN.value());
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        response.setCharacterEncoding("UTF-8"); // messaggi con lettere accentate
        response.getWriter().write(objectMapper.writeValueAsString(Map.of("error", message)));
        return false;
    }
}
